/**
 * Project names and tags from Toggl Track → engine workout rates.
 * Matching is case-insensitive. A keyword hits when it is the whole project
 * name or tag, or a whole word/phrase inside it ("Tuesday Sambo", "Strength
 * Training"). Short keys such as "PT" do not match inside other words.
 * Anything that does not hit a keyword stays unmapped; the sync then keeps
 * the workout-cardio rate. No new XP constants.
 */

import type { WearableWorkoutType } from './wearableActivityXp.service';

export interface TogglActivityMapping {
  /** Compared case-insensitively to the project name and to each tag. */
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
  { keyword: 'yoga', activityType: 'workout-mobility', label: 'Yoga' },
];

export interface TogglMappedActivity {
  activityType: WearableWorkoutType;
  label: string;
}

function keywordMatches(text: string, keyword: string): boolean {
  const hay = text.trim().toLowerCase();
  const needle = keyword.trim().toLowerCase();
  if (!hay || !needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(hay);
}

/**
 * Best keyword on the project name or any tag. A longer keyword wins
 * ("Hinge Health" over "PT"). On a length tie, the project name wins over a tag.
 * No match → null (caller keeps cardio).
 */
export function mapTogglProjectOrTags(
  projectName: string | null | undefined,
  tags: readonly string[] | null | undefined,
): TogglMappedActivity | null {
  const texts: Array<{ value: string; fromProject: boolean }> = [];
  if (projectName?.trim()) texts.push({ value: projectName, fromProject: true });
  for (const tag of tags ?? []) {
    if (tag?.trim()) texts.push({ value: tag, fromProject: false });
  }

  let best: { mapping: TogglActivityMapping; fromProject: boolean } | null = null;
  for (const text of texts) {
    for (const mapping of TOGGL_ACTIVITY_MAPPINGS) {
      if (!keywordMatches(text.value, mapping.keyword)) continue;
      if (
        !best
        || mapping.keyword.length > best.mapping.keyword.length
        || (mapping.keyword.length === best.mapping.keyword.length && text.fromProject && !best.fromProject)
      ) {
        best = { mapping, fromProject: text.fromProject };
      }
    }
  }
  if (!best) return null;
  return { activityType: best.mapping.activityType, label: best.mapping.label };
}
