import {
  combinedExtensionBonusPct,
  computeExtensionStreak,
  computeRollingSleepDebt,
  extensionStreakBonusPct,
  nightlyDeficit,
  nightlyExtensionBonusPct,
  nightlySurplus,
  selectNightsInWindow,
  SLEEP_DEBT_WINDOW_DAYS,
  SLEEP_EXTENSION_LOOKBACK_DAYS,
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
  it('follows the 3-segment curve (100 ≤2h, −2/h to 5h, −3/h above 5h)', () => {
    expect(vitalityFromSleepDebt(0)).toBe(100);
    expect(vitalityFromSleepDebt(2)).toBe(100);
    expect(vitalityFromSleepDebt(3.5)).toBe(97);
    expect(vitalityFromSleepDebt(5)).toBe(94);
    expect(vitalityFromSleepDebt(10)).toBe(79);
    expect(vitalityFromSleepDebt(12.23)).toBeCloseTo(72.3, 1);
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
    expect(patch.vitality).toBe(97.6);
    expect(db.listJournalSleepRange).toHaveBeenCalledWith('user-1', '2026-07-19', '2026-08-17');
    expect(patch.sleep_extension_streak).toBe(0);
    expect(result?.extensionStreak).toBe(0);
    expect(result?.extensionBonusPct).toBe(0);
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
    expect(upsert).toHaveBeenCalledWith('user-1', {
      vitality: 100,
      sleep_debt: 0,
      sleep_trend: 'Decreased',
      sleep_extension_streak: 0,
    });
  });

  it('skips when there is no character_profile row', async () => {
    const result = await syncSleepDebtFromJournal('user-1', {
      getCharacterProfile: jest.fn().mockResolvedValue(null),
      listJournalSleepRange: jest.fn(),
      upsertCharacterProfile: jest.fn(),
    });
    expect(result).toBeNull();
  });

  it('persists a 5-night ≥9h streak and a nightly surplus bonus', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const nights = [
      { date: '2026-08-13', hours: 9.0, score: 90 },
      { date: '2026-08-14', hours: 9.2, score: 88 },
      { date: '2026-08-15', hours: 9.5, score: 91 },
      { date: '2026-08-16', hours: 10.0, score: 85 },
      { date: '2026-08-17', hours: 9.5, score: 92 },
    ];
    const result = await syncSleepDebtFromJournal('user-1', {
      getCharacterProfile: jest.fn().mockResolvedValue({ sleep_debt: 0 }),
      listJournalSleepRange: jest.fn().mockResolvedValue(nights),
      upsertCharacterProfile: upsert,
    }, '2026-08-17');
    expect(result?.extensionStreak).toBe(5);
    // 9.5h → 2.0 surplus → +10% nightly; 5-night streak → +5%; combined 15.5%
    expect(result?.extensionBonusPct).toBe(15.5);
    expect(upsert.mock.calls[0][1].sleep_extension_streak).toBe(5);
  });
});

describe('nightlySurplus / nightlyExtensionBonusPct', () => {
  it('is 0 at or below the 7.5h baseline', () => {
    expect(nightlySurplus(7.5)).toBe(0);
    expect(nightlySurplus(6)).toBe(0);
    expect(nightlyExtensionBonusPct(7.5)).toBe(0);
  });

  it('scales +5% per surplus hour and caps at 2h / +10%', () => {
    expect(nightlySurplus(8.5)).toBe(1);
    expect(nightlyExtensionBonusPct(8.5)).toBe(5);
    expect(nightlySurplus(9.5)).toBe(2);
    expect(nightlyExtensionBonusPct(9.5)).toBe(10);
    expect(nightlySurplus(12)).toBe(2);
    expect(nightlyExtensionBonusPct(12)).toBe(10);
  });
});

describe('computeExtensionStreak / extensionStreakBonusPct', () => {
  it('counts consecutive ≥9h nights ending today and breaks on a gap', () => {
    const nights = [
      { date: '2026-08-14', hours: 9 },
      { date: '2026-08-15', hours: 9.2 },
      { date: '2026-08-16', hours: 7.0 }, // break
      { date: '2026-08-17', hours: 9.5 },
    ];
    expect(computeExtensionStreak(nights, { today: '2026-08-17' })).toBe(1);
  });

  it('is 0 when today is missing or below threshold', () => {
    expect(computeExtensionStreak([{ date: '2026-08-16', hours: 10 }], { today: '2026-08-17' })).toBe(0);
  });

  it('tiers 0 / 5 / 10 / 15 at 4, 5, 10, 14 nights', () => {
    expect(extensionStreakBonusPct(4)).toBe(0);
    expect(extensionStreakBonusPct(5)).toBe(5);
    expect(extensionStreakBonusPct(9)).toBe(5);
    expect(extensionStreakBonusPct(10)).toBe(10);
    expect(extensionStreakBonusPct(13)).toBe(10);
    expect(extensionStreakBonusPct(14)).toBe(15);
  });

  it('lookback default is 30 days', () => {
    expect(SLEEP_EXTENSION_LOOKBACK_DAYS).toBe(30);
  });
});

describe('combinedExtensionBonusPct', () => {
  it('multiplies nightly and streak layers', () => {
    // 9.5h → +10%; 14-night streak → +15%; 1.10 * 1.15 − 1 = 26.5%
    expect(combinedExtensionBonusPct(9.5, 14)).toBe(26.5);
    expect(combinedExtensionBonusPct(7.5, 14)).toBe(15);
    expect(combinedExtensionBonusPct(9.5, 0)).toBe(10);
  });
});
