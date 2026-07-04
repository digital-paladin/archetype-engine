import { Router, Request, Response } from 'express';
import { getDataService } from '../services/data/dataService';
import { JournalEntry } from '../services/data/IDataService';

const router = Router();
const db = getDataService();

function todayDateStr(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** Map a JournalEntry DB row to the legacy response shape the frontend expects */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function entryToMetrics(entry: JournalEntry | null) {
  if (!entry) {
    return {
      sleep:     { bedtime: null, wakeTime: null, totalSleep: null, fitbitScore: null, vitalityScore: null, quality: null },
      nutrition: { meals: null, protein: null, calories: null, hydration: null, foodNotes: '' },
      stress:    { stress: null, energy: null, mentalState: null },
    };
  }
  const vitalityScore = entry.fitbit_score != null ? entry.fitbit_score / 10 : null;
  return {
    sleep: {
      bedtime:      entry.sleep_start  ?? null,
      wakeTime:     entry.sleep_end    ?? null,
      totalSleep:   entry.sleep_hours  ?? null,
      fitbitScore:  entry.fitbit_score ?? null,
      vitalityScore,
      quality: null,
    },
    nutrition: {
      meals:     null,
      protein:   entry.protein_level   ?? null,
      calories:  entry.calories_status ?? null,
      hydration: entry.hydration_oz    ?? null,
      foodNotes: entry.notes           ?? '',
    },
    stress: {
      // DB stores lowercase ('low','medium','high'); frontend expects Title-Case for button matching.
      stress:      entry.stress_level ? capitalize(entry.stress_level) : null,
      energy:      entry.energy_score ?? null,
      mentalState: entry.mental_state ?? null,
    },
  };
}

// ── GET /api/daily-metrics?date=YYYY-MM-DD ───────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const date = (typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
    ? req.query.date : todayDateStr();
  try {
    const userId = (req as any).userId as string;
    const entry  = await db.getJournalEntry(userId, date);
    res.json({ success: true, date, metrics: entryToMetrics(entry) });
  } catch (e: any) {
    console.error('[DAILY METRICS GET] Error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/daily-metrics/sleep-history ────────────────────────────────────
router.get('/sleep-history', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    // Direct DB access for sleep history (no IDataService method yet)
    const svc = db as any;
    const { data, error } = await svc.db
      .from('daily_journal_entries')
      .select('entry_date, sleep_hours, fitbit_score')
      .eq('user_id', userId)
      .order('entry_date', { ascending: false })
      .limit(30);
    if (error) throw error;
    const history = (data ?? []).map((r: any) => ({
      date:  r.entry_date,
      hours: r.sleep_hours  ?? 0,
      score: r.fitbit_score ?? 0,
    }));
    res.json({ success: true, history });
  } catch (e: any) {
    console.error('[DAILY] Error sleep-history:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/daily-metrics ───────────────────────────────────────────────────
// Body: { date, metrics: { sleep?, nutrition?, stress? } }
router.post('/', async (req: Request, res: Response) => {
  const { date, metrics } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'date required (YYYY-MM-DD)' });
  }
  if (!metrics || typeof metrics !== 'object') {
    return res.status(400).json({ success: false, error: 'metrics object required' });
  }

  try {
    const userId = (req as any).userId as string;
    const patch: Partial<JournalEntry> = { entry_date: date };

    if (metrics.sleep) {
      if (metrics.sleep.bedtime     != null) patch.sleep_start  = metrics.sleep.bedtime;
      if (metrics.sleep.wakeTime    != null) patch.sleep_end    = metrics.sleep.wakeTime;
      if (metrics.sleep.totalSleep  != null) patch.sleep_hours  = metrics.sleep.totalSleep;
      if (metrics.sleep.fitbitScore != null) patch.fitbit_score = metrics.sleep.fitbitScore;
    }
    if (metrics.nutrition) {
      const { protein, calories, hydration, foodNotes } = metrics.nutrition;
      if (protein   != null) patch.protein_level   = String(protein).toLowerCase()   as JournalEntry['protein_level'];
      if (calories  != null) patch.calories_status = String(calories).toLowerCase()  as JournalEntry['calories_status'];
      if (hydration != null) patch.hydration_oz    = hydration;
      if (foodNotes != null) patch.notes           = foodNotes;
    }
    if (metrics.stress) {
      const { stress, energy, mentalState } = metrics.stress;
      if (stress      != null) patch.stress_level = String(stress).toLowerCase() as JournalEntry['stress_level'];
      if (energy      != null) patch.energy_score = energy;
      if (mentalState != null) patch.mental_state = mentalState;
    }

    await db.upsertJournalEntry(userId, patch);
    console.log('[DAILY METRICS POST] Updated ' + date);
    res.json({ success: true });
  } catch (e: any) {
    console.error('[DAILY METRICS POST] Error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
