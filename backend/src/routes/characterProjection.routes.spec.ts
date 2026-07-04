// characterProjection.routes.spec.ts
// Jest test suite for XP projection and vitality-status API endpoints

// Mock fs BEFORE any imports so the route's inline require('fs') gets the mock
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
}));
jest.mock('../services/xpProjection.service');

import request from 'supertest';
import express from 'express';
import * as fs from 'fs';
import { XPProjectionService } from '../services/xpProjection.service';
import characterProjectionRouter from './characterProjection.routes';

const app = express();
app.use(express.json());
app.use('/api', characterProjectionRouter);

// ─────────────────────────────────────────────────────────────
// XP Projection
// ─────────────────────────────────────────────────────────────
const MOCK_PROJECTION = {
  Sage:      { totalXP: 100, daysTracked: 10, avgDailyXP: 10, avgWeeklyXP: 70,  projected6mo: 1800, projected12mo: 3600 },
  Warrior:   { totalXP:  50, daysTracked: 10, avgDailyXP:  5, avgWeeklyXP: 35,  projected6mo:  900, projected12mo: 1800 },
  Developer: { totalXP: 150, daysTracked: 10, avgDailyXP: 15, avgWeeklyXP: 105, projected6mo: 2700, projected12mo: 5400 },
  Redteamer: { totalXP:  30, daysTracked: 10, avgDailyXP:  3, avgWeeklyXP: 21,  projected6mo:  540, projected12mo: 1080 },
};

describe('XP Projection API', () => {
  beforeEach(() => {
    jest.mocked(XPProjectionService.parseXPProjections).mockReturnValue(MOCK_PROJECTION);
  });

  afterEach(() => {
    jest.mocked(XPProjectionService.parseXPProjections).mockReset();
  });

  it('GET /api/xp-projection should return analytics for all classes', async () => {
    const response = await request(app).get('/api/xp-projection');
    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
    expect(response.body).toHaveProperty('Sage');
    expect(response.body).toHaveProperty('Warrior');
    expect(response.body).toHaveProperty('Developer');
    expect(response.body).toHaveProperty('Redteamer');
    expect(response.body['Sage']).toHaveProperty('totalXP');
    expect(response.body['Sage']).toHaveProperty('daysTracked');
    expect(response.body['Sage']).toHaveProperty('avgDailyXP');
    expect(response.body['Sage']).toHaveProperty('avgWeeklyXP');
    expect(response.body['Sage']).toHaveProperty('projected6mo');
    expect(response.body['Sage']).toHaveProperty('projected12mo');
  });

  it('GET /api/xp-projection should handle errors gracefully', async () => {
    jest.mocked(XPProjectionService.parseXPProjections).mockImplementation(() => {
      throw new Error('Simulated read failure');
    });
    const response = await request(app).get('/api/xp-projection');
    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────
// Vitality Status — Dynamic Formula
// Formula: debt > 5hrs → min(100, 100 - (debt - 5) × 3)
//          debt ≤ 5hrs → 100
// ─────────────────────────────────────────────────────────────
describe('GET /api/vitality-status — dynamic vitality calculation', () => {
  function setupFixture(sleepDebt: number | null, status = 'Normal ✅') {
    const debtLine = sleepDebt !== null ? `**Sleep Debt:** ${sleepDebt} hrs` : '';
    const content = `
## [VITALITY-SYSTEM-BEGIN]
**Current:** 78.3/100
**Status:** ${status}
${debtLine}
**Trend:** Stable ➡️
    `.trim();
    (fs.readFileSync as jest.Mock).mockReturnValue(content as any);
  }

  afterEach(() => {
    (fs.readFileSync as jest.Mock).mockReset();
  });

  it('calculates vitality dynamically from debt > 5 hrs (formula: 100 - (debt-5)×3)', async () => {
    setupFixture(12.23);
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    // 100 - (12.23 - 5) × 3 = 100 - 21.69 = 78.31 → rounds to 78.3
    expect(response.body.current).toBeCloseTo(78.3, 1);
  });

  it('returns 100 when sleep debt is ≤ 5 hrs', async () => {
    setupFixture(3.5);
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.current).toBe(100);
  });

  it('returns 100 when sleep debt is exactly 5 hrs', async () => {
    setupFixture(5.0);
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.current).toBe(100);
  });

  it('caps vitality at 100 (formula can never exceed 100)', async () => {
    setupFixture(0);
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.current).toBeLessThanOrEqual(100);
  });

  it('returns 100 when no Sleep Debt line in file', async () => {
    setupFixture(null); // no sleep debt line
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.current).toBe(100);
  });

  it('ignores the static **Current:** value (uses formula instead)', async () => {
    // Static says 78.3 but debt = 2 hrs → formula yields 100
    setupFixture(2.0);
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.current).toBe(100); // NOT 78.3
  });

  it('returns sleepDebt and status fields in response', async () => {
    setupFixture(8.0, 'Fatigued');
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.sleepDebt).toBe(8.0);
    expect(response.body.status).toContain('Fatigued');
  });

  it('returns 500 on file read error', async () => {
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw new Error('File not found');
    });
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────
// Vitality Status — Flag regression tests
//
// Before fix (commit 7c5bcde) the **Flag:** regex scanned the entire
// character-sheet.md and matched documentation template examples at
// line ~1318 which contain [X] and [rate] placeholders. The fix scopes
// the search to the ### Sleep Debt Counter section (≤2000 chars) and
// suppresses any flag containing [X], [rate], or [Tree] tokens.
// ─────────────────────────────────────────────────────────────

