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
    if (activityType.startsWith('redteam')) return 'redteam';
    if (activityType.startsWith('iq2') || activityType === 'personal-project') return 'developer';
    if (activityType === 'paladin-app-dev') return 'developer';
    if (activityType.startsWith('workout')) return 'warrior';
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
    return Object.entries(this.activityXP).map(([type, config]) => ({
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
   * Calculate confirmed XP from pending XP after sleep consolidation.
   *   confirmed = pending × consolidationMultiplier × fitbitModifier
   */
  calculateConfirmedXP(
    pendingXP: number,
    streakDays: number,
    fitbitScore: number | null,
  ): { confirmed: number; bonusXP: number; consolidationPct: number; tierName: string } {
    const multiplier       = this.getConsolidationMultiplier(streakDays);
    const fitbitMod        = this.getFitbitModifier(fitbitScore);
    const consolidationPct = Math.round(multiplier * fitbitMod * 100);
    const confirmed        = Math.round(pendingXP * multiplier * fitbitMod);
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
