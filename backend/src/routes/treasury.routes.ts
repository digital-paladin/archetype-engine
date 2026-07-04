import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { parse as parseCSV } from 'csv-parse/sync';
import { getDataService } from '../services/data/dataService';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router  = Router();

// ── Shared helper ──────────────────────────────────────────────────────────
function calcTotals(entries: Array<{ category: string; amount: number }>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const e of entries) totals[e.category] = (totals[e.category] || 0) + e.amount;
  return totals;
}

// GET /api/treasury — full spending state for current month + history
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const db     = getDataService();

  const [settings, allEntries] = await Promise.all([
    db.getTreasurySettings(userId),
    db.getSpendingEntries(userId),
  ]);

  const currentMonth = settings?.current_month ?? new Date().toISOString().substring(0, 7);
  const currency     = settings?.currency ?? 'USD';
  const budgets      = (settings?.budgets ?? {}) as Record<string, number>;

  const transactions = allEntries.filter(e => e.date.startsWith(currentMonth));
  const totals       = calcTotals(transactions);

  // History: past months aggregated (exclude current month)
  const byMonth: Record<string, Record<string, number>> = {};
  for (const e of allEntries) {
    const m = e.date.substring(0, 7);
    if (m === currentMonth) continue;
    if (!byMonth[m]) byMonth[m] = {};
    byMonth[m][e.category] = (byMonth[m][e.category] || 0) + e.amount;
  }
  const history = Object.entries(byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 12)
    .map(([month, monthTotals]) => ({ month, totals: monthTotals }));

  return res.json({
    success: true,
    data: { currentMonth, currency, budgets, transactions, history },
    totals,
  });
});

// POST /api/treasury/transactions — add a transaction
router.post('/transactions', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { date, amount, merchant, category, notes } = req.body;

  if (!date || !amount || !merchant || !category) {
    return res.status(400).json({ success: false, error: 'date, amount, merchant, category are required' });
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ success: false, error: 'amount must be a positive number' });
  }

  const db  = getDataService();
  const txn = await db.addSpendingEntry(userId, { date, amount, merchant, category, notes });

  const settings     = await db.getTreasurySettings(userId);
  const currentMonth = settings?.current_month ?? (date as string).substring(0, 7);
  const entries      = await db.getSpendingEntries(userId, currentMonth);
  const totals       = calcTotals(entries);

  return res.status(201).json({ success: true, transaction: txn, totals });
});

// DELETE /api/treasury/transactions/:id — remove a transaction
router.delete('/transactions/:id', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const db     = getDataService();

  await db.deleteSpendingEntry(userId, req.params.id);

  const settings     = await db.getTreasurySettings(userId);
  const currentMonth = settings?.current_month ?? new Date().toISOString().substring(0, 7);
  const entries      = await db.getSpendingEntries(userId, currentMonth);
  const totals       = calcTotals(entries);

  return res.json({ success: true, totals });
});

// PUT /api/treasury/budgets — update monthly budget limits
router.put('/budgets', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { budgets } = req.body as { budgets: Record<string, number> };
  if (!budgets || typeof budgets !== 'object') {
    return res.status(400).json({ success: false, error: 'budgets object is required' });
  }

  const db       = getDataService();
  const existing = await db.getTreasurySettings(userId);
  const merged   = { ...(existing?.budgets as Record<string, number> ?? {}), ...budgets };
  await db.upsertTreasurySettings(userId, { budgets: merged });
  const updated  = await db.getTreasurySettings(userId);

  return res.json({ success: true, budgets: updated?.budgets ?? merged });
});

