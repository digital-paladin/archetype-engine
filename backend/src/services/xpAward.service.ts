import { getDataService } from './data/dataService';
import { XpCalculatorService } from './xpCalculator.service';

export interface XpAwardInput {
  className: string;
  xp: number;
}

export interface XpAwardResult {
  className: string;
  xp: number;
  newLevel: number;
  leveledUp: boolean;
}

/**
 * Maps raw category names and PascalCase award names onto character_stats.class_name.
 * Shared by activity logging and System quest resolution.
 */
export function toCanonicalClassName(rawClass: string): string {
  const map: Record<string, string> = {
    developer:              'Developer',
    warrior:                'Warrior',
    sage:                   'Sage',
    artist:                 'Artist',
    redteam:                'Redteamer',
    redteamer:              'Redteamer',
    financial:              'Financial Strategist',
    'financial-strategist': 'Financial Strategist',
    survivalist:            'Survivalist',
    prayer:                 'Sage',
    general:                'Sage',
    Developer:              'Developer',
    Warrior:                'Warrior',
    Sage:                   'Sage',
    Artist:                 'Artist',
    Redteamer:              'Redteamer',
    'Financial Strategist': 'Financial Strategist',
    Survivalist:            'Survivalist',
  };
  return map[rawClass] ?? (rawClass.charAt(0).toUpperCase() + rawClass.slice(1));
}

/**
 * Apply class XP to character_stats using XpCalculatorService.applyXPGain.
 * Positive awards can level up. Negative awards (quest penalties) floor at 0
 * and never increase level. The numbers come from the caller — System quests
 * pass the stored reward, never a client-supplied total.
 */
export async function persistClassXpAwards(
  userId: string,
  awards: XpAwardInput[],
  hooks?: { onLevelUp?: (info: { className: string; newLevel: number }) => void },
): Promise<XpAwardResult[]> {
  const meaningful = awards.filter(a => a.xp !== 0);
  if (meaningful.length === 0) return [];

  const db = getDataService();
  const calc = new XpCalculatorService();
  const allStats = await db.getCharacterStats(userId);
  const applied: XpAwardResult[] = [];

  for (const award of meaningful) {
    const canonClass = toCanonicalClassName(award.className);
    const current = allStats.find(s => s.class_name === canonClass);
    const lvl = current?.level ?? 1;
    const currXP = current?.current_xp ?? 0;
    const totalXP = current?.total_xp ?? 0;

    if (award.xp > 0) {
      const { newLevel, newCurrentXP, leveledUp } = calc.applyXPGain(lvl, currXP, award.xp);
      const nextTotal = totalXP + award.xp;
      await db.upsertCharacterStats(userId, {
        class_name: canonClass,
        level: newLevel,
        current_xp: newCurrentXP,
        total_xp: nextTotal,
      });
      if (current) {
        current.level = newLevel;
        current.current_xp = newCurrentXP;
        current.total_xp = nextTotal;
      } else {
        allStats.push({
          user_id: userId,
          class_name: canonClass,
          level: newLevel,
          current_xp: newCurrentXP,
          total_xp: nextTotal,
        });
      }
      if (leveledUp) hooks?.onLevelUp?.({ className: canonClass, newLevel });
      applied.push({ className: canonClass, xp: award.xp, newLevel, leveledUp });
      continue;
    }

    const drop = Math.min(currXP, Math.abs(award.xp));
    const newCurrentXP = currXP - drop;
    const nextTotal = Math.max(0, totalXP - drop);
    await db.upsertCharacterStats(userId, {
      class_name: canonClass,
      level: lvl,
      current_xp: newCurrentXP,
      total_xp: nextTotal,
    });
    if (current) {
      current.current_xp = newCurrentXP;
      current.total_xp = nextTotal;
    } else {
      allStats.push({
        user_id: userId,
        class_name: canonClass,
        level: lvl,
        current_xp: newCurrentXP,
        total_xp: nextTotal,
      });
    }
    applied.push({ className: canonClass, xp: -drop, newLevel: lvl, leveledUp: false });
  }

  return applied;
}
