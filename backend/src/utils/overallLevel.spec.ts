import { calculateOverallLevelInfo } from './overallLevel';

describe('calculateOverallLevelInfo', () => {
  // Synthetic fixture — do not use a real DOB (public-repo PII audit).
  const birth = '2000-06-15';

  it('returns age 25 the day before birthday 2026', () => {
    const info = calculateOverallLevelInfo(birth, new Date('2026-06-14T12:00:00Z'));
    expect(info.level).toBe(25);
    expect(info.nextLevel).toBe(26);
    expect(info.nextLevelDate).toContain('2026');
    expect(info.daysRemaining).toBe(1);
  });

  it('returns age 26 on birthday 2026', () => {
    const info = calculateOverallLevelInfo(birth, new Date('2026-06-15T12:00:00Z'));
    expect(info.level).toBe(26);
    expect(info.nextLevel).toBe(27);
    expect(info.nextLevelDate).toContain('2027');
  });

  it('returns age 26 mid-year with days to next birthday', () => {
    const info = calculateOverallLevelInfo(birth, new Date('2026-07-13T12:00:00Z'));
    expect(info.level).toBe(26);
    expect(info.nextLevel).toBe(27);
    expect(info.daysRemaining).toBeGreaterThan(300);
    expect(info.daysRemaining).toBeLessThan(340);
  });
});
