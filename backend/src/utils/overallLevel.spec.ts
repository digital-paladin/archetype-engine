import { calculateOverallLevelInfo } from './overallLevel';

describe('calculateOverallLevelInfo', () => {
  const birth = '1993-05-18';

  it('returns age 32 the day before birthday 2026', () => {
    const info = calculateOverallLevelInfo(birth, new Date('2026-05-17T12:00:00Z'));
    expect(info.level).toBe(32);
    expect(info.nextLevel).toBe(33);
    expect(info.nextLevelDate).toContain('2026');
    expect(info.daysRemaining).toBe(1);
  });

  it('returns age 33 on birthday 2026', () => {
    const info = calculateOverallLevelInfo(birth, new Date('2026-05-18T12:00:00Z'));
    expect(info.level).toBe(33);
    expect(info.nextLevel).toBe(34);
    expect(info.nextLevelDate).toContain('2027');
  });

  it('returns age 33 on Jul 13 2026 with days to next May 18', () => {
    const info = calculateOverallLevelInfo(birth, new Date('2026-07-13T12:00:00Z'));
    expect(info.level).toBe(33);
    expect(info.nextLevel).toBe(34);
    expect(info.daysRemaining).toBeGreaterThan(300);
    expect(info.daysRemaining).toBeLessThan(320);
  });
});
