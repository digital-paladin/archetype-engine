import {
  combinedExtensionBonusPct,
  nightlyExtensionBonusPct,
  extensionStreakBonusPct,
} from './sleepDebt.service';
import { isMeetingActivityType, isSocialActivityType } from '../config/socialXp.config';

/**
 * Wearable XP amounts are the baseXP values on the recovery-wearable-* entries.
 * These names and thresholds are the only place those rules are written down.
 */
export const WEARABLE_XP_TYPES = {
  sleepDuration: 'recovery-wearable-sleep',
  sleepScore: 'recovery-wearable-sleep-score',
  readinessAdherence: 'recovery-wearable-readiness-adherence',
  steps8k: 'recovery-wearable-steps-8k',
  steps10k: 'recovery-wearable-steps-10k',
  humeScan: 'recovery-wearable-hume-scan',
  humeTrend: 'recovery-wearable-hume-trend',
} as const;

export const WEARABLE_XP_RULES = {
  /** Hours of sleep required before any sleep XP. */
  sleepMinHours: 7,
  /** Sleep score that adds the score bonus on top of a 7h night. */
  sleepScoreMin: 80,
  /** Sleep duration bonus and score bonus together cannot exceed this. */
  sleepMaxPerNight: 15,
  /** Oura readiness at or above this applies the Well-Rested buff. The score pays no XP. */
  readinessWellRestedMin: 85,
  /** Oura readiness below this applies the Fatigued debuff. 70 itself does neither. */
  readinessFatiguedBelow: 70,
  /** Google Health steps for the smaller Warrior award. */
  steps8k: 8000,
  /** Google Health steps for the larger Warrior award. Replaces the 8k award. */
  steps10k: 10000,
  /** Steps cannot pay more than this in a civil day. */
  stepsMaxPerDay: 10,
  /** Sleep + readiness adherence + steps. Workouts and Hume scans are outside this. */
  passiveDailyCap: 40,
  /** Award dates may be today or this many Chicago calendar days earlier. */
  backfillDays: 3,
  /**
   * An Oura, manual, or other session whose overlap with an already-awarded
   * session is at least this fraction of its own duration is the same session.
   */
  workoutSameSessionOverlap: 0.5,
  /** Distinct ISO weeks of comparable Hume scans required for the monthly trend. */
  humeTrendWeeks: 4,
} as const;

const WEARABLE_XP_TYPE_SET = new Set<string>(Object.values(WEARABLE_XP_TYPES));

export function isWearableXpType(activityType: string): boolean {
  return WEARABLE_XP_TYPE_SET.has(activityType);
}

export interface ClassXpAward {
  /** Canonical class name used in journal entries (e.g. 'Artist', 'Sage', 'Developer') */
  class: string;
  baseXP: number;
  durationMultiplier?: number;
}

export interface ActivityConfig {
  baseXP: number;
  durationMultiplier?: number;
  /**
   * Optional multi-class XP awards. When present, the activity grants XP to
   * multiple character classes simultaneously. `baseXP` above is the primary
   * class award; entries here define additional (or alternative) class awards.
   * The total XP returned by calculateXP() is the SUM of all awards.
   */
  multiClassXP?: ClassXpAward[];
}

