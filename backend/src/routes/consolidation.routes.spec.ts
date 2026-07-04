import request from 'supertest';
import express from 'express';
import consolidationRouter from '../routes/consolidation.routes';

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock('../services/consolidation.service', () => ({
  ConsolidationService: jest.fn().mockImplementation(() => ({
    runForUser: jest.fn().mockResolvedValue({
      date:             '2026-05-01',
      streakDays:       690,
      streakTier:       'Grandmaster',
      fitbitScore:      91,
      consolidationPct: 105,
      aclBonus:         8,
      classes: [
        {
          className:   'Developer',
          pendingXP:   60,
          bonusXP:     3,
          confirmedXP: 63,
          newLevel:    20,
          leveledUp:   false,
        },
      ],
      totalPending:   60,
      totalConfirmed: 63,
    }),
  })),
}));

jest.mock('../services/data/dataService', () => ({
  getDataService: jest.fn(() => ({
    getXPHistory: jest.fn().mockResolvedValue([
      { id: '1', user_id: 'u1', earned_at: '2026-05-01', class_name: 'Developer',
        xp_pending: 60, xp_confirmed: 63, consolidation_pct: 105 },
    ]),
  })),
}));

// ── App setup ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Inject userId like authMiddleware would
app.use((req, _res, next) => { (req as any).userId = 'test-user-id'; next(); });
app.use('/api/consolidation', consolidationRouter);

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/consolidation/run', () => {
  it('returns 200 with consolidation result', async () => {
    const res = await request(app)
      .post('/api/consolidation/run')
      .send({ date: '2026-05-01', streakDays: 690 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.date).toBe('2026-05-01');
    expect(res.body.streakTier).toBe('Grandmaster');
    expect(res.body.consolidationPct).toBe(105);
    expect(res.body.totalConfirmed).toBe(63);
    expect(Array.isArray(res.body.classes)).toBe(true);
    expect(Array.isArray(res.body.levelUps)).toBe(true);
  });

  it('uses defaults when body is empty', async () => {
    const res = await request(app).post('/api/consolidation/run').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 for negative streakDays', async () => {
    const res = await request(app)
      .post('/api/consolidation/run')
      .send({ streakDays: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 401 when userId is missing', async () => {
    const bare = express();
    bare.use(express.json());
    bare.use('/api/consolidation', consolidationRouter);
    const res = await request(bare).post('/api/consolidation/run').send({});
    expect(res.status).toBe(401);
  });
});

describe('GET /api/consolidation/history', () => {
  it('returns xp_history rows', async () => {
    const res = await request(app).get('/api/consolidation/history');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].class_name).toBe('Developer');
  });

  it('accepts limit query param', async () => {
    const res = await request(app).get('/api/consolidation/history?limit=5');
    expect(res.status).toBe(200);
  });
});
