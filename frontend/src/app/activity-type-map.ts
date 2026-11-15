/**
 * Single translation from a frontend activity key to a backend activity type.
 *
 * The journal route is POST /api/activities (plural). XpCalculatorService only
 * awards the intended class for types it knows; anything else is category
 * "general", which character_stats stores as Sage. Callers must send the
 * value returned here and must not also post the raw key or free-text label.
 *
 * Backend aliases are intentionally not added. This map is the only
 * translation, so a second copy on the server cannot drift from it.
 */

export const ACTIVITIES_PATH = '/api/activities';

/**
 * Types XpCalculatorService classifies to a real class.
 * `prayer-routine` is not in the XP table; getCategoryFromActivity special-cases
 * it to `prayer`, which persists as Sage. Recovery quests use the `recovery-`
 * prefix and are accepted even when a new step is not listed here yet.
 */
export const BACKEND_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'redteam-lab',
  'redteam-ctf',
  'redteam-training',
  'iq2-story',
  'iq2-bug-fix',
  'personal-project',
  'paladin-app-dev',
  'workout-strength',
  'workout-cardio',
  'workout-mobility',
  'workout-mma',
  'art-drawing',
  'art-music',
  'art-writing',
  'christian-art-visual',
  'christian-art-music',
  'christian-art-poetry',
  'financial-study',
  'financial-project',
  'wilderness-training',
  'wilderness-craft',
  'survival-skill',
  'recovery-xray-order',
  'recovery-xray-book',
  'recovery-xray-done',
  'recovery-xray-review',
  'recovery-rest-day',
  'recovery-session-as-planned',
  'recovery-consistency-bonus',
  'admin-planning',
  'admin-review',
  'prayer-routine',
  'meeting-active',
  'meeting-passive',
]);

/**
 * Frontend keys that must not be journaled as class XP.
 * Hydration is tracked through consumption. The character protein button
 * has no nutrition activity type, so it must not be filed as prayer.
 */
const NON_CLASS_ACTIVITY_KEYS = new Set(['hydration', 'protein']);

/**
 * Keys used by the hotbar, skill tree, character actions, quick log, and
 * crafting that are not themselves backend activity types.
 */
export const ACTIVITY_TYPE_ALIASES: Readonly<Record<string, string>> = {
  // Quick log and enterprise crafting labels
  'dev-story': 'iq2-story',
  'dev-bug-fix': 'iq2-bug-fix',

  // Hotbar category sessions
  'mma-training': 'workout-mma',
  'strength-training': 'workout-strength',
  'swim-training': 'workout-cardio',
  'coding-moderate': 'personal-project',
  'guitar-practice': 'art-music',

  // Developer and deep work
  'coding-routine': 'personal-project',
  'coding-complex': 'personal-project',
  'coding-architecture': 'personal-project',
  'deep-focus': 'personal-project',
  'learning-tech': 'personal-project',
  // Meetings stay meeting-* so Developer XP requires an explicit TTI workTag.
  // Without that tag the server scores them with the social rules.
  'meetings-active': 'meeting-active',
  'meetings-passive': 'meeting-passive',
  'code-review-doing': 'admin-review',
  'code-review-addressing': 'admin-review',

  // Red team
  'htb-easy': 'redteam-lab',
  'htb-medium': 'redteam-lab',
  'htb-hard': 'redteam-lab',
  'portswigger-labs': 'redteam-lab',
  'exploit-dev': 'redteam-lab',
  'ctf-practice': 'redteam-ctf',
  'ctf-live': 'redteam-ctf',

  // Warrior. workout-* types also count as training for Session As Planned.
  'mma-class': 'workout-mma',
  'sparring': 'workout-mma',
  'swimming': 'workout-cardio',

  // Artist
  'music-practice': 'art-music',
  'songwriting': 'art-writing',
  'production': 'art-music',
  'performance': 'art-music',

  // Sage. prayer-routine is the backend prayer key, not a coding project.
  'prayer': 'prayer-routine',
  'prayer-routine': 'prayer-routine',
  'bible-study': 'prayer-routine',
  'sermon': 'prayer-routine',
  'spiritual-warfare': 'prayer-routine',

  // Chronicle the day as planning (Sage), not as a personal coding project.
  'daily-log': 'admin-planning',

  // Frontend survival / finance calculator keys
  'survival-training': 'wilderness-training',
  'trading-backtest': 'financial-study',
  'trading-live': 'financial-project',
};

/**
 * Resolve a frontend key to a backend activity type.
 * Returns null for blank keys, hydration, and free text that the server
 * would otherwise file as Sage.
 */
export function toBackendActivityType(key: string | null | undefined): string | null {
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (!trimmed || NON_CLASS_ACTIVITY_KEYS.has(trimmed)) return null;

  const alias = ACTIVITY_TYPE_ALIASES[trimmed];
  if (alias) return alias;
  if (trimmed.startsWith('recovery-')) return trimmed;
  if (BACKEND_ACTIVITY_TYPES.has(trimmed)) return trimmed;
  return null;
}
