/**
 * How a social event earns XP.
 *
 * Skill XP (Social Dynamics and/or Charisma) is paid only when the log names
 * a skill on that tree AND includes a non-empty post-event reflection.
 * One event pays both trees only when it names a skill for each.
 * Casual time, with no recognized skill goal, pays a flat amount capped
 * per week (Sunday, America/Chicago) and credits that amount to one tree.
 * An interval that overlaps a recorded work or training block pays 0 and is
 * flagged. There is no prospective calendar — see loadCalendarBlocks().
 */

import type { ActivityEntry } from './data/IDataService';
import { getDataService } from './data/dataService';
import { isTrainingActivity } from './recoveryQuests.service';
import {
  fetchTogglEntriesForChicagoDay,
  isTogglConfigured,
  redactTogglSecret,
  togglEntryInterval,
  type TogglTimeEntry,
} from './togglTrack.service';
import { mapTogglProjectOrTags } from './togglActivityMap';
import { zoneOffset } from './wearableActivityXp.service';
import { chicagoDay } from './activityOccurredAt';
import {
  CASUAL_SOCIAL_DEFAULT_TREE,
  CASUAL_SOCIAL_WEEKLY_CAP,
  CASUAL_SOCIAL_XP,
  CASUAL_TREE_KEYWORDS,
  CHARISMA_CLASS,
  isDeepWorkActivityType,
  isSocialActivityType,
  skillGoalsFromActivityType,
  SOCIAL_DYNAMICS_CLASS,
  SOCIAL_SKILL_BASE_XP,
  SOCIAL_SKILL_DURATION_MULTIPLIER,
  SOCIAL_SKILLS,
  SOCIAL_TREE_CLASS,
  type SocialSkillDefinition,
  type SocialTreeId,
} from '../config/socialXp.config';

export interface ScheduleBlock {
  kind: 'work' | 'training';
  startMs: number;
  endMs: number;
  source: 'activity-log' | 'toggl' | 'calendar';
  sourceId?: string;
  label?: string;
}

export interface SocialScheduleFlag {
  kind: 'work' | 'training';
  source: ScheduleBlock['source'];
  sourceId?: string;
  label?: string;
}

export interface NamedSocialSkill {
  id: string;
  label: string;
  tree: SocialTreeId;
}

export interface SocialTreeAward {
  className: typeof SOCIAL_DYNAMICS_CLASS | typeof CHARISMA_CLASS;
  tree: SocialTreeId;
  xp: number;
  skills: NamedSocialSkill[];
}

export type SocialXpMode = 'skill' | 'casual' | 'none';

export interface SocialXpEvaluation {
  mode: SocialXpMode;
  awards: SocialTreeAward[];
  totalXp: number;
  flags: SocialScheduleFlag[];
  reasons: string[];
  /** Casual XP this event grants after the weekly cap. 0 unless mode is casual. */
  casualXp: number;
  /** Flat casual XP the cap withheld. */
  casualXpWithheld: number;
}

export interface SocialXpInput {
  activityType?: string;
  startMs: number | null;
  endMs: number | null;
  durationMinutes: number | null;
  skillGoals?: unknown;
  reflection?: unknown;
  /** Free-text activity label or description. Used only to pick a casual tree. */
  label?: unknown;
  /** User notes. Used only to pick a casual tree. */
  notes?: unknown;
  scheduleBlocks?: readonly ScheduleBlock[];
  casualXpAwardedThisWeek?: number;
}

/** Newest activity_log rows inspected for a work or training interval. */
export const SOCIAL_SCHEDULE_LOOKBACK = 2000;

const TREE_ORDER: readonly SocialTreeId[] = ['social-dynamics', 'charisma'];

const CASUAL_TAG_SOURCE = '\\[social-xp:casual:(\\d+)\\]';