export class XpCalculatorService {
  private activityXP: { [key: string]: ActivityConfig } = {
    // RedTeam activities
    'redteam-lab': { baseXP: 15, durationMultiplier: 0.5 },
    'redteam-ctf': { baseXP: 30, durationMultiplier: 0.8 },
    'redteam-training': { baseXP: 10, durationMultiplier: 0.3 },

    // Developer activities
    'iq2-story': { baseXP: 20, durationMultiplier: 0.4 },
    'iq2-bug-fix': { baseXP: 15, durationMultiplier: 0.3 },
    'personal-project': { baseXP: 10, durationMultiplier: 0.2 },

    // ── Multi-class Developer: Paladin Gamification App Dev ────────────────
    // Building the character-progression-ui itself earns Developer + Sage + Artist XP.
    // Developer = primary technical craft; Sage = self-mastery system design;
    // Artist = UI/UX & visual design dimension.
    'paladin-app-dev': {
      baseXP: 20,
      durationMultiplier: 0.4,
      multiClassXP: [
        { class: 'Sage',    baseXP: 8, durationMultiplier: 0.15 },
        { class: 'Artist',  baseXP: 5, durationMultiplier: 0.08 },
      ],
    },

    // Warrior activities
    'workout-strength': { baseXP: 20, durationMultiplier: 0.2 },
    'workout-cardio': { baseXP: 15, durationMultiplier: 0.15 },
    'workout-mobility': { baseXP: 10, durationMultiplier: 0.1 },
    'workout-mma': { baseXP: 15, durationMultiplier: 0.2 },

    // Artist activities (secular)
    'art-drawing': { baseXP: 10, durationMultiplier: 0.2 },
    'art-music': { baseXP: 10, durationMultiplier: 0.2 },
    'art-writing': { baseXP: 10, durationMultiplier: 0.2 },

    // ── Multi-class Artist: Christian / devotional art ─────────────────────
    // Devotional creative work (visual, music, poetry) earns Artist XP for
    // the craft PLUS Sage XP for the spiritual/contemplative discipline.
    'christian-art-visual': {
      baseXP: 10,
      durationMultiplier: 0.2,
      multiClassXP: [
        { class: 'Sage', baseXP: 5, durationMultiplier: 0.1 },
      ],
    },
    'christian-art-music': {
      baseXP: 10,
      durationMultiplier: 0.2,
      multiClassXP: [
        { class: 'Sage', baseXP: 5, durationMultiplier: 0.1 },
      ],
    },
    'christian-art-poetry': {
      baseXP: 10,
      durationMultiplier: 0.2,
      multiClassXP: [
        { class: 'Sage', baseXP: 5, durationMultiplier: 0.1 },
      ],
    },

    // Financial activities
    'financial-study':    { baseXP: 10, durationMultiplier: 0.3 },
    'financial-project':  { baseXP: 15, durationMultiplier: 0.4 },

    // Survivalist activities
    'wilderness-training':  { baseXP: 15, durationMultiplier: 0.3 },
    'wilderness-craft':     { baseXP: 20, durationMultiplier: 0.4 },
    'survival-skill':       { baseXP: 12, durationMultiplier: 0.25 },

    // ── Recovery & Consistency quests (Warrior) ────────────────────────────
    // Flat XP — no duration multiplier. Guards (one-time steps, Thursday-only,
    // needs a logged session, 10-of-13 window) live in recoveryQuests.service.ts.
    // Sizing: the X-ray main quest totals 300 XP, the same tier as the
    // 280–300 XP expert crafting recipes; Rest Day Kept = 20 (a strength
    // session's base); Session As Planned = 10 (a flat PR-distance-sized bonus);
    // Consistency Bonus = 50 (same as the Dragon Slayer / CTF First Blood bonuses).
    'recovery-xray-order':          { baseXP: 40 },   // Foot X-ray (Case 2) 1/4: doctor's order
    'recovery-xray-book':           { baseXP: 40 },   // 2/4: X-ray booked
    'recovery-xray-done':           { baseXP: 120 },  // 3/4: X-ray taken
    'recovery-xray-review':         { baseXP: 100 },  // 4/4: results reviewed with doctor/PT
    'recovery-rest-day':            { baseXP: 20 },   // Rest Day Kept (Thursday, no training)
    'recovery-session-as-planned':  { baseXP: 10 },   // Session As Planned (bonus per scheduled session done)
    'recovery-consistency-bonus':   { baseXP: 50 },   // 10 of ~13 planned sessions in 14 days

    // Wearable metric awards (Nov 13 2026). Flat XP. Thresholds, caps, and
    // which device may pay live in WEARABLE_XP_RULES and wearableMetricXp.ts.
    // The `recovery-wearable-` prefix routes these to Warrior and keeps them
    // out of isTrainingActivity, so a step day does not cancel Thursday rest.
    // They are not recovery quests: validateRecoveryActivity rejects the names.
    'recovery-wearable-sleep':                  { baseXP: 10 }, // 7h+ sleep
    'recovery-wearable-sleep-score':            { baseXP: 5 },  // score >= 80, on top of the 7h award
    'recovery-wearable-readiness-adherence':    { baseXP: 10 }, // lighter plan kept on a fatigued day
    'recovery-wearable-steps-8k':               { baseXP: 5 },  // 8,000+ steps, Google Health only
    'recovery-wearable-steps-10k':              { baseXP: 10 }, // 10,000+ steps (replaces the 8k award)
    'recovery-wearable-hume-scan':              { baseXP: 15 }, // one body-composition scan per ISO week
    'recovery-wearable-hume-trend':             { baseXP: 25 }, // four comparable weeks, once per month

    // Admin activities (Sage/Developer class — low rate to prevent XP farming)
    // Quest planning, calendar events, sprint planning, task management
    'admin-planning': { baseXP: 5, durationMultiplier: 0.08 },
    // Code review, PR review, story review, tech spec review
    'admin-review':   { baseXP: 8, durationMultiplier: 0.12 },
  };

