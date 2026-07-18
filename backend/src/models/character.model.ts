/**
 * Core data models for Archetype Engine character system
 * Updated Dec 10, 2025 - Includes Title System, Grit Score, Git Gud Log
 */

export interface AcmMetrics {
  pleasureCapacity: number;
  mentalClarity: number;
  physicalVitality: number;
  spiritualAlignment: number;
  lastUpdated: string;
}

export interface RpgLift {
  value: string;       // e.g. "190 lbs" or "[TBD]"
  numericValue?: number;
  target?: string;     // e.g. "210-225 by May 2026"
}

export interface RpgStats {
  squat: RpgLift;
  deadlift: RpgLift;
  benchPress: RpgLift;
  overheadPress?: RpgLift;
}

export interface OverallLevelInfo {
  level: number;
  nextLevel: number;
  nextLevelDate: string;
  daysRemaining: number;
}

// QUEST LINES (The Paladin's Arc)
export interface QuestChapter {
  chapter: string;       // "1 — Foundation" or "BOSS"
  milestone: string;
  status: 'complete' | 'active' | 'locked';
  statusIcon: string;    // raw emoji from the table cell
}

export interface QuestLine {
  id: string;            // "batman-protocol"
  number: number;        // 1, 2, 3…
  name: string;          // "The Batman Protocol"
  icon: string;          // "⚔️"
  class: string;         // "Warrior"
  statusText: string;    // "IN PROGRESS — Season 1, Week 1 (Apr 2026)"
  statusEmoji: string;   // "🟢" | "🟡" | "⬜"
  tagline: string;
  chapters: QuestChapter[];
  currentXpDrivers: string;
  unlocks: string;
}

export interface GrandConvergenceCondition {
  condition: string;
  questLine: string;
  complete: boolean;
}

export interface GrandConvergence {
  conditions: GrandConvergenceCondition[];
  allComplete: boolean;
}

export interface CharacterData {
  name: string;
  overallLevelInfo?: OverallLevelInfo;
  phase: PhaseInfo;
  vitality: VitalityData;
  sleepDebt: SleepDebtData;
  skillTrees: SkillTree[];
  titles: TitleCollection;
  gritScore: GritScoreData;
  gitGudLog: GitGudEntry[];
  lastUpdated: Date;
  sageStreak?: number;
  acmMetrics?: AcmMetrics;
  rpgStats?: RpgStats;
  questLines?: QuestLine[];
  grandConvergence?: GrandConvergence;
}

export interface PhaseInfo {
  current: number;
  name: string;
  startDate: Date;
  endDate: Date;
  daysRemaining: number;
  focus: string;
  targets: PhaseTarget[];
  weeklyVolume: string;
  monthlyBudget: string;
}

export interface PhaseTarget {
  category: 'Strength' | 'Warrior' | 'Redteamer' | 'Sleep' | 'Vitality';
  metric: string;
  current?: string;
  target: string;
  onTrack: boolean;
}

export interface SleepDebtData {
  currentDebt: number;
  trend: 'decreasing' | 'increasing' | 'stable';
  changeFromYesterday: number;
  targetDate?: Date;
  targetDebt: number;
  onTrackForTarget: boolean;
  effectOnVitality: number;
  effectOnConsolidation: number;
}

export interface VitalityData {
  current: number;
  max: number;
  percentage: number;
  status: 'Peak Condition' | 'Excellent' | 'Good' | 'Fair' | 'Low' | 'Critical';
  trend: 'up' | 'down' | 'stable';
  changeFromYesterday: number;
  recoveryFactors: RecoveryFactor[];
}

export interface RecoveryFactor {
  name: string;
  modifier: number;
  description: string;
}

export interface SkillTree {
  id: string;
  name: string;
  icon: string;
  level: number;
  currentXP: number;
  xpToNextLevel: number;
  totalCareerXP: number;
  percentToNext: number;
  tier: string;
  activeBuffs: Buff[];
  weeklyActivity: string;
  weeklyXPRate: number;
  estimatedWeeksToLevel: number;
  rustStatus?: 'sharp' | 'rusty' | 'very-rusty' | 'n/a';
  masteryTracking?: MasteryTracker;
}

export interface MasteryTracker {
  skillName: string;
  attempts: number;
  successes: number;
  successRate: number;
  masteryLevel: number; // 1-10
  masteryTier: string; // Novice, Beginner, Intermediate, etc.
  xpMultiplier: number;
}

export interface Buff {
  name: string;
  description: string;
  effect: string;
  unlockLevel?: number;
  multiplier?: number;
  active: boolean;
}