function normalizePhrase(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

const SKILL_INDEX: Map<string, SocialSkillDefinition> = new Map();
for (const skill of SOCIAL_SKILLS) {
  const phrases = [skill.id, skill.label, ...skill.aliases];
  for (const phrase of phrases) {
    SKILL_INDEX.set(normalizePhrase(phrase), skill);
  }
}

export function parseSkillGoalInput(value: unknown): string[] {
  const raw: string[] = [];
  if (typeof value === 'string') raw.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') raw.push(item);
    }
  }
  const goals: string[] = [];
  for (const item of raw) {
    for (const part of item.split(',')) {
      const trimmed = part.trim();
      if (trimmed) goals.push(trimmed);
    }
  }
  return goals;
}

export function readDurationMinutes(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function resolveSocialInterval(
  occurredAtIso: string,
  durationMinutes: number | null,
  endIso?: string | null,
): { startMs: number | null; endMs: number | null; durationMinutes: number | null } {
  const startMs = Date.parse(occurredAtIso);
  const start = Number.isNaN(startMs) ? null : startMs;
  let end: number | null = null;
  if (typeof endIso === 'string' && endIso.trim()) {
    const parsed = Date.parse(endIso);
    if (!Number.isNaN(parsed)) end = parsed;
  }
  if (end == null && start != null && durationMinutes != null) {
    end = start + durationMinutes * 60_000;
  }
  return { startMs: start, endMs: end, durationMinutes };
}

/** Practice XP for one tree. Missing or non-positive duration pays the base only. */
export function socialSkillXp(durationMinutes: number | null | undefined): number {
  let xp = SOCIAL_SKILL_BASE_XP;
  if (durationMinutes != null && durationMinutes > 0) {
    xp += Math.floor(durationMinutes * SOCIAL_SKILL_DURATION_MULTIPLIER);
  }
  return xp;
}

export function reflectionText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Any non-whitespace note counts. There is no character minimum. */
export function reflectionQualifies(value: unknown): boolean {
  return reflectionText(value).length > 0;
}

/**
 * Prospective work/training calendar.
 *
 * TODO(social-schedule): Nothing in the engine fills this. System quests
 * store `scheduledFor` as a civil date plus a `training` flag, not a start
 * and end — do not stretch that date across the day. Toggl entries that do
 * not map to a workout are not labeled work, so they are not blocks either.
 * Recorded activity_log rows (deep work and training, with a timestamp and a
 * duration) and workout-mapped Toggl entries are the intervals that exist
 * today; collectScheduleBlocks() reads those. Keep returning [] here until
 * a real calendar is wired in.
 */
export function loadCalendarBlocks(): ScheduleBlock[] {
  return [];
}

function durationMsFromHours(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 60 * 60 * 1000);
}

export function scheduleBlocksFromActivityLog(
  entries: ReadonlyArray<Pick<ActivityEntry, 'id' | 'logged_at' | 'activity_type'> & { duration_hours?: unknown }>,
): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = [];
  for (const entry of entries) {
    if (!entry.logged_at || isSocialActivityType(entry.activity_type)) continue;
    const startMs = Date.parse(entry.logged_at);
    const length = durationMsFromHours(entry.duration_hours);
    if (Number.isNaN(startMs) || length == null) continue;
    const kind: ScheduleBlock['kind'] | null = isTrainingActivity(entry.activity_type)
      ? 'training'
      : isDeepWorkActivityType(entry.activity_type)
        ? 'work'
        : null;
    if (!kind) continue;
    blocks.push({
      kind,
      startMs,
      endMs: startMs + length,
      source: 'activity-log',
      sourceId: entry.id,
      label: entry.activity_type,
    });
  }
  return blocks;
}

/**
 * Workout-mapped Toggl entries are training blocks. Unmapped entries are
 * left out on purpose — the engine does not know which of them are work.
 */
export function scheduleBlocksFromToggl(
  entries: readonly TogglTimeEntry[],
  now: Date,
): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = [];
  for (const entry of entries) {
    const mapped = mapTogglProjectOrTags(entry.projectName, entry.tags);
    if (!mapped) continue;
    const span = togglEntryInterval(entry, now);
    if (!span) continue;
    blocks.push({
      kind: 'training',
      startMs: span.startMs,
      endMs: span.endMs,
      source: 'toggl',
      sourceId: entry.id,
      label: mapped.label,
    });
  }
  return blocks;
}