  /**
   * Calculate total XP for an activity (sum of all class awards).
   */
  calculateXP(activityType: string, duration?: number): number {
    const awards = this.getMultiClassXP(activityType, duration);
    return awards.reduce((sum, a) => sum + a.xp, 0);
  }

  /**
   * Returns per-class XP breakdown for an activity.
   * Single-class activities return a one-element array.
   * Multi-class activities return one entry per awarded class.
   */
  getMultiClassXP(activityType: string, duration?: number): Array<{ class: string; xp: number }> {
    // Social XP, and meetings without an explicit TTI work tag, are decided
    // on the activity route. Returning 0 here stops a fallback of 10 Sage XP
    // or Developer XP for a meeting that was not marked TTI.
    if (isSocialActivityType(activityType) || isMeetingActivityType(activityType)) {
      return [{ class: 'social', xp: 0 }];
    }

    const config = this.activityXP[activityType];
    if (!config) return [{ class: this.getCategoryFromActivity(activityType), xp: 10 }];

    const calcXp = (baseXP: number, mult?: number): number => {
      let xp = baseXP;
      if (duration && mult) xp += Math.floor(duration * mult);
      return xp;
    };

    const primaryCategory = this.getCategoryFromActivity(activityType);
    const primaryXp = calcXp(config.baseXP, config.durationMultiplier);
    const awards: Array<{ class: string; xp: number }> = [
      { class: primaryCategory, xp: primaryXp },
    ];

    if (config.multiClassXP) {
      for (const extra of config.multiClassXP) {
        awards.push({ class: extra.class, xp: calcXp(extra.baseXP, extra.durationMultiplier) });
      }
    }

    return awards;
  }

  /**
   * Get category from activity type (primary class for journal routing).
   */
  getCategoryFromActivity(activityType: string): string {
    if (isSocialActivityType(activityType) || isMeetingActivityType(activityType)) return 'social';
    if (activityType.startsWith('redteam')) return 'redteam';
    if (activityType.startsWith('iq2') || activityType === 'personal-project') return 'developer';
    if (activityType === 'paladin-app-dev') return 'developer';
    if (activityType.startsWith('workout')) return 'warrior';
    if (activityType.startsWith('recovery-')) return 'warrior';
    if (activityType === 'prayer-routine') return 'prayer';
    if (activityType.startsWith('art') || activityType.startsWith('christian-art')) return 'artist';
    if (activityType.startsWith('financial')) return 'financial';
    if (activityType.startsWith('wilderness') || activityType.startsWith('survival')) return 'survivalist';
    if (activityType === 'admin-planning') return 'sage';
    if (activityType === 'admin-review') return 'developer';
    return 'general';
  }

  /**
   * Get list of available activity types.
   */
  getActivityTypes(): Array<{ type: string; category: string; baseXP: number; multiClass?: boolean }> {
    return Object.entries(this.activityXP)
      .filter(([type]) => !isWearableXpType(type))
      .map(([type, config]) => ({
        type,
        category: this.getCategoryFromActivity(type),
        baseXP: config.baseXP,
        ...(config.multiClassXP && { multiClass: true }),
      }));
  }

  // ── Consolidation Formula Methods ──────────────────────────────────────────

  private static readonly CONSOLIDATION_TIERS = [
    { minDays: 365, multiplier: 1.15,  name: 'Grandmaster' },
    { minDays: 180, multiplier: 1.125, name: 'Master' },
    { minDays:  90, multiplier: 1.10,  name: 'Expert' },
    { minDays:  30, multiplier: 1.075, name: 'Adept' },
    { minDays:   1, multiplier: 1.05,  name: 'Novice' },
  ] as const;

  // FLAGGED (not fixed — needs an explicit Owner decision on which curve is
  // canonical before touching either): the frontend's LevelProgressionService
  // (frontend/src/app/level-progression.service.ts, calculateXPForLevel) uses
  // an entirely different formula — 100 × level^1.5 — for the SAME classes
  // this service tracks server-side. Depending on which UI surface reads
  // which source, a class's displayed level can visibly disagree with what
  // this linear (836 × level) formula says character_stats actually holds.
  static readonly XP_PER_LEVEL_BASE = 836; // matches xpThresholdForLevel in character.routes.ts
  private static readonly ACL_ITEM_XP_BONUS = 0.5; // XP bonus per completed ACL item