// POST /api/treasury/import-csv — parse Monarch Money CSV and bulk insert
router.post('/import-csv', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded. Send field name "file".' });
  }

  let rows: Record<string, string>[];
  try {
    rows = parseCSV(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (err) {
    return res.status(400).json({ success: false, error: 'CSV parse error: ' + (err as Error).message });
  }

  const userId  = (req as any).userId as string;
  const db      = getDataService();
  const existing = await db.getSpendingEntries(userId);
  const existingKeys = new Set(existing.map(t => `${t.date}|${t.merchant}|${t.amount}`));

  type EntryInput = { date: string; amount: number; merchant: string; category: string; notes?: string };
  const toImport: EntryInput[] = [];
  const skipped: number[] = [];

  rows.forEach((row, idx) => {
    const date     = row['Date']     || row['date']     || '';
    const merchant = row['Merchant'] || row['merchant'] || row['Payee'] || '';
    const rawAmt   = row['Amount']   || row['amount']   || '0';
    const monCat   = row['Category'] || row['category'] || '';
    const notes    = row['Notes']    || row['notes']    || row['Tags'] || '';

    if (!date || !merchant) { skipped.push(idx + 2); return; }
    const amount = Math.abs(parseFloat(rawAmt.replace(/[$,]/g, '')));
    if (isNaN(amount) || amount <= 0) { skipped.push(idx + 2); return; }

    const category = mapMonarchCategory(monCat);
    const key = `${date}|${merchant}|${amount}`;
    if (existingKeys.has(key)) { skipped.push(idx + 2); return; }

    toImport.push({ date, amount, merchant, category, notes: notes || undefined });
    existingKeys.add(key);
  });

  // Insert sequentially to avoid PK conflicts
  for (const entry of toImport) {
    await db.addSpendingEntry(userId, entry);
  }

  const settings     = await db.getTreasurySettings(userId);
  const currentMonth = settings?.current_month ?? new Date().toISOString().substring(0, 7);
  const entries      = await db.getSpendingEntries(userId, currentMonth);
  const totals       = calcTotals(entries);

  return res.json({ success: true, imported: toImport.length, skipped: skipped.length, totals });
});

// POST /api/treasury/rollover — advance to next month (transactions stay in DB for history)
router.post('/rollover', async (req: Request, res: Response) => {
  const { newMonth } = req.body as { newMonth: string };
  if (!newMonth) {
    return res.status(400).json({ success: false, error: 'newMonth (YYYY-MM string) is required' });
  }

  const userId  = (req as any).userId as string;
  const db      = getDataService();
  const settings = await db.getTreasurySettings(userId);
  const archivedMonth = settings?.current_month ?? new Date().toISOString().substring(0, 7);

  await db.upsertTreasurySettings(userId, { current_month: newMonth });

  const archivedEntries = await db.getSpendingEntries(userId, archivedMonth);
  const totals          = calcTotals(archivedEntries);

  return res.json({
    success: true,
    archivedMonth: { month: archivedMonth, totals },
    currentMonth: newMonth,
  });
});

// ── Monarch Money category → Treasury category mapping ──────────────────────
const MONARCH_CATEGORY_MAP: Record<string, string> = {
  'gas':                         'vehicle',
  'gas stations':                'vehicle',
  'auto & transport':            'vehicle',
  'auto insurance':              'vehicle',
  'auto maintenance':            'vehicle',
  'parking':                     'vehicle',
  'car wash':                    'vehicle',
  'rent':                        'lodging',
  'mortgage':                    'lodging',
  'hotel':                       'lodging',
  'lodging':                     'lodging',
  'home':                        'lodging',
  'utilities':                   'lodging',
  'gym':                         'training',
  'fitness':                     'training',
  'sports':                      'training',
  'sporting goods':              'training',
  'recreation':                  'training',
  'vitamins and supplements':    'supplements',
  'supplements':                 'supplements',
  'pharmacy':                    'supplements',
  'health':                      'supplements',
  'personal care':               'supplements',
  'groceries':                   'groceries',
  'supermarkets':                'groceries',
  'food and dining':             'groceries',
  'entertainment':               'entertainment',
  'movies & dvd':                'entertainment',
  'music':                       'entertainment',
  'games':                       'entertainment',
  'subscription':                'subscriptions',
  'streaming':                   'subscriptions',
  'software':                    'subscriptions',
  'apps':                        'subscriptions',
  'shopping':                    'other',
  'general merchandise':         'other',
};

function mapMonarchCategory(monarchCat: string): string {
  const key = monarchCat.toLowerCase().trim();
  return MONARCH_CATEGORY_MAP[key] || 'other';
}

export default router;
