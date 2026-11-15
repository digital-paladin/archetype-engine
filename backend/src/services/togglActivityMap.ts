/**
 * Project name, description, and tags from Toggl Track → engine workout rates.
 * Matching is case-insensitive. A keyword hits when it is the whole field, or
 * a whole word/phrase inside it ("Tuesday Sambo", "Strength Training",
 * "FtWorth Combatives - Sambo"). Short keys such as "PT" do not match inside
 * other words. Anything that does not hit a keyword stays unmapped; the sync
 * then keeps the workout-cardio rate. No new XP constants.
 *
 * Parkour is left unmapped on purpose. It is not martial arts, strength, or
 * mobility, so a Sport session that only says "parkour" stays workout-cardio.
 */

import type { WearableWorkoutType } from './wearableActivityXp.service';

export interface TogglActivityMapping {
  /** Compared case-insensitively to the project name, description, and each tag. */
  keyword: string;
  activityType: WearableWorkoutType;
  /** Canonical name used in "Toggl: <label>". */
  label: string;
}

export const TOGGL_ACTIVITY_MAPPINGS: readonly TogglActivityMapping[] = [
  { keyword: 'sambo', activityType: 'workout-mma', label: 'Sambo' },
  { keyword: 'bjj', activityType: 'workout-mma', label: 'BJJ' },
  { keyword: 'mma', activityType: 'workout-mma', label: 'MMA' },
  { keyword: 'wrestling', activityType: 'workout-mma', label: 'Wrestling' },
  { keyword: 'judo', activityType: 'workout-mma', label: 'Judo' },
  { keyword: 'lifting', activityType: 'workout-strength', label: 'Lifting' },
  { keyword: 'strength', activityType: 'workout-strength', label: 'Strength' },
  { keyword: 'resistance', activityType: 'workout-strength', label: 'Resistance' },
  { keyword: 'pt', activityType: 'workout-mobility', label: 'PT' },
  { keyword: 'hinge health', activityType: 'workout-mobility', label: 'Hinge Health' },
  { keyword: 'mobility', activityType: 'workout-mobility', label: 'Mobility' },
  { keyword: 'stretching', activityType: 'workout-mobility', label: 'Stretch' },
  { keyword: 'stretch', activityType: 'workout-mobility', label: 'Stretch' },
  { keyword: 'yoga', activityType: 'workout-mobility', label: 'Yoga' },
];

export interface TogglMappedActivity {
  activityType: WearableWorkoutType;
  label: string;
}

/** Higher wins a same-length tie. Project still beats a tag, as before. */
const SOURCE_RANK = { project: 2, description: 1, tag: 0 } as const;

type TogglTextSource = keyof typeof SOURCE_RANK;

function keywordMatches(text: string, keyword: string): boolean {
  const hay = text.trim().toLowerCase();
  const needle = keyword.trim().toLowerCase();
  if (!hay || !needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(hay);
}

/**
 * Best keyword on the project name, the description, or any tag. A longer
 * keyword wins ("Hinge Health" over "PT"), whichever field it is on. On a
 * length tie, the project name wins over the description, and the description
 * wins over a tag. No match → null (caller keeps cardio).
 */
export function mapTogglProjectOrTags(
  projectName: string | null | undefined,
  tags: readonly string[] | null | undefined,
  description?: string | null,
): TogglMappedActivity | null {
  const texts: Array<{ value: string; source: TogglTextSource }> = [];
  if (projectName?.trim()) texts.push({ value: projectName, source: 'project' });
  if (description?.trim()) texts.push({ value: description, source: 'description' });
  for (const tag of tags ?? []) {
    if (tag?.trim()) texts.push({ value: tag, source: 'tag' });
  }

  let best: { mapping: TogglActivityMapping; source: TogglTextSource } | null = null;
  for (const text of texts) {
    for (const mapping of TOGGL_ACTIVITY_MAPPINGS) {
      if (!keywordMatches(text.value, mapping.keyword)) continue;
      if (!best) {
        best = { mapping, source: text.source };
        continue;
      }
      const longer = mapping.keyword.length > best.mapping.keyword.length;
      const preferredSource = mapping.keyword.length === best.mapping.keyword.length
        && SOURCE_RANK[text.source] > SOURCE_RANK[best.source];
      if (longer || preferredSource) best = { mapping, source: text.source };
    }
  }
  if (!best) return null;
  return { activityType: best.mapping.activityType, label: best.mapping.label };
}
