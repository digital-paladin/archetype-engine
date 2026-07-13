import { OverallLevelInfo } from '../models/character.model';

/**
 * Overall Character Level = chronological age from PLAYER_BIRTH_DATE (YYYY-MM-DD).
 * Set PLAYER_BIRTH_DATE in Railway / backend .env — do not commit real DOB to the public repo.
 */
export function calculateOverallLevelInfo(
  birthDateStr: string = process.env.PLAYER_BIRTH_DATE || '2000-01-01',
  now: Date = new Date()
): OverallLevelInfo {
  if (!process.env.PLAYER_BIRTH_DATE) {
    console.warn(
      '[overallLevel] PLAYER_BIRTH_DATE unset — using placeholder 2000-01-01. Set env on Railway.'
    );
  }

  const birthDate = new Date(`${birthDateStr}T00:00:00Z`);

  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() >= birthDate.getUTCDate());

  if (!hasHadBirthdayThisYear) {
    age--;
  }

  const [, birthMonth, birthDay] = birthDateStr.split('-');
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