describe('GET /api/vitality-status — flag regression (template placeholder leak)', () => {
  afterEach(() => {
    (fs.readFileSync as jest.Mock).mockReset();
  });

  it('suppresses flag containing [X] placeholder (docs template leak)', async () => {
    const content = [
      '### Sleep Debt Counter',
      '**Current Debt:** 7.0 hrs',
      '**Trend:** Decreasing ⬇️ (-0.5 from yesterday)',
      '- **Flag:** "⚠️ SLEEP PLATEAU: Debt stuck at [X] hrs for 2 weeks. Current paydown: [rate] hrs/night."',
    ].join('\n');
    (fs.readFileSync as jest.Mock).mockReturnValue(content);
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.flag).toBe('');
  });

  it('suppresses flag containing [rate] placeholder', async () => {
    const content = [
      '### Sleep Debt Counter',
      '**Current Debt:** 5.0 hrs',
      '**Trend:** Stable',
      '- **Flag:** "Paydown [rate] hrs/night insufficient."',
    ].join('\n');
    (fs.readFileSync as jest.Mock).mockReturnValue(content);
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.flag).toBe('');
  });

  it('suppresses flag containing [Tree] placeholder', async () => {
    const content = [
      '### Sleep Debt Counter',
      '**Current Debt:** 3.0 hrs',
      '**Trend:** Stable',
      '- **Flag:** "⚠️ CAPACITY WARNING: [Tree1] and [Tree2] nearing rust."',
    ].join('\n');
    (fs.readFileSync as jest.Mock).mockReturnValue(content);
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.flag).toBe('');
  });

  it('shows real flag with no placeholder tokens', async () => {
    const content = [
      '### Sleep Debt Counter',
      '**Current Debt:** 15.0 hrs',
      '**Trend:** Stable',
      '**Flag:** ⚠️ Critical debt sustained for 3 weeks — immediate intervention.',
    ].join('\n');
    (fs.readFileSync as jest.Mock).mockReturnValue(content);
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.flag).toContain('Critical debt');
  });

  it('reads trend from Sleep Debt Counter section, not earlier docs section', async () => {
    const content = [
      '#### Sleep Stagnation:',
      '**Trend:** Fake docs trend that must be ignored',
      '',
      '### Sleep Debt Counter',
      '**Current Debt:** 7.0 hrs',
      '**Trend:** Decreasing ⬇️ (-1.5 from yesterday, hard cap active)',
    ].join('\n');
    (fs.readFileSync as jest.Mock).mockReturnValue(content);
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.trend).toContain('Decreasing');
    expect(response.body.trend).not.toContain('Fake docs');
  });

  it('returns empty flag when no Sleep Debt Counter section exists', async () => {
    const content = '**Current:** 90.0/100\n**Status:** Normal ✅\n';
    (fs.readFileSync as jest.Mock).mockReturnValue(content);
    const response = await request(app).get('/api/vitality-status');
    expect(response.status).toBe(200);
    expect(response.body.flag).toBe('');
  });
});
