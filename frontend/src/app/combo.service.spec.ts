// combo.service.spec.ts
// Unit tests for ComboService — validates streak tracking, multiplier tiers,
// combo-broken flash, and loot guarantee flag.

import { ComboService } from './combo.service';

const LS_COUNT = 'dp-combo-count';
const LS_DATE  = 'dp-combo-last-date';

function toDateStr(d: Date): string {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const TODAY     = toDateStr(new Date());
const YESTERDAY = toDateStr(new Date(Date.now() - 86_400_000));
const TWO_DAYS_AGO = toDateStr(new Date(Date.now() - 2 * 86_400_000));

function makeService(count = 0, lastDate = ''): ComboService {
  localStorage.clear();
  if (count > 0) localStorage.setItem(LS_COUNT, String(count));
  if (lastDate) localStorage.setItem(LS_DATE, lastDate);
  return new ComboService();
}

// ─────────────────────────────────────────────────────────────
// Initial state
// ─────────────────────────────────────────────────────────────
describe('ComboService — initial state', () => {
  beforeEach(() => localStorage.clear());

  it('starts at 0 when localStorage is empty', () => {
    expect(makeService().comboCount()).toBe(0);
  });

  it('loads persisted count from localStorage', () => {
    localStorage.setItem(LS_COUNT, '5');
    expect(new ComboService().comboCount()).toBe(5);
  });

  it('comboBroken starts false', () => {
    expect(makeService().comboBroken()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// recordActivity() — first log ever
// ─────────────────────────────────────────────────────────────
describe('ComboService — first activity ever', () => {
  it('sets streak to 1', () => {
    const svc = makeService(0, '');
    svc.recordActivity();
    expect(svc.comboCount()).toBe(1);
  });

  it('persists count and today\'s date', () => {
    const svc = makeService(0, '');
    svc.recordActivity();
    expect(localStorage.getItem(LS_COUNT)).toBe('1');
    expect(localStorage.getItem(LS_DATE)).toBe(TODAY);
  });
});

// ─────────────────────────────────────────────────────────────
// recordActivity() — same day (already logged today)
// ─────────────────────────────────────────────────────────────
describe('ComboService — same-day re-log (idempotent)', () => {
  it('does not increment streak when already logged today', () => {
    const svc = makeService(3, TODAY);
    svc.recordActivity();
    expect(svc.comboCount()).toBe(3);
  });

  it('does not emit comboBroken when same day', () => {
    const svc = makeService(3, TODAY);
    svc.recordActivity();
    expect(svc.comboBroken()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// recordActivity() — consecutive day (streak growth)
// ─────────────────────────────────────────────────────────────
describe('ComboService — consecutive day (streak growth)', () => {
  it('increments streak by 1 when last log was yesterday', () => {
    const svc = makeService(4, YESTERDAY);
    svc.recordActivity();
    expect(svc.comboCount()).toBe(5);
  });

  it('persists new count', () => {
    const svc = makeService(4, YESTERDAY);
    svc.recordActivity();
    expect(localStorage.getItem(LS_COUNT)).toBe('5');
  });

  it('does not fire comboBroken on consecutive day', () => {
    const svc = makeService(4, YESTERDAY);
    svc.recordActivity();
    expect(svc.comboBroken()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// recordActivity() — gap day (streak broken)
// ─────────────────────────────────────────────────────────────
describe('ComboService — gap day (streak break)', () => {
  it('resets streak to 1 when gap exists (last log was 2+ days ago)', () => {
    const svc = makeService(7, TWO_DAYS_AGO);
    svc.recordActivity();
    expect(svc.comboCount()).toBe(1);
  });

  it('persists reset count of 1', () => {
    const svc = makeService(7, TWO_DAYS_AGO);
    svc.recordActivity();
    expect(localStorage.getItem(LS_COUNT)).toBe('1');
  });

  it('fires comboBroken signal true when streak > 1 breaks', () => {
    vi.useFakeTimers();
    const svc = makeService(5, TWO_DAYS_AGO);
    svc.recordActivity();
    expect(svc.comboBroken()).toBe(true);
    vi.useRealTimers();
  });

  it('comboBroken resets to false after 3 s', () => {
    vi.useFakeTimers();
    const svc = makeService(5, TWO_DAYS_AGO);
    svc.recordActivity();
    vi.advanceTimersByTime(3001);
    expect(svc.comboBroken()).toBe(false);
    vi.useRealTimers();
  });

  it('does NOT fire comboBroken when streak was 1 (no impressive streak to mourn)', () => {
    const svc = makeService(1, TWO_DAYS_AGO);
    svc.recordActivity();
    expect(svc.comboBroken()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// comboMultiplier computed signal
// ─────────────────────────────────────────────────────────────
describe('ComboService — comboMultiplier tiers', () => {
  const cases: Array<[number, number]> = [
    [0,  1.00],
    [1,  1.00],
    [2,  1.00],
    [3,  1.10],
    [4,  1.10],
    [5,  1.20],
    [6,  1.20],
    [7,  1.30],
    [15, 1.30],
  ];
  test.each(cases)('streak %i → multiplier %f', (streak, expected) => {
    expect(makeService(streak).comboMultiplier()).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────
// comboBonus computed signal
// ─────────────────────────────────────────────────────────────
describe('ComboService — comboBonus label', () => {
  it('empty string when no bonus active (streak < 3)', () => {
    expect(makeService(2).comboBonus()).toBe('');
  });

  it('+10% Combo XP at streak 3', () => {
    expect(makeService(3).comboBonus()).toBe('+10% Combo XP');
  });

  it('+20% Combo XP at streak 5', () => {
    expect(makeService(5).comboBonus()).toBe('+20% Combo XP');
  });

  it('+30% Combo XP at streak 7+', () => {
    expect(makeService(7).comboBonus()).toBe('+30% Combo XP');
  });
});

// ─────────────────────────────────────────────────────────────
// guaranteeLoot computed signal
// ─────────────────────────────────────────────────────────────
describe('ComboService — guaranteeLoot (7-day bonus)', () => {
  it('false below 7-day streak', () => {
    expect(makeService(6).guaranteeLoot()).toBe(false);
  });

  it('true at exactly 7-day streak', () => {
    expect(makeService(7).guaranteeLoot()).toBe(true);
  });

  it('true above 7-day streak', () => {
    expect(makeService(14).guaranteeLoot()).toBe(true);
  });
});
