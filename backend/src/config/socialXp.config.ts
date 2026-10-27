/**
 * Social XP — deliberate practice vs casual time.
 *
 * Social Dynamics and Charisma are not in the character-sheet parser
 * (Developer, Sage, Warrior, Artist, Redteamer, Financial Strategist,
 * Survivalist). They are awarded as character_stats classes when a log
 * names a skill on that tree. See docs/SOCIAL-XP.md.
 *
 * Defaults are chosen so a full week of casual social XP stays strictly
 * below one minimum deep-work award. The smallest primary base in
 * XpCalculatorService for deep work (personal-project, redteam-training,
 * art-drawing / art-music / art-writing, and the other DEEP_WORK_ACTIVITY_TYPES)
 * is DEEP_WORK_XP_FLOOR (10). socialXp.service.spec.ts locks the cap to that
 * floor and locks the practice rate to art-music.
 */

export type SocialTreeId = 'social-dynamics' | 'charisma';

export const SOCIAL_DYNAMICS_CLASS = 'Social Dynamics';
export const CHARISMA_CLASS = 'Charisma';

/**
 * activity_log.class_name for a social row that did not pay a skill tree
 * (casual time, a blocked overlap, or a goal with no reflection).
 * Not a skill tree and not written to character_stats.
 */
export const CASUAL_SOCIAL_LOG_CLASS = 'Social';

/** Primary base XP of the cheapest deep-work activity. Do not raise the casual cap to this. */
export const DEEP_WORK_XP_FLOOR = 10;

/**
 * Flat XP for one casual social event (no recognized skill goal).
 * Logged on the activity row only — it does not level a skill tree.
 */
export const CASUAL_SOCIAL_XP = 2;

/**
 * Most casual XP a single week can grant. Monday 00:00 America/Chicago
 * through the next Monday. Must stay strictly below DEEP_WORK_XP_FLOOR so
 * the capped week cannot exceed one minimum deep-work award.
 */
export const CASUAL_SOCIAL_WEEKLY_CAP = 8;

/**
 * Trimmed length of the post-event reflection required before skill XP is paid.
 * Short on purpose: a sentence, not a journal entry, and not a one-word note.
 */
export const SOCIAL_REFLECTION_MIN_CHARS = 24;

/**
 * Deliberate-practice rate. Same shape as art practice in XpCalculatorService:
 * base XP plus floor(minutes × multiplier). Each named tree is paid this once.
 */
export const SOCIAL_SKILL_BASE_XP = 10;
export const SOCIAL_SKILL_DURATION_MULTIPLIER = 0.2;

/**
 * Activity types whose logged interval is a work block.
 * Training intervals come from isTrainingActivity (workout-*, plus the
 * training aliases in recoveryQuests.service), not from this list.
 * The minimum primary baseXP among these keys is DEEP_WORK_XP_FLOOR.
 */
export const DEEP_WORK_ACTIVITY_TYPES: readonly string[] = [
  'personal-project',
  'iq2-story',
  'iq2-bug-fix',
  'paladin-app-dev',
  'redteam-lab',
  'redteam-ctf',
  'redteam-training',
  'art-drawing',
  'art-music',
  'art-writing',
  'christian-art-visual',
  'christian-art-music',
  'christian-art-poetry',
];

export const SOCIAL_TREE_CLASS: Record<SocialTreeId, string> = {
  'social-dynamics': SOCIAL_DYNAMICS_CLASS,
  charisma: CHARISMA_CLASS,
};

export interface SocialSkillDefinition {
  id: string;
  label: string;
  tree: SocialTreeId;
  /** Extra phrases, matched after normalization, that name this skill. */
  aliases: readonly string[];
}

/**
 * Social Dynamics: reading people and rooms, networking, group dynamics,
 * rapport, conflict (includes hosting and hard conversations).
 * Charisma: presence, storytelling, humor, confident approaches
 * (includes stranger conversations), public speaking.
 */
export const SOCIAL_SKILLS: readonly SocialSkillDefinition[] = [
  {
    id: 'reading-people',
    label: 'Reading people',
    tree: 'social-dynamics',
    aliases: ['reading people', 'read people'],
  },
  {
    id: 'reading-rooms',
    label: 'Reading rooms',
    tree: 'social-dynamics',
    aliases: ['reading rooms', 'read the room'],
  },
  {
    id: 'networking',
    label: 'Networking',
    tree: 'social-dynamics',
    aliases: ['networking'],
  },
  {
    id: 'group-dynamics',
    label: 'Group dynamics',
    tree: 'social-dynamics',
    aliases: ['group dynamics', 'hosting'],
  },
  {
    id: 'rapport',
    label: 'Rapport',
    tree: 'social-dynamics',
    aliases: ['rapport'],
  },
  {
    id: 'conflict',
    label: 'Conflict',
    tree: 'social-dynamics',
    aliases: ['conflict', 'hard conversation', 'hard conversations', 'difficult conversation'],
  },
  {
    id: 'presence',
    label: 'Presence',
    tree: 'charisma',
    aliases: ['presence'],
  },
  {
    id: 'storytelling',
    label: 'Storytelling',
    tree: 'charisma',
    aliases: ['storytelling'],
  },
  {
    id: 'humor',
    label: 'Humor',
    tree: 'charisma',
    aliases: ['humor', 'humour'],
  },
  {
    id: 'confident-approach',
    label: 'Confident approaches',
    tree: 'charisma',
    aliases: ['confident approach', 'confident approaches', 'stranger conversation', 'stranger conversations'],
  },
  {
    id: 'public-speaking',
    label: 'Public speaking',
    tree: 'charisma',
    aliases: ['public speaking'],
  },
];

const DEEP_WORK_SET = new Set(DEEP_WORK_ACTIVITY_TYPES);

export function isDeepWorkActivityType(activityType: string): boolean {
  return DEEP_WORK_SET.has(activityType);
}

/** `social` and `social-<skill phrase>` (hyphens become spaces). */
export function isSocialActivityType(activityType: string): boolean {
  return activityType === 'social' || activityType.startsWith('social-');
}

export function skillGoalsFromActivityType(activityType: string): string[] {
  if (!activityType.startsWith('social-')) return [];
  const phrase = activityType.slice('social-'.length).replace(/-/g, ' ').trim();
  return phrase ? [phrase] : [];
}

if (CASUAL_SOCIAL_WEEKLY_CAP >= DEEP_WORK_XP_FLOOR) {
  throw new Error('CASUAL_SOCIAL_WEEKLY_CAP must stay below DEEP_WORK_XP_FLOOR');
}
if (CASUAL_SOCIAL_XP <= 0 || CASUAL_SOCIAL_XP > CASUAL_SOCIAL_WEEKLY_CAP) {
  throw new Error('CASUAL_SOCIAL_XP must be positive and within the weekly cap');
}
if (SOCIAL_REFLECTION_MIN_CHARS < 8) {
  throw new Error('SOCIAL_REFLECTION_MIN_CHARS is too short to count as a reflection');
}