// TITLE SYSTEM (Solo Leveling Style)
export interface TitleCollection {
  active: Title[];
  locked: LockedTitle[];
  totalTitles: number;
  highestRarity: TitleRarity;
}

export interface Title {
  id: string;
  name: string;
  icon: string;
  rarity: TitleRarity;
  requirement: string;
  effect: string;
  earnedDate: Date;
  equipped: boolean; // Optional: Could allow "equipping" only certain titles
}

export interface LockedTitle {
  id: string;
  name: string;
  icon: string;
  rarity: TitleRarity;
  requirement: string;
  effect: string;
  progress: number; // 0-100
  estimatedUnlock?: Date;
}

export type TitleRarity = 'Mythic' | 'Legendary' | 'Epic' | 'Rare' | 'Uncommon' | 'Common';

// GRIT SCORE (aMCC Training)
export interface GritScoreData {
  current: number; // 0-8
  percentage: number; // 0-100
  checklistItems: GritChecklistItem[];
  streak: number; // Days of 75%+ grit score
  tier: 'Elite' | 'Strong' | 'Good' | 'Moderate' | 'Weak' | 'Crisis';
}

export interface GritChecklistItem {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  icon: string;
}

// GIT GUD LOG (Success Rate Tracking)
export interface GitGudEntry {
  skillTree: string;
  date: Date;
  successfulAttempts: number;
  totalAttempts: number;
  successRate: number;
  details: GitGudDetail[];
}

export interface GitGudDetail {
  task: string;
  status: 'success' | 'failure' | 'pending';
  notes?: string;
}

export interface HistoryEntry {
  date: Date;
  title: string;
  activities: Activity[];
  pendingXP: XPBreakdown;
  permanentXP: XPBreakdown;
  sleep: SleepData;
  energy: EnergyChanges;
  food: FoodData;
  gritScore: GritScoreData;
  gitGudLog: GitGudEntry[];
  consolidationRate: number;
  keyInsights: string[];
  masteryInsight?: string;
  stress: 'Low' | 'Normal' | 'High' | 'Crisis';
  injuries: InjuryData[];
}

export interface InjuryData {
  type: 'Minor' | 'Moderate' | 'Major';
  description: string;
  dayCount: string; // e.g., "Day 2/5"
  xpPenalty: number; // -25%, -50%, etc.
  vitalityPenalty: number; // -1, -2, -3
}

export interface Activity {
  skillTree: string;
  duration: number;
  description: string;
  intensity: number;
  fasted: boolean; // Was this activity done while fasted?
  xpBonus?: number; // Fasted training/dev work bonuses
}

export interface XPBreakdown {
  developer?: number;
  sage?: number;
  warrior?: number;
  artist?: number;
  redteamer?: number;
  total: number;
  details: XPDetail[];
}

export interface XPDetail {
  source: string;
  amount: number;
  multiplier?: number;
  bonus?: string;
}

export interface SleepData {
  bedtime: string;
  wake: string;
  duration: number;
  fitbitScore?: number;
  quality: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  consolidationRate: number;
  consolidationBreakdown: ConsolidationBreakdown;
  sleepOnsetDelay?: number; // minutes to fall asleep
}

export interface ConsolidationBreakdown {
  base: number;
  foodModifier: number;
  fastingModifier: number;
  hydrationModifier: number;
  stressModifier: number;
  sleepOnsetPenalty?: number;
  total: number;
}

export interface EnergyChanges {
  vitality: {
    before: number;
    after: number;
    change: number;
    recoveryBreakdown: RecoveryBreakdown;
  };
  sleepDebt: {
    before: number;
    after: number;
    change: number;
    paydownRate: number;
  };
}

export interface RecoveryBreakdown {
  base: number;
  food: number;
  fasting: number;
  sleepDuration: number;
  hydration: number;
  stress: number;
  injury: number;
  total: number;
  cappedAt?: number;
}

export interface FoodData {
  fastingWindow: string; // "9pm-1:30pm (16hr 30min)"
  fastingTier: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4' | 'None';
  protein: 'High' | 'Medium' | 'Low';
  proteinGrams?: number;
  quality: 'Clean' | 'Mixed' | 'Poor';
  calories: 'Surplus' | 'Maintenance' | 'Deficit';
  estimatedCalories?: number;
  hydration: number; // oz
  vitalityModifier: number;
  consolidationModifier: number;
}

export interface XPUpdateRequest {
  tree: string;
  pendingXP: number;
  breakdown: {
    base?: number;
    completionBonus?: number;
    firstRootBonus?: number;
    doubleRootBonus?: number;
    errorRecoveryBonus?: number;
    fastedBonus?: number;
    [key: string]: number | undefined;
  };
  timestamp: Date;
}

