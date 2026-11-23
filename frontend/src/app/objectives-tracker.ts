/**
 * Read-only Objectives tracker.
 * Groups active system quests, caps the list, and formats counters.
 * Completion uses quest-progress helpers. Nothing here clears a quest or awards XP.
 */

import { questObjectiveProgress, type ObjectiveProgress } from './quest-progress';

export type TrackerGroupId = 'dailies' | 'weekly' | 'boss';

/** Quest name lines kept on screen before "+N more". */
export const OBJECTIVES_QUEST_CAP = 5;

export const OBJECTIVES_COLLAPSED_KEY = 'archetype.objectives.collapsed';

/**
 * Protein goal used by the food log and the ACM protein check: grams per pound of body weight.
 * This is the existing rule, not a sample reading.
 */
export const PROTEIN_GRAMS_PER_POUND = 0.64;

/**
 * Vow of Water. The ACM hydration check and the consumption-effects default both use 100 oz.
 * A water line is still omitted when today's ounces were not loaded.
 */
export const HYDRATION_GOAL_OZ = 100;

const GROUP_ORDER: readonly TrackerGroupId[] = ['dailies', 'weekly', 'boss'];

export const TRACKER_GROUP_LABELS: Record<TrackerGroupId, string> = {
  dailies: 'Dailies',
  weekly: 'Weekly',
  boss: 'Boss',
};

export interface TrackerObjective extends ObjectiveProgress {
  label?: string | null;
}

export interface TrackerQuestSource {
  id: string;
  kind?: string | null;
  status?: string | null;
  hidden?: boolean | null;
  title?: string | null;
  scheduledFor?: string | null;
  objectives?: readonly TrackerObjective[] | null;
}

export interface GroupedQuest {
  id: string;
  group: TrackerGroupId;
  title: string;
  awaitingTurnIn: boolean;
  lines: string[];
}

export interface TrackerGroupView {
  id: TrackerGroupId;
  label: string;
  collapsed: boolean;
  quests: GroupedQuest[];
}

export interface LiveCounterInput {
  proteinGrams?: number | null;
  proteinGoalGrams?: number | null;
  waterOz?: number | null;
  hydrationGoalOz?: number | null;
}