export function collectScheduleBlocks(sources: {
  activityLog?: Parameters<typeof scheduleBlocksFromActivityLog>[0];
  togglEntries?: readonly TogglTimeEntry[];
  calendarBlocks?: readonly ScheduleBlock[];
  now?: Date;
}): ScheduleBlock[] {
  const now = sources.now ?? new Date();
  return [
    ...scheduleBlocksFromActivityLog(sources.activityLog ?? []),
    ...scheduleBlocksFromToggl(sources.togglEntries ?? [], now),
    ...(sources.calendarBlocks ?? loadCalendarBlocks()),
  ];
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function overlappingBlocks(
  startMs: number | null,
  endMs: number | null,
  blocks: readonly ScheduleBlock[],
): ScheduleBlock[] {
  if (startMs == null || endMs == null || endMs <= startMs) return [];
  return blocks.filter(block =>
    block.endMs > block.startMs
    && intervalsOverlap(startMs, endMs, block.startMs, block.endMs));
}

export function casualXpFromNotes(notes: string | null | undefined): number {
  if (!notes) return 0;
  let sum = 0;
  for (const match of notes.matchAll(new RegExp(CASUAL_TAG_SOURCE, 'g'))) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return sum;
}

export interface ChicagoWeek {
  /** YYYY-MM-DD of the Sunday in America/Chicago. */
  startDate: string;
  startMs: number;
  endMs: number;
}

function shiftIsoDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Week containing `instant`. Sunday 00:00 America/Chicago, half-open. */
export function chicagoWeekContaining(instant: Date): ChicagoWeek {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(instant);
  const year = parts.find(p => p.type === 'year')?.value ?? '1970';
  const month = parts.find(p => p.type === 'month')?.value ?? '01';
  const day = parts.find(p => p.type === 'day')?.value ?? '01';
  const weekday = WEEKDAY_INDEX[parts.find(p => p.type === 'weekday')?.value ?? 'Sun'] ?? 0;
  const date = `${year}-${month}-${day}`;
  const daysBack = weekday;
  const startDate = shiftIsoDate(date, -daysBack);
  const endDate = shiftIsoDate(startDate, 7);
  const startMs = Date.parse(`${startDate}T00:00:00${zoneOffset(startDate, '00:00')}`);
  const endMs = Date.parse(`${endDate}T00:00:00${zoneOffset(endDate, '00:00')}`);
  return { startDate, startMs, endMs };
}

export function casualXpAwardedInWeek(
  entries: readonly ActivityEntry[],
  weekStartMs: number,
  weekEndMs: number,
): number {
  let sum = 0;
  for (const entry of entries) {
    if (!entry.logged_at) continue;
    const t = Date.parse(entry.logged_at);
    if (Number.isNaN(t) || t < weekStartMs || t >= weekEndMs) continue;
    sum += casualXpFromNotes(entry.notes);
  }
  return sum;
}

function phraseInText(text: string, keyword: string): boolean {
  const hay = normalizePhrase(text);
  const needle = normalizePhrase(keyword);
  if (!hay || !needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(hay);
}

export interface CasualTreeInference {
  tree: SocialTreeId;
  /** False when nothing matched, or the two trees tied on phrase length. */
  inferred: boolean;
  matched?: string;
}

/**
 * Pick the tree for casual XP from activity text. Longest keyword wins.
 * No match, or an equal-length match on both trees, uses the default tree.
 */
export function inferCasualTree(texts: readonly unknown[]): CasualTreeInference {
  let bestLen = 0;
  const trees = new Set<SocialTreeId>();
  let matched = '';
  for (const value of texts) {
    if (typeof value !== 'string' || !value.trim()) continue;
    for (const tree of TREE_ORDER) {
      for (const keyword of CASUAL_TREE_KEYWORDS[tree]) {
        if (!phraseInText(value, keyword)) continue;
        if (keyword.length > bestLen) {
          bestLen = keyword.length;
          trees.clear();
          trees.add(tree);
          matched = keyword;
        } else if (keyword.length === bestLen) {
          trees.add(tree);
        }
      }
    }
  }
  if (trees.size === 1) {
    const tree = Array.from(trees)[0];
    return { tree, inferred: true, matched };
  }
  return { tree: CASUAL_SOCIAL_DEFAULT_TREE, inferred: false };
}

function resolveNamedSkills(goals: readonly string[]): {
  skills: NamedSocialSkill[];
  unrecognized: string[];
} {
  const skills: NamedSocialSkill[] = [];
  const seen = new Set<string>();
  const unrecognized: string[] = [];
  for (const goal of goals) {
    const skill = SKILL_INDEX.get(normalizePhrase(goal));
    if (!skill) {
      unrecognized.push(goal);
      continue;
    }
    if (seen.has(skill.id)) continue;
    seen.add(skill.id);
    skills.push({ id: skill.id, label: skill.label, tree: skill.tree });
  }
  return { skills, unrecognized };
}

function emptyEvaluation(reasons: string[], flags: SocialScheduleFlag[] = []): SocialXpEvaluation {
  return {
    mode: 'none',
    awards: [],
    totalXp: 0,
    flags,
    reasons,
    casualXp: 0,
    casualXpWithheld: 0,
  };
}

/**
 * Apply the social XP rules. Pure: schedule blocks and the week's casual
 * total are passed in. gatherSocialContext() loads them from the engine.
 */
export function evaluateSocialXp(input: SocialXpInput): SocialXpEvaluation {
  const blocks = input.scheduleBlocks ?? [];
  let startMs = input.startMs;
  let endMs = input.endMs;
  let durationMinutes = input.durationMinutes;
  if ((durationMinutes == null || durationMinutes <= 0) && startMs != null && endMs != null && endMs > startMs) {
    durationMinutes = Math.floor((endMs - startMs) / 60_000);
  }
  if ((endMs == null || endMs <= (startMs ?? 0)) && startMs != null && durationMinutes != null && durationMinutes > 0) {
    endMs = startMs + durationMinutes * 60_000;
  }

  const hits = overlappingBlocks(startMs, endMs, blocks);
  if (hits.length > 0) {
    return emptyEvaluation(
      ['schedule_overlap'],
      hits.map(block => ({
        kind: block.kind,
        source: block.source,
        sourceId: block.sourceId,
        label: block.label,
      })),
    );
  }

  const reasons: string[] = [];
  if (blocks.length > 0 && (startMs == null || endMs == null || endMs <= startMs)) {
    reasons.push('interval_unknown');
  }

  const fromType = input.activityType ? skillGoalsFromActivityType(input.activityType) : [];
  const goals = [...fromType, ...parseSkillGoalInput(input.skillGoals)];
  const { skills, unrecognized } = resolveNamedSkills(goals);
  if (unrecognized.length > 0) reasons.push('unrecognized_skill_goal');

  if (skills.length > 0) {
    if (!reflectionQualifies(input.reflection)) {
      return emptyEvaluation([...reasons, 'reflection_required']);
    }
    const perTree = socialSkillXp(durationMinutes);
    const awards: SocialTreeAward[] = [];
    for (const tree of TREE_ORDER) {
      const named = skills.filter(skill => skill.tree === tree);
      if (named.length === 0) continue;
      awards.push({
        className: SOCIAL_TREE_CLASS[tree] as SocialTreeAward['className'],
        tree,
        xp: perTree,
        skills: named,
      });
    }
    const totalXp = awards.reduce((sum, award) => sum + award.xp, 0);
    return {
      mode: 'skill',
      awards,
      totalXp,
      flags: [],
      reasons,
      casualXp: 0,
      casualXpWithheld: 0,
    };
  }

  if (goals.length > 0) {
    return emptyEvaluation(reasons);
  }

  reasons.push('no_skill_goal');
  const already = Math.max(0, input.casualXpAwardedThisWeek ?? 0);
  const remaining = Math.max(0, CASUAL_SOCIAL_WEEKLY_CAP - already);
  const casualXp = Math.min(CASUAL_SOCIAL_XP, remaining);
  const casualXpWithheld = CASUAL_SOCIAL_XP - casualXp;
  if (casualXpWithheld > 0) reasons.push('weekly_cap');
  if (casualXp <= 0) {
    return {
      mode: 'none',
      awards: [],
      totalXp: 0,
      flags: [],
      reasons,
      casualXp: 0,
      casualXpWithheld,
    };
  }
  const inference = inferCasualTree([input.activityType, input.label, input.notes]);
  reasons.push(inference.inferred ? 'casual_tree_inferred' : 'casual_tree_default');
  return {
    mode: 'casual',
    awards: [{
      className: SOCIAL_TREE_CLASS[inference.tree] as SocialTreeAward['className'],
      tree: inference.tree,
      xp: casualXp,
      skills: [],
    }],
    totalXp: casualXp,
    flags: [],
    reasons,
    casualXp,
    casualXpWithheld,
  };
}

export function renderSocialNotes(parts: {
  reflection?: unknown;
  userNotes?: unknown;
  mode: SocialXpMode;
  awardedXp: number;
  flags: readonly SocialScheduleFlag[];
}): string | undefined {
  const chunks: string[] = [];
  const reflection = reflectionText(parts.reflection);
  const userNotes = reflectionText(parts.userNotes);
  if (reflection) chunks.push(reflection);
  if (userNotes && userNotes !== reflection) chunks.push(userNotes);
  if (parts.mode === 'casual' || parts.mode === 'skill') {
    const xp = Math.max(0, Math.round(parts.awardedXp));
    chunks.push(`[social-xp:${parts.mode}:${xp}]`);
  }
  const kinds = new Set(parts.flags.map(flag => flag.kind));
  for (const kind of kinds) chunks.push(`[social-flag:${kind}]`);
  const notes = chunks.join(' ').trim();
  return notes || undefined;
}

export interface SocialContext {
  blocks: ScheduleBlock[];
  casualXpAwardedThisWeek: number;
  scheduleWarning?: string;
}

/**
 * Load the intervals and the week's casual total. Calendar blocks stay
 * empty (loadCalendarBlocks). A Toggl failure is reported and does not
 * fail the log — the event is scored with whatever intervals did load.
 */
export async function gatherSocialContext(args: {
  userId: string | undefined;
  occurredAtIso: string;
  now?: Date;
}): Promise<SocialContext> {
  const now = args.now ?? new Date();
  const calendarBlocks = loadCalendarBlocks();
  if (!args.userId) {
    return { blocks: calendarBlocks, casualXpAwardedThisWeek: 0 };
  }

  const db = getDataService();
  const occurred = new Date(args.occurredAtIso);
  const week = chicagoWeekContaining(Number.isNaN(occurred.getTime()) ? now : occurred);
  const [recent, socialHistory] = await Promise.all([
    db.getActivityLog(args.userId, SOCIAL_SCHEDULE_LOOKBACK),
    db.getActivitiesByTypePrefix(args.userId, 'social'),
  ]);

  let togglEntries: TogglTimeEntry[] = [];
  let scheduleWarning: string | undefined;
  if (isTogglConfigured()) {
    try {
      const day = chicagoDay(Number.isNaN(occurred.getTime()) ? now : occurred);
      togglEntries = await fetchTogglEntriesForChicagoDay(day, now);
    } catch (err) {
      scheduleWarning = 'toggl_unavailable';
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[SOCIAL] Toggl schedule lookup failed: ${redactTogglSecret(message)}`);
    }
  }

  return {
    blocks: collectScheduleBlocks({
      activityLog: recent,
      togglEntries,
      calendarBlocks,
      now,
    }),
    casualXpAwardedThisWeek: casualXpAwardedInWeek(socialHistory, week.startMs, week.endMs),
    scheduleWarning,
  };
}
