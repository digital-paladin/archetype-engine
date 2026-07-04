/**
 * acm.routes.ts — Unit & Integration Tests (Supabase)
 *
 * GET /api/acm/today:
 *  - Returns itemStates[ACM_ITEM_COUNT] built from Supabase acm_entries rows
 *  - Computes 4 ACM stats via weight arrays (spiritual/physical/clarity/pleasure)
 *  - Applies sleep bonus from journal fitbit_score
 *  - Returns anhedoniaRisk classification (High/Medium/Low) based on today's score
 *  - Returns rollingPleasure7d (7-day avg) and dopamineBaseline tier (Healthy/Suppressed/Depleted/Critical)
 *  - Rolling window anchored to requested date — single-day compliance does not restore a Critical baseline
 *  - Returns 200 with all-false states when no DB rows exist (no 404)
 *  - Returns 500 on DB error
 */

import request from 'supertest';
import express, { Express } from 'express';

// ── Mock getDataService BEFORE importing the route ─────────────────────────
const mockGetACMEntries   = jest.fn<Promise<any[]>, any[]>();
const mockGetJournalEntry = jest.fn<Promise<any>,   any[]>();

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    getACMEntries:   (...args: any[]) => mockGetACMEntries(...args),
    getJournalEntry: (...args: any[]) => mockGetJournalEntry(...args),
  }),
}));

// ── Import AFTER mock ──────────────────────────────────────────────────────
import router from './acm.routes';
import { ACM_ITEM_COUNT } from '../config/acm.config';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.userId = 'test-user'; next(); });
  app.use('/api/acm', router);
  return app;
}

/** Build acm_entries rows (only checked ones — unchecked rows are absent, defaulting to false) */
function buildAcmRows(states: boolean[]): { item_index: number; completed: boolean }[] {
  return states
    .map((completed, item_index) => ({ item_index, completed }))
    .filter(r => r.completed);
}

