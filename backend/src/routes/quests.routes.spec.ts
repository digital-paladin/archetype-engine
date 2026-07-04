/**
 * Quests Routes — Unit & Integration Tests
 *
 * Pure-function tests (formatDateHeader, applySchema) run without any mocks.
 * HTTP integration tests mock getDataService to avoid real Supabase calls.
 */

import request from 'supertest';
import express, { Express } from 'express';

// ── Mock getDataService BEFORE importing the route ───────────────────────────
// The route file calls getDataService() at module level; the mock must be
// in place before the module is first imported.
const mockGetQuestEntries  = jest.fn<Promise<any[]>, any[]>();
const mockUpsertQuestEntry = jest.fn<Promise<void>, any[]>();

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    getQuestEntries:  (...args: any[]) => mockGetQuestEntries(...args),
    upsertQuestEntry: (...args: any[]) => mockUpsertQuestEntry(...args),
  }),
}));

// ── Import AFTER mock is registered ──────────────────────────────────────────
import router, {
  formatDateHeader,
  applySchema,
  QuestClass,
} from './quests.routes';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: formatDateHeader (pure — no mocks needed)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDateHeader', () => {
  it('formats a known Sunday correctly', () => {
    expect(formatDateHeader('2026-03-01')).toBe('2026-03-01 (Sun)');
  });

  it('formats a known Monday correctly', () => {
    expect(formatDateHeader('2026-03-02')).toBe('2026-03-02 (Mon)');
  });

  it('formats a known Saturday correctly', () => {
    expect(formatDateHeader('2026-02-21')).toBe('2026-02-21 (Sat)');
  });

  it('formats a Thursday (Jan 1 2026) correctly', () => {
    expect(formatDateHeader('2026-01-01')).toBe('2026-01-01 (Thu)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: applySchema (pure — no mocks needed)
// ─────────────────────────────────────────────────────────────────────────────

describe('applySchema', () => {
  it('fills missing fields with [To be logged]', () => {
    const input: QuestClass[] = [{ name: 'Web App Developer', fields: [] }];
    const result = applySchema(input);
    expect(result[0].fields).toEqual([
      { label: 'Job (TTI)',         value: '[To be logged]' },
      { label: 'Personal Projects', value: '[To be logged]' },
    ]);
  });

  it('preserves existing field values', () => {
    const input: QuestClass[] = [{
      name: 'Web App Developer',
      fields: [{ label: 'Job (TTI)', value: 'IQ-9000 done' }],
    }];
    const result = applySchema(input);
    expect(result[0].fields[0].value).toBe('IQ-9000 done');
    expect(result[0].fields[1].value).toBe('[To be logged]');
  });

  it('maintains schema field order', () => {
    const input: QuestClass[] = [{
      name: 'RedTeam Operator',
      fields: [
        { label: 'Personal Projects', value: 'a' },
        { label: 'Training',          value: 'b' },
      ],
    }];
    const result = applySchema(input);
    const labels = result[0].fields.map(f => f.label);
    expect(labels).toEqual(['Training', 'Labs', 'Job', 'Personal Projects']);
  });

  it('appends extra fields that are not in the schema', () => {
    const input: QuestClass[] = [{
      name: 'Artist',
      fields: [
        { label: 'Personal Projects', value: 'done' },
        { label: 'Exhibition Prep',   value: 'prep work' },
      ],
    }];
    const result = applySchema(input);
    const labels = result[0].fields.map(f => f.label);
    expect(labels).toContain('Exhibition Prep');
    expect(labels.indexOf('Training')).toBeLessThan(labels.indexOf('Exhibition Prep'));
  });

  it('returns class unchanged when class name is not in schema', () => {
    const input: QuestClass[] = [{
      name: 'Unknown Class',
      fields: [{ label: 'SomeField', value: 'x' }],
    }];
    const result = applySchema(input);
    expect(result[0]).toEqual(input[0]);
  });

  it('handles empty classes array', () => {
    expect(applySchema([])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: HTTP — GET /api/quests/today
// ─────────────────────────────────────────────────────────────────────────────

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  // Inject a fake userId so route can read (req as any).userId
  app.use((req: any, _res: any, next: any) => { req.userId = 'test-user-id'; next(); });
  app.use('/api/quests', router);
  return app;
}

describe('GET /api/quests/today', () => {
  beforeEach(() => {
    mockGetQuestEntries.mockReset();
    mockUpsertQuestEntry.mockReset();
  });

  it('returns schema defaults when DB returns no rows for the date', async () => {
    mockGetQuestEntries.mockResolvedValue([]);

    const res = await request(makeApp()).get('/api/quests/today?date=2026-05-17');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.date).toBe('2026-05-17');
    expect(Array.isArray(res.body.classes)).toBe(true);
    expect(res.body.classes.length).toBeGreaterThan(0);
    // Every field should default to [To be logged]
    const firstField = res.body.classes[0].fields[0];
    expect(firstField.value).toBe('[To be logged]');
  });

  it('returns existing quest data when DB has rows', async () => {
    mockGetQuestEntries.mockResolvedValue([
      { class_name: 'Web App Developer', quest_label: 'Job (TTI)', content: 'IQ-8500 completed' },
    ]);

    const res = await request(makeApp()).get('/api/quests/today?date=2026-05-17');

    expect(res.status).toBe(200);
    const devClass = res.body.classes.find((c: QuestClass) => c.name === 'Web App Developer');
    const jobField = devClass?.fields.find((f: any) => f.label === 'Job (TTI)');
    expect(jobField?.value).toBe('IQ-8500 completed');
    // Missing field should be schema-defaulted
    const ppField = devClass?.fields.find((f: any) => f.label === 'Personal Projects');
    expect(ppField?.value).toBe('[To be logged]');
  });

  /**
   * REGRESSION: Verifies fix from commit e7d531e —
   * GET must NEVER return { success: false } or 500; always return schema defaults.
   * Previously the catch block returned res.status(500).json({ success: false }).
   */
  it('returns schema defaults (not 500) when the DB throws', async () => {
    mockGetQuestEntries.mockRejectedValue(new Error('Supabase connection refused'));

    const res = await request(makeApp()).get('/api/quests/today?date=2026-05-17');

    expect(res.status).toBe(200);                   // NOT 500
    expect(res.body.success).toBe(true);            // NOT false
    expect(Array.isArray(res.body.classes)).toBe(true);
    expect(res.body.classes.length).toBeGreaterThan(0);
  });

  it('defaults to today when no date query param is provided', async () => {
    mockGetQuestEntries.mockResolvedValue([]);

    const res = await request(makeApp()).get('/api/quests/today');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('date');
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: HTTP — PUT /api/quests/today
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/quests/today', () => {
  beforeEach(() => {
    mockGetQuestEntries.mockReset();
    mockUpsertQuestEntry.mockReset();
  });

  it('returns 400 when required body fields are missing', async () => {
    const res = await request(makeApp())
      .put('/api/quests/today')
      .send({ date: '2026-05-17', className: 'Web App Developer' }); // missing label + value

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when date format is invalid', async () => {
    const res = await request(makeApp())
      .put('/api/quests/today')
      .send({ date: 'not-a-date', className: 'Web App Developer', label: 'Job (TTI)', value: 'x' });

    expect(res.status).toBe(400);
  });

  it('returns 200 and calls upsertQuestEntry on valid body', async () => {
    mockUpsertQuestEntry.mockResolvedValue(undefined);

    const res = await request(makeApp())
      .put('/api/quests/today')
      .send({ date: '2026-05-17', className: 'Web App Developer', label: 'Job (TTI)', value: 'IQ-8500 done' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpsertQuestEntry).toHaveBeenCalledWith(
      'test-user-id', '2026-05-17', 'Web App Developer', 'Job (TTI)', 'IQ-8500 done'
    );
  });

  it('converts [To be logged] to empty string before upserting', async () => {
    mockUpsertQuestEntry.mockResolvedValue(undefined);

    await request(makeApp())
      .put('/api/quests/today')
      .send({ date: '2026-05-17', className: 'Artist', label: 'Training', value: '[To be logged]' });

    // content should be '' not '[To be logged]'
    expect(mockUpsertQuestEntry).toHaveBeenCalledWith(
      'test-user-id', '2026-05-17', 'Artist', 'Training', ''
    );
  });

  it('returns 500 when DB throws on upsert', async () => {
    mockUpsertQuestEntry.mockRejectedValue(new Error('DB error'));

    const res = await request(makeApp())
      .put('/api/quests/today')
      .send({ date: '2026-05-17', className: 'Web App Developer', label: 'Job (TTI)', value: 'x' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
