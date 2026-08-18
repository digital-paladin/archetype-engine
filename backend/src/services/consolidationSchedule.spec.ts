import {
  consolidationUserIds,
  previousUtcDate,
  utcDateStr,
  xpHistoryCoversDate,
} from './consolidationSchedule';

describe('UTC consolidation schedule', () => {
  it('previousUtcDate is the UTC calendar day that just ended', () => {
    expect(previousUtcDate(new Date('2026-08-18T00:05:00.000Z'))).toBe('2026-08-17');
    expect(previousUtcDate(new Date('2026-08-17T23:59:59.000Z'))).toBe('2026-08-16');
    expect(previousUtcDate(new Date('2026-03-01T00:05:00.000Z'))).toBe('2026-02-28');
    expect(previousUtcDate(new Date('2026-01-01T00:05:00.000Z'))).toBe('2025-12-31');
  });

  it('utcDateStr is YYYY-MM-DD in UTC not local', () => {
    expect(utcDateStr(new Date('2026-08-18T00:05:00.000Z'))).toBe('2026-08-18');
  });

  it('xpHistoryCoversDate matches the UTC date even with timestamps', () => {
    expect(xpHistoryCoversDate(['2026-08-17'], '2026-08-17')).toBe(true);
    expect(xpHistoryCoversDate(['2026-08-17T00:00:00+00:00'], '2026-08-17')).toBe(true);
    expect(xpHistoryCoversDate(['2026-08-16'], '2026-08-17')).toBe(false);
  });

  it('includes owner, unions profile+stats, excludes demo', () => {
    expect(consolidationUserIds(
      ['p1', 'shared'],
      ['s1', 'shared'],
      { ownerUserId: 'owner', demoUserId: 'demo' },
    ).sort()).toEqual(['owner', 'p1', 's1', 'shared']);

    expect(consolidationUserIds(['demo'], ['demo'], { demoUserId: 'demo' })).toEqual([]);
  });
});
