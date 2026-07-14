import { OverallLevelInfo } from '../models/character.model';

/**
 * Overall Character Level = chronological age.
 * Prefer per-user `users.birth_date` (SaaS). Env `PLAYER_BIRTH_DATE` is legacy single-tenant fallback.
 * Do not commit a real DOB to the public repo.
 */
export function calculateOverallLevelInfo(
  birthDateStr?: string,
  now: Date = new Date()
): OverallLevelInfo {
  const resolved =
    birthDateStr ||
    process.env.PLAYER_BIRTH_DATE ||
    '2000-01-01';

  if (!birthDateStr && !process.env.PLAYER_BIRTH_DATE) {
    console.warn(
      '[overallLevel] No users.birth_date or PLAYER_BIRTH_DATE — using placeholder 2000-01-01.'
    );
  }

  const birthDate = new Date(`${resolved}T00:00:00Z`);

  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() >= birthDate.getUTCDate());

  if (!hasHadBirthdayThisYear) {
    age--;
  }

  const [, birthMonth, birthDay] = resolved.split('-');
  const nextBirthdayYear = hasHadBirthdayThisYear ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const nextBirthday = new Date(`${nextBirthdayYear}-${birthMonth}-${birthDay}T00:00:00Z`);

  const diffTime = nextBirthday.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

  const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
  const nextLevelDateStr = nextBirthday.toLocaleDateString('en-US', dateOptions);

  return {
    level: age,
    nextLevel: age + 1,
    nextLevelDate: nextLevelDateStr,
    daysRemaining,
  };
}
