import {
  computeRollingSleepDebt,
  nightlyDeficit,
  selectNightsInWindow,
  SLEEP_DEBT_WINDOW_DAYS,
  sleepTrendFromDebt,
  syncSleepDebtFromJournal,
  vitalityFromSleepDebt,
} from './sleepDebt.service';

describe('nightlyDeficit', () => {
  it('is 0 for hours >= 7.5', () => {
    expect(nightlyDeficit(7.5)).toBe(0);
    expect(nightlyDeficit(9)).toBe(0);
  });

  it('is 7.5 - hours for a short night', () => {
    expect(nightlyDeficit(5.5)).toBe(2);
    expect(nightlyDeficit(3.4)).toBe(4.1);
  });

  it('is 0 for hours <= 0 (no data, does not default to 7.5)', () => {
    expect(nightlyDeficit(0)).toBe(0);
  });
});

describe('vitalityFromSleepDebt / trend', () => {
  it('is 100 at debt <= 5 and decays 3 pts per extra hour', () => {
    expect(vitalityFromSleepDebt(5)).toBe(100);
    expect(vitalityFromSleepDebt(12.23)).toBeCloseTo(78.3, 1);
  });

  it('classifies trend with 0.05 hysteresis', () => {
    expect(sleepTrendFromDebt(11.54, 11.54)).toBe('Stable');
    expect(sleepTrendFromDebt(11.54, 10.54)).toBe('Decreased');
    expect(sleepTrendFromDebt(11.54, 13.54)).toBe('Increased');
  });
});

describe('selectNightsInWindow', () => {
  const nights = [
    { date: '2026-08-01', hours: 8, score: 90 },   // outside 14-day window ending 08-17
    { date: '2026-08-10', hours: 8, score: 80 },
    { date: '2026-08-11', hours: 5.5, score: 70 },
    { date: '2026-08-12', hours: 0, score: 0 },    // no data, excluded
    { date: '2026-08-16', hours: 10.2, score: 82 },
    { date: '2026-08-17', hours: 0, score: 0 },    // no data, excluded
  ];

  it('keeps only nights with real hours inside the trailing window, sorted oldest first', () => {
    const picked = selectNightsInWindow(nights, { today: '2026-08-17' });
    expect(picked.map(n => n.date)).toEqual(['2026-08-10', '2026-08-11', '2026-08-16']);
  });

  it('respects a custom window size', () => {
    const picked = selectNightsInWindow(nights, { today: '2026-08-17', windowDays: 7 });
    expect(picked.map(n => n.date)).toEqual(['2026-08-11', '2026-08-16']);
  });
});

describe('computeRollingSleepDebt', () => {
  it('sums deficits over the 14-day window and ignores surplus/no-data nights', () => {
    const nights = [
      { date: '2026-08-10', hours: 8, score: 80 },     // surplus, contributes 0
      { date: '2026-08-11', hours: 5.5, score: 70 },   // deficit 2.0
      { date: '2026-08-12', hours: 0, score: 0 },      // no data
      { date: '2026-08-16', hours: 6.3, score: 85 },   // deficit 1.2
    ];
    expect(computeRollingSleepDebt(nights, { today: '2026-08-17' })).toBe(3.2);
  });

  it('is 0 when all nights in window meet or exceed baseline', () => {
    const nights = [{ date: '2026-08-17', hours: 8, score: 95 }];
    expect(computeRollingSleepDebt(nights, { today: '2026-08-17' })).toBe(0);
  });

  it('window is 14 calendar days by default', () => {
    expect(SLEEP_DEBT_WINDOW_DAYS).toBe(14);
  });
});

describe('syncSleepDebtFromJournal', () => {
  it('recomputes debt fresh from the trailing 14-day window and writes it', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const db = {
      getCharacterProfile: jest.fn().mockResolvedValue({
        sleep_debt: 11.54,
        vitality: 80,
        sleep_trend: 'Stable',
        rpg_stats: { squat: 225 },
      }),
      listJournalSleepRange: jest.fn().mockResolvedValue([
        { date: '2026-08-11', hours: 5.5, score: 70 },
        { date: '2026-08-16', hours: 6.3, score: 85 },
      ]),
      upsertCharacterProfile: upsert,
    };

    const result = await syncSleepDebtFromJournal('user-1', db, '2026-08-17');
    expect(result?.nights).toHaveLength(2);
    expect(result?.sleepDebt).toBe(3.2); // (7.5-5.5) + (7.5-6.3) = 2.0 + 1.2
    expect(result?.sleepTrend).toBe('Decreased');
    expect(upsert).toHaveBeenCalledTimes(1);
    const patch = upsert.mock.calls[0][1];
    expect(patch.sleep_debt).toBe(3.2);
    expect(patch.vitality).toBe(100);
    expect(db.listJournalSleepRange).toHaveBeenCalledWith('user-1', '2026-08-04', '2026-08-17');
  });

  it('is 0 when there are no logged nights in the window', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const result = await syncSleepDebtFromJournal('user-1', {
      getCharacterProfile: jest.fn().mockResolvedValue({ sleep_debt: 11.54 }),
      listJournalSleepRange: jest.fn().mockResolvedValue([]),
      upsertCharacterProfile: upsert,
    }, '2026-08-17');
    expect(result?.sleepDebt).toBe(0);
    expect(result?.vitality).toBe(100);
    expect(upsert).toHaveBeenCalledWith('user-1', { vitality: 100, sleep_debt: 0, sleep_trend: 'Decreased' });
  });

  it('skips when there is no character_profile row', async () => {
    const result = await syncSleepDebtFromJournal('user-1', {
      getCharacterProfile: jest.fn().mockResolvedValue(null),
      listJournalSleepRange: jest.fn(),
      upsertCharacterProfile: jest.fn(),
    });
    expect(result).toBeNull();
  });
});
