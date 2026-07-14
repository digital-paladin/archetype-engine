/**
 * onboarding.service — unit tests (no Supabase)
 */
import { isValidBirthDate } from './onboarding.service';

describe('isValidBirthDate', () => {
  it('accepts a plausible past date', () => {
    expect(isValidBirthDate('1995-03-01')).toBe(true);
  });

  it('rejects malformed strings', () => {
    expect(isValidBirthDate('95-03-01')).toBe(false);
    expect(isValidBirthDate('not-a-date')).toBe(false);
    expect(isValidBirthDate('')).toBe(false);
  });

  it('rejects future dates', () => {
    expect(isValidBirthDate('2099-01-01')).toBe(false);
  });

  it('rejects pre-1900', () => {
    expect(isValidBirthDate('1899-12-31')).toBe(false);
  });
});
