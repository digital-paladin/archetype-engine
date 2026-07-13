import { OverallLevelInfo } from '../models/character.model';

/**
 * Overall Character Level = chronological age from PLAYER_BIRTH_DATE.
 * Default matches Digital Paladin birthdate (1993-05-18).
 */
export function calculateOverallLevelInfo(
  birthDateStr: string = process.env.PLAYER_BIRTH_DATE || '1993-05-18',
  now: Date = new Date()
): OverallLevelInfo {
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
