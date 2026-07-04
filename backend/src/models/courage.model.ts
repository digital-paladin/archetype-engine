/**
 * Courage Stat — tracks fear-override behaviour over time.
 *
 * Three XP sources:
 *  1. New-domain session bonus — auto-awarded for eligible scary activities
 *     (workout-swimming, workout-mma, workout-climbing, etc.)
 *     +8 XP sessions 1-5 · +4 XP sessions 6-15 · +2 XP sessions 16-25 · 0+ sessions 26+
 *  2. Courage flag — manual +10 XP per flagged activity (1× per calendar day cap)
 *  3. Fear milestones — one-time awards for major fear conquests (e.g. 50, 75, 100 XP)
 */

export type CourageTier =
  | 'Timid'
  | 'Hesitant'
  | 'Brave'
  | 'Courageous'
  | 'Bold'
  | 'Fearless'
  | 'Legendary';

export interface CourageMilestone {
  id: string;
  title: string;    // e.g. "Overcame drowning fear"
  domain: string;   // e.g. "Water"
  date: string;     // YYYY-MM-DD
  xp: number;
  notes?: string;
}

export interface CourageFlagEntry {
  id: string;
  date: string;       // YYYY-MM-DD
  activityType: string;
  xp: number;
  note?: string;
}

export type CourageActivityStatus = 'active' | 'normalizing' | 'conquered';

export interface CourageActivityProgress {
  activityType: string;
  displayName: string;
  domain: string;
  sessionCount: number;
  courageXPEarned: number;
  status: CourageActivityStatus;
}

/** Computed view model returned to the frontend */
export interface CourageStat {
  totalXP: number;
  level: number;
  tier: CourageTier;
  xpToNextLevel: number;
  percentToNext: number;
  milestones: CourageMilestone[];
  activityProgress: CourageActivityProgress[];
  recentFlags: CourageFlagEntry[];
}

/** Raw persistence format stored in courage-data.json */
export interface CourageData {
  totalXP: number;
  milestones: CourageMilestone[];
  sessionCounts: Record<string, number>;  // activityType → lifetime session count
  flagLog: CourageFlagEntry[];
  lastFlagDate?: string;                  // YYYY-MM-DD — for 1× per day cap
  lastUpdated: string;
}
