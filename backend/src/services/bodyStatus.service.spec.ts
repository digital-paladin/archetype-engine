import {
  isBodyStatusHealed,
  getActiveBodyStatuses,
  maxVitalityPenalty,
  BODY_STATUS_VITALITY_PENALTY,
} from './bodyStatus.service';
import { BodyStatusRow, IDataService } from './data/IDataService';

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function makeRow(overrides: Partial<BodyStatusRow> = {}): BodyStatusRow {
  return {
    id: 'row-1',
    body_part: 'left-knee',
    type: 'injury',
    severity: 'moderate',
    name: 'Test injury',
    start_date: daysAgo(1),
    ...overrides,
  };
}

describe('isBodyStatusHealed', () => {
  it('never auto-heals when no estimated_recovery_days is set', () => {
    expect(isBodyStatusHealed(makeRow({ start_date: daysAgo(9999) }))).toBe(false);
  });

  it('is not healed while daysSinceStart < estimated_recovery_days', () => {
    expect(isBodyStatusHealed(makeRow({ start_date: daysAgo(2), estimated_recovery_days: 7 }))).toBe(false);
  });

  it('is healed once daysSinceStart >= estimated_recovery_days', () => {
    expect(isBodyStatusHealed(makeRow({ start_date: daysAgo(7), estimated_recovery_days: 7 }))).toBe(true);
    expect(isBodyStatusHealed(makeRow({ start_date: daysAgo(10), estimated_recovery_days: 7 }))).toBe(true);
  });
});

describe('getActiveBodyStatuses', () => {
  it('filters out healed rows, keeps active ones', async () => {
    const rows: BodyStatusRow[] = [
      makeRow({ id: 'a', start_date: daysAgo(1), estimated_recovery_days: 7 }),   // active
      makeRow({ id: 'b', start_date: daysAgo(30), estimated_recovery_days: 7 }),  // healed
      makeRow({ id: 'c', start_date: daysAgo(9999) }),                            // no recovery → always active
    ];
    const db = { getBodyStatuses: jest.fn().mockResolvedValue(rows) } as unknown as IDataService;

    const active = await getActiveBodyStatuses('user-1', db);

    expect(active.map(r => r.id)).toEqual(['a', 'c']);
    expect(db.getBodyStatuses).toHaveBeenCalledWith('user-1');
  });

  it('returns [] when there are no rows', async () => {
    const db = { getBodyStatuses: jest.fn().mockResolvedValue([]) } as unknown as IDataService;
    expect(await getActiveBodyStatuses('user-1', db)).toEqual([]);
  });
});

describe('maxVitalityPenalty', () => {
  it('returns 0 for an empty list', () => {
    expect(maxVitalityPenalty([])).toBe(0);
  });

  it('maps each severity to its configured penalty', () => {
    expect(maxVitalityPenalty([makeRow({ severity: 'minor' })])).toBe(BODY_STATUS_VITALITY_PENALTY.minor);
    expect(maxVitalityPenalty([makeRow({ severity: 'moderate' })])).toBe(BODY_STATUS_VITALITY_PENALTY.moderate);
    expect(maxVitalityPenalty([makeRow({ severity: 'severe' })])).toBe(BODY_STATUS_VITALITY_PENALTY.severe);
    expect(maxVitalityPenalty([makeRow({ severity: 'critical' })])).toBe(BODY_STATUS_VITALITY_PENALTY.critical);
  });

  it('takes the worst active severity — not cumulative', () => {
    const rows = [
      makeRow({ id: 'a', severity: 'minor' }),
      makeRow({ id: 'b', severity: 'critical' }),
      makeRow({ id: 'c', severity: 'moderate' }),
    ];
    expect(maxVitalityPenalty(rows)).toBe(BODY_STATUS_VITALITY_PENALTY.critical);
  });
});
