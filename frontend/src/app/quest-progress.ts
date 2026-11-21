/**
 * Read-only progress cues for quests and class levels.
 * Objective counts and "XP to level N" are display math only.
 * They do not change how XP is awarded or which curve a class uses.
 */

export interface ObjectiveProgress {
  done?: boolean;
  progress?: number;
  target?: number;
}

export interface QuestProgress {
  completed: number;
  total: number;
  /** 0–100, from completed objectives over the total. */
  percent: number;
  /** For example, "2 of 3 objectives". */
  label: string;
  /** True when exactly one objective is still open. */
  nearMiss: boolean;
  nearMissLabel: string | null;
}

export interface DatedQuest {
  kind?: string | null;
  status?: string | null;
  scheduledFor?: string | null;
}

const CHICAGO = 'America/Chicago';

/** Civil date in America/Chicago, YYYY-MM-DD. */
export function chicagoDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find(part => part.type === 'year')?.value ?? '0000';
  const month = parts.find(part => part.type === 'month')?.value ?? '01';
  const day = parts.find(part => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/** An objective is complete when the server says so, or progress has reached its target. */
export function objectiveIsDone(objective: ObjectiveProgress): boolean {
  if (objective.done) return true;
  const target = objective.target ?? 0;
  if (target <= 0) return false;
  return (objective.progress ?? 0) >= target;
}

export function questObjectiveProgress(objectives: readonly ObjectiveProgress[] | null | undefined): QuestProgress {
  const list = objectives ?? [];
  const total = list.length;
  const completed = list.filter(objectiveIsDone).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  const noun = total === 1 ? 'objective' : 'objectives';
  const remaining = total - completed;
  const nearMiss = total > 0 && remaining === 1;
  return {
    completed,
    total,
    percent,
    label: `${completed} of ${total} ${noun}`,
    nearMiss,
    nearMissLabel: nearMiss ? '1 step to clear' : null,
  };
}

/**
 * True when every daily quest scheduled for `today` is cleared.
 * A day with no daily quests is not reported as done.
 * Other kinds (acquisition, emergency, hidden) do not count.
 */
export function isDoneForToday(quests: readonly DatedQuest[], today: string): boolean {
  const todays = quests.filter(quest => quest.kind === 'daily' && quest.scheduledFor === today);
  return todays.length > 0 && todays.every(quest => quest.status === 'cleared');
}

/**
 * XP still inside the current level.
 * `xpToNextLevel` is the threshold the caller already has — from
 * `/api/character/stats` (`xpToNextLevel`) or from LevelProgressionService
 * (`calculateXPForLevel` / `xpForNextLevel`). This subtracts; it does not
 * apply a curve of its own.
 */
export function xpRemaining(currentXp: number, xpToNextLevel: number): number {
  const current = Number.isFinite(currentXp) ? currentXp : 0;
  const threshold = Number.isFinite(xpToNextLevel) ? xpToNextLevel : 0;
  return Math.max(0, threshold - current);
}

/** "750 XP to level 9" — next to a class level. */
export function formatXpToNextLevel(level: number, currentXp: number, xpToNextLevel: number): string {
  const remaining = Math.round(xpRemaining(currentXp, xpToNextLevel));
  const nextLevel = level + 1;
  return `${remaining.toLocaleString('en-US')} XP to level ${nextLevel}`;
}