  /**
   * Returns the consolidation multiplier for a given streak length.
   * Grandmaster (365+ days): 1.15×, Master (180–364 days): 1.125×,
   * Expert (90–179 days): 1.10×, Adept (30–89 days): 1.075×,
   * Novice (1–29 days): 1.05×, zero streak: 1.0×
   */
  getConsolidationMultiplier(streakDays: number): number {
    for (const tier of XpCalculatorService.CONSOLIDATION_TIERS) {
      if (streakDays >= tier.minDays) return tier.multiplier;
    }
    return 1.0;
  }

  /** Tier name for a given streak (Grandmaster / Master / Expert / Adept / Novice / Unranked). */
  getConsolidationTierName(streakDays: number): string {
    for (const tier of XpCalculatorService.CONSOLIDATION_TIERS) {
      if (streakDays >= tier.minDays) return tier.name;
    }
    return 'Unranked';
  }

  /**
   * Fitbit modifier: fitbitScore / 100 (score 91 → 0.91), capped at 1.0.
   * Defaults to 0.90 when score is null (conservative rest-day estimate).
   */
  getFitbitModifier(fitbitScore: number | null): number {
    if (fitbitScore === null || fitbitScore === undefined) return 0.9;
    return Math.min(fitbitScore / 100, 1.0);
  }

  /**
   * Flat ACL bonus: 0.5 XP per completed item (applied after consolidation math).
   */
  getAclBonus(completedItemCount: number): number {
    return Math.round(completedItemCount * XpCalculatorService.ACL_ITEM_XP_BONUS);
  }

  /**
   * Sleep-extension modifier: 1 + combined nightly surplus and streak bonuses.
   * Omit hours/streak (or pass 0) to leave confirmed XP unchanged.
   */
  getSleepExtensionModifier(
    sleepHours?: number | null,
    extensionStreakNights?: number | null,
  ): number {
    const nightly = nightlyExtensionBonusPct(Number(sleepHours) || 0);
    const streak = extensionStreakBonusPct(Number(extensionStreakNights) || 0);
    return (1 + nightly / 100) * (1 + streak / 100);
  }

  /**
   * Combined sleep-extension bonus as a display percent (same math as the modifier).
   */
  getSleepExtensionBonusPct(
    sleepHours?: number | null,
    extensionStreakNights?: number | null,
  ): number {
    return combinedExtensionBonusPct(Number(sleepHours) || 0, Number(extensionStreakNights) || 0);
  }

  /**
   * Calculate confirmed XP from pending XP after sleep consolidation.
   *   confirmed = pending × consolidationMultiplier × fitbitModifier × extensionModifier
   */
  calculateConfirmedXP(
    pendingXP: number,
    streakDays: number,
    fitbitScore: number | null,
    sleepHours?: number | null,
    extensionStreakNights?: number | null,
  ): { confirmed: number; bonusXP: number; consolidationPct: number; tierName: string } {
    const multiplier       = this.getConsolidationMultiplier(streakDays);
    const fitbitMod        = this.getFitbitModifier(fitbitScore);
    const extensionMod     = this.getSleepExtensionModifier(sleepHours, extensionStreakNights);
    const consolidationPct = Math.round(multiplier * fitbitMod * extensionMod * 100);
    const confirmed        = Math.round(pendingXP * (consolidationPct / 100));
    const bonusXP          = confirmed - pendingXP;
    return { confirmed, bonusXP, consolidationPct, tierName: this.getConsolidationTierName(streakDays) };
  }

  /**
   * Apply an XP gain to the current level/XP state.
   * Handles level-up carry-over correctly.
   * XP threshold per level = max(100, 836 × level).
   */
  applyXPGain(
    currentLevel: number,
    currentXPInLevel: number,
    xpToAdd: number,
  ): { newLevel: number; newCurrentXP: number; leveledUp: boolean } {
    let level     = currentLevel;
    let xpInLevel = currentXPInLevel + xpToAdd;
    let leveledUp = false;

    while (true) {
      const threshold = Math.max(100, Math.round(XpCalculatorService.XP_PER_LEVEL_BASE * level));
      if (xpInLevel < threshold) break;
      xpInLevel -= threshold;
      level++;
      leveledUp = true;
      if (level > 1000) break; // safety guard
    }

    return { newLevel: level, newCurrentXP: xpInLevel, leveledUp };
  }
}
