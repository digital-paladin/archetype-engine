import { Router, Request, Response } from 'express';
import { getDataService } from '../services/data/dataService';
import { QuestEntry } from '../services/data/IDataService';

const router = Router();
const db = getDataService();

// ── Types (exported for frontend + tests) ────────────────────────────────────
export interface QuestField { label: string; value: string; }
export interface QuestClass { name: string; fields: QuestField[]; }

/** Canonical field order per class. Fields not in schema are appended. */
const CLASS_FIELD_SCHEMA: Record<string, string[]> = {
  'Paladin of God':       ['Training', 'Warrior Skills', 'Service'],
  'Web App Developer':    ['Job (TTI)', 'Personal Projects'],
  'RedTeam Operator':     ['Training', 'Labs', 'Job', 'Personal Projects'],
  'Artist':               ['Training', 'Personal Projects'],
  'Financial Strategist': ['Training', 'Personal Projects'],
};

/** Merge DB data against schema — missing fields get [To be logged]. */
export function applySchema(classes: QuestClass[]): QuestClass[] {
  return classes.map(c => {
    const expected = CLASS_FIELD_SCHEMA[c.name];
    if (!expected) return c;
    const existing = new Map(c.fields.map(f => [f.label, f.value]));
    const merged: QuestField[] = expected.map(label => ({
      label,
      value: existing.get(label) ?? '[To be logged]',
    }));
    for (const f of c.fields) {
      if (!expected.includes(f.label)) merged.push(f);
    }
    return { ...c, fields: merged };
  });
}

export function formatDateHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return dateStr + ' (' + days[new Date(y, m - 1, d).getDay()] + ')';
}

/** Convert flat QuestEntry[] rows to nested QuestClass[] structure */
function rowsToClasses(rows: QuestEntry[]): QuestClass[] {
  const map = new Map<string, QuestField[]>();
  for (const r of rows) {
    if (!map.has(r.class_name)) map.set(r.class_name, []);
    map.get(r.class_name)!.push({ label: r.quest_label, value: r.content ?? '' });
  }
  const schemaOrder = Object.keys(CLASS_FIELD_SCHEMA);
  const ordered: QuestClass[] = [];
  for (const name of schemaOrder) {
    if (map.has(name)) ordered.push({ name, fields: map.get(name)! });
  }
  for (const [name, fields] of map.entries()) {
    if (!schemaOrder.includes(name)) ordered.push({ name, fields });
  }
  return ordered;
}

// ── GET /api/quests/today?date=YYYY-MM-DD ────────────────────────────────────
router.get('/today', async (req: Request, res: Response) => {
  const dateStr = typeof req.query.date === 'string' ? req.query.date : new Date().toLocaleDateString('en-CA');
  try {
    const userId = (req as any).userId as string;
    const rows   = await db.getQuestEntries(userId, dateStr);

    let classes: QuestClass[];
    if (rows.length === 0) {
      classes = Object.entries(CLASS_FIELD_SCHEMA).map(([name, labels]) => ({
        name,
        fields: labels.map(label => ({ label, value: '[To be logged]' })),
      }));
      console.log('[QUESTS GET] No entry for ' + dateStr + ' — returning schema defaults');
    } else {
      classes = applySchema(rowsToClasses(rows));
      console.log('[QUESTS GET] Loaded ' + rows.length + ' quest fields for ' + dateStr);
    }

    res.json({ success: true, date: dateStr, classes });
  } catch (e) {
    console.error('[QUESTS GET] Error:', e instanceof Error ? e.message : e);
    // Never return success:false for a GET — the UI goes blank. Return schema defaults instead.
    const fallbackClasses = Object.entries(CLASS_FIELD_SCHEMA).map(([name, labels]) => ({
      name,
      fields: labels.map(label => ({ label, value: '[To be logged]' })),
    }));
    res.json({ success: true, date: dateStr, classes: fallbackClasses });
  }
});

// ── PUT /api/quests/today ────────────────────────────────────────────────────
// Body: { date, className, label, value }
router.put('/today', async (req: Request, res: Response) => {
  const { date, className, label, value } = req.body;

  if (!date || !className || !label || value === undefined) {
    return res.status(400).json({ success: false, error: 'date, className, label, value required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
  }

  try {
    const userId  = (req as any).userId as string;
    const content = (typeof value === 'string' && value !== '[To be logged]') ? value : '';
    await db.upsertQuestEntry(userId, date, className, label, content);
    console.log('[QUESTS PUT] ' + date + ' — ' + className + ':' + label + ' updated');
    res.json({ success: true });
  } catch (e) {
    console.error('[QUESTS PUT] Error:', e instanceof Error ? e.message : e);
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

export default router;
