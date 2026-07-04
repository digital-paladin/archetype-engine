// ─── Vault Model ──────────────────────────────────────────────────────────────
// The Strategy Vault accumulates real-world reward entries earned through
// discipline milestones. Balance is locked until the Financial Strategist
// algorithm passes all Live-Ready Gate criteria.

export type RewardTier = 'minimum' | 'acm_perfect' | 'perfect_week' | 'level_up' | 'sprint_story' | 'custom';

// ─── ACM Category Weights ─────────────────────────────────────────────────────
// Index matches journal action item order (0-based):
//  0: Abstained alcohol    1: Wake Up With God   2: Physical Training
//  3: Deep Work: Dev       4: Deep Work: RedTeam 5: Deep Work: Artist
//  6: Deep Work: Mech Eng  7: Fasting            8: Hydration          9: Diet Plan
// 10: Abstained sexual    11: Protein           12: Bonfire Routine   13: DR-ALFRED Supplements
// (Brush teeth removed Jun 2026 — maintenance marker, not a binding restriction)
// (RedTeam weight 2→1 Jun 2026 — vow not yet established; revisit at 5+days/week)
export const ACM_ITEM_WEIGHTS: number[] = [2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 2, 1, 2, 1];
export const ACM_MAX_SCORE = ACM_ITEM_WEIGHTS.reduce((a, b) => a + b, 0); // 20

/** Returns a multiplier in [0.5, 1.0] from a weighted ACM score. */
export function calculateAcmMultiplier(weightedScore: number): number {
  return Math.max(0.5, weightedScore / ACM_MAX_SCORE);
}

export interface VaultEntry {
  id: string;
  date: string;           // ISO date string (when the milestone was logged)
  milestone: string;      // Description of the achievement
  tier: RewardTier;
  baseAmount: number;     // Base reward in dollars (after ACM multiplier)
  bonusAmount: number;    // Bonus from dice roll (0 if no roll or non-max result)
  totalAmount: number;    // baseAmount + bonusAmount
  diceRoll?: number;      // Actual dice result (undefined if no roll)
  diceSides?: number;     // 6 or 12 (undefined if no roll)
  tags?: string[];        // e.g. ['streak', 'level-up', 'sprint', 'perfect-week']
  realizedInSoFi?: boolean;   // true = real dollars moved to SoFi savings goal same day
  acmScore?: number;          // weighted ACM score at time of logging (0–18)
  acmMaxScore?: number;       // always 18 — stored for display context
  acmMultiplier?: number;     // pre-calculated multiplier (0.5–1.0)
}

export interface GateCriterion {
  id: string;
  label: string;
  met: boolean;
  metAt?: string;         // ISO date when criterion was checked off
}

export interface VaultData {
  balance: number;
  status: 'locked' | 'unlocked';
  unlockedAt?: string;    // ISO date when all gate criteria were met
  gateCriteria: GateCriterion[];
  entries: VaultEntry[];
  lastUpdated: string;
}

// ─── Reward Tier Definitions ──────────────────────────────────────────────────

export const REWARD_TIERS: Record<RewardTier, {
  label: string;
  baseAmount: number;
  diceSides: number | null;
  bonusMultiplier: number;  // applied if max roll hit (0 = no bonus)
}> = {
  minimum: {
    label: 'Minimum Discipline Action',
    baseAmount: 10,
    diceSides: null,
    bonusMultiplier: 0,
  },
  acm_perfect: {
    label: 'All 12 ACM Items ✅ (Perfect Day)',
    baseAmount: 25,
    diceSides: 6,
    bonusMultiplier: 0.5,   // +50% if roll = 6
  },
  perfect_week: {
    label: 'Perfect Week (7 Consecutive Perfect Days)',
    baseAmount: 50,
    diceSides: 12,
    bonusMultiplier: 0.5,   // +50% if roll = 12
  },
  level_up: {
    label: 'Level Up — Any Skill Tree',
    baseAmount: 25,
    diceSides: 6,
    bonusMultiplier: 0.5,   // +50% if roll = 6
  },
  sprint_story: {
    label: 'Sprint Story Completed (IQ-XXXX)',
    baseAmount: 50,
    diceSides: 12,
    bonusMultiplier: 0.5,   // +50% if roll = 12
  },
  custom: {
    label: 'Custom Milestone',
    baseAmount: 0,          // caller specifies
    diceSides: null,
    bonusMultiplier: 0,
  },
};

// ─── Live-Ready Gate Criteria ─────────────────────────────────────────────────

export const DEFAULT_GATE_CRITERIA: Omit<GateCriterion, 'met' | 'metAt'>[] = [
  { id: 'backtest',          label: '6+ months backtested with positive Sharpe ratio' },
  { id: 'paper-trading',     label: '30-day paper trading period with acceptable drawdown' },
  { id: 'drawdown-defined',  label: 'Max drawdown defined & position sizing set' },
  { id: 'account-funded',    label: 'Brokerage account funded (minimum capital floor)' },
  { id: 'kill-switch',       label: 'Kill-switch rule defined (e.g., -15% monthly = pause)' },
  { id: 'oos-validated',     label: 'Strategy validated on out-of-sample data' },
];