const ALL_CHECKED   = Array(ACM_ITEM_COUNT).fill(true);
const ALL_UNCHECKED = Array(ACM_ITEM_COUNT).fill(false);

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/acm/today', () => {
  beforeEach(() => {
    mockGetACMEntries.mockReset();
    mockGetJournalEntry.mockReset().mockResolvedValue(null); // default: no sleep data
  });

  // ── Basic response shape ──────────────────────────────────────────────────

  it('returns 200 with all-false states when DB has no rows', async () => {
    mockGetACMEntries.mockResolvedValue([]);

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.itemStates.every((s: boolean) => s === false)).toBe(true);
    expect(res.body.completedCount).toBe(0);
  });

  it('returns itemStates array with ACM_ITEM_COUNT elements', async () => {
    mockGetACMEntries.mockResolvedValue([]);

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(Array.isArray(res.body.itemStates)).toBe(true);
    expect(res.body.itemStates.length).toBe(ACM_ITEM_COUNT);
  });

  it('defaults to today when no date param provided', async () => {
    mockGetACMEntries.mockResolvedValue([]);

    const res = await request(makeApp()).get('/api/acm/today');

    expect(res.status).toBe(200);
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2} \(\w{3}\)$/);
  });

  // ── itemStates mapping ────────────────────────────────────────────────────

  it('reflects checked state: item at index 0 checked => itemStates[0] true', async () => {
    mockGetACMEntries.mockResolvedValue([{ item_index: 0, completed: true }]);

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.itemStates[0]).toBe(true);
    expect(res.body.itemStates[1]).toBe(false);
  });

  it('returns all-true states when all items checked', async () => {
    mockGetACMEntries.mockResolvedValue(buildAcmRows(ALL_CHECKED));

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.itemStates.every((s: boolean) => s === true)).toBe(true);
    expect(res.body.completedCount).toBe(ACM_ITEM_COUNT);
  });

  // ── Stat computation ──────────────────────────────────────────────────────

  it('stats are zeroes when all items unchecked and no sleep data', async () => {
    mockGetACMEntries.mockResolvedValue([]);

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.stats.spiritual).toBe(0);
    expect(res.body.stats.physical).toBe(0);
    expect(res.body.stats.clarity).toBe(0);
    expect(res.body.stats.pleasure).toBe(0);
  });

  it('stats are all 100 when all items checked with no sleep bonus', async () => {
    mockGetACMEntries.mockResolvedValue(buildAcmRows(ALL_CHECKED));

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    // All weight arrays sum to 100 => each stat caps at 100
    expect(res.body.stats.spiritual).toBe(100);
    expect(res.body.stats.physical).toBe(100);
    expect(res.body.stats.clarity).toBe(100);
    expect(res.body.stats.pleasure).toBe(100);
  });

  // ── Sleep bonus ───────────────────────────────────────────────────────────

  it('applies sleep bonus: fitbit=100 => vitality=10 => bonus=5', async () => {
    // Item 0 (alcohol abstention): W_CLARITY[0]=30, W_PLEASURE[0]=30, W_SPIRITUAL[0]=5, W_PHYSICAL[0]=0
    mockGetACMEntries.mockResolvedValue([{ item_index: 0, completed: true }]);
    mockGetJournalEntry.mockResolvedValue({ fitbit_score: 100 });

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.sleepBonus).toBe(5);
    expect(res.body.stats.spiritual).toBe(10);  // 5  + 5
    expect(res.body.stats.physical).toBe(5);    // 0  + 5
    expect(res.body.stats.clarity).toBe(35);    // 30 + 5
    expect(res.body.stats.pleasure).toBe(30);   // no sleepBonus on pleasure
  });

  it('sleepBonus is 0 when no journal entry exists', async () => {
    mockGetACMEntries.mockResolvedValue([]);
    mockGetJournalEntry.mockResolvedValue(null);

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.sleepBonus).toBe(0);
  });

  // ── Anhedonia risk ────────────────────────────────────────────────────────

  it('anhedoniaRisk=Low when pleasure >= 80', async () => {
    // W_PLEASURE: idx 0 (+30), idx 9 (+20), idx 10 (+35) = 85
    const states = [...ALL_UNCHECKED];
    states[0] = true; states[9] = true; states[10] = true;
    mockGetACMEntries.mockResolvedValue(buildAcmRows(states));

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.stats.pleasure).toBeGreaterThanOrEqual(80);
    expect(res.body.anhedoniaRisk).toBe('Low');
  });

  it('anhedoniaRisk=Medium when pleasure between 60 and 79', async () => {
    // W_PLEASURE: idx 0 (+30), idx 10 (+35) = 65 → Medium (60-79)
    const states = [...ALL_UNCHECKED];
    states[0] = true; states[10] = true;
    mockGetACMEntries.mockResolvedValue(buildAcmRows(states));

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    const pleasure = res.body.stats.pleasure;
    expect(pleasure).toBeGreaterThanOrEqual(60);
    expect(pleasure).toBeLessThan(80);
    expect(res.body.anhedoniaRisk).toBe('Medium');
  });

  it('anhedoniaRisk=High when pleasure < 60', async () => {
    mockGetACMEntries.mockResolvedValue([]);

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.stats.pleasure).toBe(0);
    expect(res.body.anhedoniaRisk).toBe('High');
  });

  // ── Date field ────────────────────────────────────────────────────────────

  it('returns date field with day abbreviation matching the requested date', async () => {
    mockGetACMEntries.mockResolvedValue([]);

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.date).toBe('2026-04-12 (Sun)');
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns 500 when getACMEntries throws', async () => {
    mockGetACMEntries.mockRejectedValue(new Error('Supabase down'));

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  // ── Rolling 7-day pleasure baseline ──────────────────────────────────────

  it('rollingPleasure7d=100 and dopamineBaseline=Healthy when all 7 days fully compliant', async () => {
    mockGetACMEntries.mockResolvedValue(buildAcmRows(ALL_CHECKED));

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.rollingPleasure7d).toBe(100);
    expect(res.body.dopamineBaseline).toBe('Healthy');
  });

  it('rollingPleasure7d=0 and dopamineBaseline=Critical when all 7 days empty', async () => {
    mockGetACMEntries.mockResolvedValue([]);

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.rollingPleasure7d).toBe(0);
    expect(res.body.dopamineBaseline).toBe('Critical');
  });

  it('today fully compliant but 6 prior days empty => rollingPleasure7d=14 (Critical), not today pleasure=100', async () => {
    // KEY TEST: proves single-day compliance does not restore dopamine baseline.
    // W_PLEASURE all-checked = 100. Average over 7 days: Math.round(100/7) = 14.
    mockGetACMEntries.mockImplementation(async (_userId: string, date: string) => {
      return date === '2026-04-12' ? buildAcmRows(ALL_CHECKED) : [];
    });

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.stats.pleasure).toBe(100);           // today looks compliant
    expect(res.body.rollingPleasure7d).toBe(14);          // baseline still depleted
    expect(res.body.dopamineBaseline).toBe('Critical');   // addiction mechanism modelled
  });

  it('dopamineBaseline=Suppressed when rollingPleasure7d between 60 and 79', async () => {
    // W_PLEASURE: idx 0(+30) + idx 5(+10) + idx 10(+35) = 75
    const states = [...ALL_UNCHECKED];
    states[0] = true; states[5] = true; states[10] = true;
    mockGetACMEntries.mockResolvedValue(buildAcmRows(states));

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.rollingPleasure7d).toBeGreaterThanOrEqual(60);
    expect(res.body.rollingPleasure7d).toBeLessThan(80);
    expect(res.body.dopamineBaseline).toBe('Suppressed');
  });

  it('dopamineBaseline=Depleted when rollingPleasure7d between 40 and 59', async () => {
    // W_PLEASURE: idx 0(+30) + idx 9(+20) = 50
    const states = [...ALL_UNCHECKED];
    states[0] = true; states[9] = true;
    mockGetACMEntries.mockResolvedValue(buildAcmRows(states));

    const res = await request(makeApp()).get('/api/acm/today?date=2026-04-12');

    expect(res.body.rollingPleasure7d).toBe(50);
    expect(res.body.dopamineBaseline).toBe('Depleted');
  });
});