export interface ObjectivesView {
  liveLines: string[];
  groups: TrackerGroupView[];
  hiddenCount: number;
  showLess: boolean;
  empty: boolean;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface FoodTotals {
  protein?: number | null;
}

interface FoodReading {
  totals?: FoodTotals | null;
}

interface VitalsReading {
  weight?: number | null;
  waterOz?: number | null;
}

/** Active daily for today, the active weekly, or an active boss. Other quests stay out of the tracker. */
export function trackerGroup(quest: TrackerQuestSource, today: string): TrackerGroupId | null {
  if (quest.status !== 'active' || quest.hidden) return null;
  const title = (quest.title ?? '').trim();
  if (!title) return null;
  const kind = (quest.kind ?? '').trim().toLowerCase();
  if (kind === 'boss' || /^boss\b/i.test(title)) return 'boss';
  if (kind === 'weekly' || /^weekly\b/i.test(title)) return 'weekly';
  if (kind === 'daily' && quest.scheduledFor === today) return 'dailies';
  return null;
}

/**
 * True when every objective looks complete and the quest is still active.
 * Cleared, failed, and expired quests are not waiting to be turned in.
 */
export function isAwaitingTurnIn(quest: Pick<TrackerQuestSource, 'status' | 'objectives'>): boolean {
  if (quest.status !== 'active') return false;
  const progress = questObjectiveProgress(quest.objectives);
  return progress.total > 0 && progress.completed === progress.total;
}

/** Indented counter lines. Numeric objectives win; otherwise one "N/M objectives" line from the shared progress helper. */
export function objectiveCounterLines(objectives: readonly TrackerObjective[] | null | undefined): string[] {
  const list = objectives ?? [];
  const numeric = list.filter(hasNumericCounter);
  if (numeric.length > 0) {
    return numeric.map(objective => counterText(objective.progress ?? 0, objective.target ?? 0, objective.label));
  }
  const progress = questObjectiveProgress(list);
  if (progress.total === 0) return [];
  const noun = progress.total === 1 ? 'objective' : 'objectives';
  return [`${progress.completed}/${progress.total} ${noun}`];
}

export function groupTrackerQuests(quests: readonly TrackerQuestSource[], today: string): GroupedQuest[] {
  const grouped: GroupedQuest[] = [];
  for (const group of GROUP_ORDER) {
    for (const quest of quests) {
      if (trackerGroup(quest, today) !== group) continue;
      const title = (quest.title ?? '').trim();
      grouped.push({
        id: quest.id,
        group,
        title,
        awaitingTurnIn: isAwaitingTurnIn(quest),
        lines: objectiveCounterLines(quest.objectives),
      });
    }
  }
  return grouped;
}

export function proteinGoalFromWeight(weightLb: number | null | undefined): number | null {
  if (typeof weightLb !== 'number' || !Number.isFinite(weightLb) || weightLb <= 0) return null;
  return Math.round(weightLb * PROTEIN_GRAMS_PER_POUND);
}

/** The vow's ounce goal, only when a water reading was actually loaded. */
export function hydrationGoalForReading(waterOz: number | null | undefined): number | null {
  if (!isUsableAmount(waterOz)) return null;
  return HYDRATION_GOAL_OZ;
}

/**
 * Protein from the food log, water from status vitals.
 * A line is omitted when either side of that counter is missing.
 */
export function metricsFromFoodAndVitals(
  food: FoodReading | null | undefined,
  vitals: VitalsReading | null | undefined,
): LiveCounterInput {
  const proteinGrams = isUsableAmount(food?.totals?.protein) ? food!.totals!.protein! : null;
  const waterOz = isUsableAmount(vitals?.waterOz) ? vitals!.waterOz! : null;
  return {
    proteinGrams,
    proteinGoalGrams: proteinGoalFromWeight(vitals?.weight),
    waterOz,
    hydrationGoalOz: hydrationGoalForReading(waterOz),
  };
}

export function liveCounterLines(metrics: LiveCounterInput | null | undefined): string[] {
  if (!metrics) return [];
  const lines: string[] = [];
  if (isUsableAmount(metrics.proteinGrams) && isPositiveAmount(metrics.proteinGoalGrams)) {
    lines.push(`Protein ${formatAmount(metrics.proteinGrams!)} / ${formatAmount(metrics.proteinGoalGrams!)} g`);
  }
  if (isUsableAmount(metrics.waterOz) && isPositiveAmount(metrics.hydrationGoalOz)) {
    lines.push(`Water ${formatAmount(metrics.waterOz!)} / ${formatAmount(metrics.hydrationGoalOz!)} oz`);
  }
  return lines;
}

export function buildObjectivesView(args: {
  quests: readonly TrackerQuestSource[];
  today: string;
  collapsed?: ReadonlySet<TrackerGroupId> | null;
  showAll?: boolean;
  metrics?: LiveCounterInput | null;
  cap?: number;
}): ObjectivesView {
  const collapsed = args.collapsed ?? new Set<TrackerGroupId>();
  const showAll = args.showAll === true;
  const cap = args.cap ?? OBJECTIVES_QUEST_CAP;
  const grouped = groupTrackerQuests(args.quests, args.today);
  const open = grouped.filter(quest => !collapsed.has(quest.group));
  const limit = showAll ? open.length : cap;
  const visible = open.slice(0, limit);
  const hiddenCount = Math.max(0, open.length - visible.length);
  const visibleIds = new Set(visible.map(quest => quest.id));

  const groups: TrackerGroupView[] = [];
  for (const id of GROUP_ORDER) {
    const inGroup = grouped.filter(quest => quest.group === id);
    if (inGroup.length === 0) continue;
    const isCollapsed = collapsed.has(id);
    groups.push({
      id,
      label: TRACKER_GROUP_LABELS[id],
      collapsed: isCollapsed,
      quests: isCollapsed ? [] : inGroup.filter(quest => visibleIds.has(quest.id)),
    });
  }

  const liveLines = liveCounterLines(args.metrics);
  return {
    liveLines,
    groups,
    hiddenCount,
    showLess: showAll && open.length > cap,
    empty: groups.length === 0 && liveLines.length === 0,
  };
}

export function readCollapsedGroups(store: KeyValueStore | null | undefined): Set<TrackerGroupId> {
  if (!store) return new Set();
  try {
    const raw = store.getItem(OBJECTIVES_COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const allowed = new Set<string>(GROUP_ORDER);
    return new Set(parsed.filter((id): id is TrackerGroupId => typeof id === 'string' && allowed.has(id)));
  } catch {
    return new Set();
  }
}

export function writeCollapsedGroups(store: KeyValueStore | null | undefined, groups: ReadonlySet<TrackerGroupId>): void {
  if (!store) return;
  try {
    const ordered = GROUP_ORDER.filter(id => groups.has(id));
    store.setItem(OBJECTIVES_COLLAPSED_KEY, JSON.stringify(ordered));
  } catch {
    // A full or blocked local store should not break the tracker.
  }
}

function hasNumericCounter(objective: TrackerObjective): boolean {
  return isFiniteNumber(objective.progress) && isFiniteNumber(objective.target) && objective.target > 0 && objective.progress >= 0;
}

function counterText(current: number, target: number, label?: string | null): string {
  const ratio = `${formatObjectiveCount(current)}/${formatObjectiveCount(target)}`;
  const name = (label ?? '').trim();
  return name ? `${ratio} ${name}` : ratio;
}

function formatObjectiveCount(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function formatAmount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUsableAmount(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveAmount(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}
