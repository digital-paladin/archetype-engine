import { SupabaseClient } from '@supabase/supabase-js';

// ─── Domain types ──────────────────────────────────────────────────────────

export interface CharacterStats {
  id?: string;
  user_id: string;
  class_name: string;
  level: number;
  current_xp: number;
  total_xp: number;
  updated_at?: string;
}

export interface JournalEntry {
  id?: string;
  user_id: string;
  entry_date: string;        // YYYY-MM-DD
  sleep_hours?: number;
  sleep_start?: string;      // HH:MM
  sleep_end?: string;        // HH:MM
  fitbit_score?: number;
  fasting_hours?: number;
  hydration_oz?: number;
  protein_level?: 'low' | 'medium' | 'high';
  protein_grams_logged?: number;
  meal_count?: number;
  food_log?: Array<{ item: string; protein: number; calories: number; ts: string }>;
  food_quality?: 'poor' | 'mixed' | 'mixed/good' | 'good' | 'excellent';
  calories_status?: 'deficit' | 'maintenance' | 'surplus';
  stress_level?: 'low' | 'medium' | 'high';
  energy_score?: number;
  mental_state?: string;
  notes?: string;
  ai_summary?: string;
}

export interface ACMEntry {
  id?: string;
  journal_entry_id: string;
  item_index: number;        // 0-based, 0–14
  completed: boolean;
  completed_at?: string;
}

export interface QuestEntry {
  id?: string;
  user_id: string;
  entry_date: string;
  class_name: string;
  quest_label: string;
  content?: string;
  updated_at?: string;
}

export interface ActivityEntry {
  id?: string;
  user_id: string;
  logged_at?: string;
  class_name: string;
  activity_type: string;
  duration_hours?: number;
  xp_awarded?: number;
  notes?: string;
}

export interface VaultItem {
  id?: string;
  user_id: string;
  item_name: string;
  quantity: number;
  rarity?: 'normal' | 'fine' | 'superior' | 'epic' | 'legendary';
  acquired_at?: string;
}

export interface FitbitTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;       // unix ms
  fitbit_user_id?: string;  // Fitbit's own user ID (informational)
}

/** Multi-provider wearable OAuth tokens (oura | garmin | whoop | fitbit). */
export interface WearableTokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
  scope?: string;
}

export interface SpendingEntry {
  id?: string;
  user_id?: string;
  date: string;         // YYYY-MM-DD
  amount: number;
  merchant: string;
  category: string;
  notes?: string;
}

export interface TreasurySettings {
  user_id?: string;
  budgets: Record<string, number>;
  currency: string;
  current_month?: string;  // YYYY-MM
}

export interface XPHistoryEntry {
  id?: string;
  user_id: string;
  earned_at: string;
  class_name: string;
  xp_pending: number;
  xp_confirmed: number;
  consolidation_pct?: number;
  fitbit_score?: number;
  streak_days?: number;
  notes?: string;
}

export interface CharacterProfile {
  user_id?: string;
  vitality?: number;
  sleep_debt?: number;
  sleep_trend?: string;   // 'Increased' | 'Decreased' | 'Stable'
  sage_streak?: number;
  phase?: string;
  acm_metrics?: Record<string, unknown>;
  rpg_stats?: Record<string, unknown>;
  updated_at?: string;
}

export interface QuestLineEntry {
  id?: string;
  user_id?: string;
  quest_number?: number;
  name: string;
  icon?: string;
  class_name?: string;
  status_text?: string;
  status_emoji?: string;
  tagline?: string;
  chapters?: Array<{ chapter: string; milestone: string; status: string; statusIcon: string }>;
  current_xp_drivers?: string;
  unlocks?: string;
  sort_order?: number;
  updated_at?: string;
}

export interface GrandConvergenceData {
  user_id?: string;
  conditions?: Array<{ condition: string; questLine: string; complete: boolean }>;
  updated_at?: string;
}

// ─── Interface ─────────────────────────────────────────────────────────────

export interface IDataService {
  // ── Character ──────────────────────────────────────────────────────────
  getCharacterStats(userId: string): Promise<CharacterStats[]>;
  upsertCharacterStats(userId: string, stats: Partial<CharacterStats>): Promise<void>;
  getXPHistory(userId: string, limit?: number): Promise<XPHistoryEntry[]>;
  appendXPHistory(userId: string, entry: Omit<XPHistoryEntry, 'id' | 'user_id'>): Promise<void>;

  // ── Journal ────────────────────────────────────────────────────────────
  getJournalEntry(userId: string, date: string): Promise<JournalEntry | null>;
  upsertJournalEntry(userId: string, entry: Partial<JournalEntry>): Promise<void>;

  // ── ACM ────────────────────────────────────────────────────────────────
  getACMEntries(userId: string, date: string): Promise<ACMEntry[]>;
  updateACMEntries(userId: string, date: string, items: boolean[]): Promise<void>;

  // ── Quests ─────────────────────────────────────────────────────────────
  getQuestEntries(userId: string, date: string): Promise<QuestEntry[]>;
  upsertQuestEntry(userId: string, date: string, className: string, label: string, content: string): Promise<void>;

  // ── Activity ───────────────────────────────────────────────────────────
  logActivity(userId: string, activity: Omit<ActivityEntry, 'id' | 'user_id'>): Promise<void>;
  getActivityLog(userId: string, limit?: number): Promise<ActivityEntry[]>;

  // ── Vault ──────────────────────────────────────────────────────────────
  getVaultItems(userId: string): Promise<VaultItem[]>;
  upsertVaultItem(userId: string, item: Partial<VaultItem>): Promise<void>;

  // ── Fitbit tokens ──────────────────────────────────────────────────────
  getFitbitTokens(userId: string): Promise<FitbitTokens | null>;
  saveFitbitTokens(userId: string, tokens: FitbitTokens): Promise<void>;

  // ── Wearable tokens (Oura / Garmin / …) ────────────────────────────────
  getWearableTokens(userId: string, provider: string): Promise<WearableTokenRow | null>;
  saveWearableTokens(userId: string, provider: string, tokens: WearableTokenRow): Promise<void>;

  // ── Treasury ───────────────────────────────────────────────────────────
  getSpendingEntries(userId: string, month?: string): Promise<SpendingEntry[]>;
  addSpendingEntry(userId: string, entry: Omit<SpendingEntry, 'id' | 'user_id'>): Promise<SpendingEntry>;
  deleteSpendingEntry(userId: string, id: string): Promise<void>;
  getTreasurySettings(userId: string): Promise<TreasurySettings | null>;
  upsertTreasurySettings(userId: string, settings: Partial<TreasurySettings>): Promise<void>;

  // ── Character Profile ─────────────────────────────────────────────────────
  getCharacterProfile(userId: string): Promise<CharacterProfile | null>;
  upsertCharacterProfile(userId: string, profile: Partial<CharacterProfile>): Promise<void>;

  // ── Quest Lines ───────────────────────────────────────────────────────────
  getQuestLines(userId: string): Promise<QuestLineEntry[]>;
  upsertQuestLines(userId: string, questLines: QuestLineEntry[]): Promise<void>;
  getGrandConvergence(userId: string): Promise<GrandConvergenceData | null>;
  upsertGrandConvergence(userId: string, data: Partial<GrandConvergenceData>): Promise<void>;
}
