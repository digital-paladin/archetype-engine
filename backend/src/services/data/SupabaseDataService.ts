import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../../lib/supabase';
import {
  IDataService,
  CharacterStats, XPHistoryEntry,
  JournalEntry, ACMEntry, QuestEntry,
  ActivityEntry, VaultItem, FitbitTokens, WearableTokenRow,
  SpendingEntry, TreasurySettings,
  CharacterProfile,
  QuestLineEntry, GrandConvergenceData,
} from './IDataService';

export class SupabaseDataService implements IDataService {
  private readonly db: SupabaseClient;

  constructor() {
    this.db = getSupabaseAdmin();
  }

  // ── Character ────────────────────────────────────────────────────────────

  async getCharacterStats(userId: string): Promise<CharacterStats[]> {
    const { data, error } = await this.db
      .from('character_stats')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    return data ?? [];
  }

  async upsertCharacterStats(userId: string, stats: Partial<CharacterStats>): Promise<void> {
    const { error } = await this.db
      .from('character_stats')
      .upsert({ ...stats, user_id: userId, updated_at: new Date().toISOString() },
               { onConflict: 'user_id,class_name' });
    if (error) throw error;
  }

  async getXPHistory(userId: string, limit = 30): Promise<XPHistoryEntry[]> {
    const { data, error } = await this.db
      .from('xp_history')
      .select('*')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async appendXPHistory(userId: string, entry: Omit<XPHistoryEntry, 'id' | 'user_id'>): Promise<void> {
    const { error } = await this.db
      .from('xp_history')
      .insert({ ...entry, user_id: userId });
    if (error) throw error;
  }

  // ── Journal ──────────────────────────────────────────────────────────────

  async getJournalEntry(userId: string, date: string): Promise<JournalEntry | null> {
    const { data, error } = await this.db
      .from('daily_journal_entries')
      .select('*')
      .eq('user_id', userId)
      .eq('entry_date', date)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async upsertJournalEntry(userId: string, entry: Partial<JournalEntry>): Promise<void> {
    const { error } = await this.db
      .from('daily_journal_entries')
      .upsert({ ...entry, user_id: userId },
               { onConflict: 'user_id,entry_date' });
    if (error) throw error;
  }

  // ── ACM ──────────────────────────────────────────────────────────────────

  async getACMEntries(userId: string, date: string): Promise<ACMEntry[]> {
    const { data: journal, error: je } = await this.db
      .from('daily_journal_entries')
      .select('id')
      .eq('user_id', userId)
      .eq('entry_date', date)
      .maybeSingle();
    if (je) throw je;
    if (!journal) return [];

    const { data, error } = await this.db
      .from('acm_entries')
      .select('*')
      .eq('journal_entry_id', journal.id)
      .order('item_index');
    if (error) throw error;
    return data ?? [];
  }

  async updateACMEntries(userId: string, date: string, items: boolean[]): Promise<void> {
    // Ensure journal entry row exists first
    await this.upsertJournalEntry(userId, { entry_date: date });

    const { data: journal, error: je } = await this.db
      .from('daily_journal_entries')
      .select('id')
      .eq('user_id', userId)
      .eq('entry_date', date)
      .single();
    if (je) throw je;

    const rows = items.map((completed, item_index) => ({
      journal_entry_id: journal.id,
      item_index,
      completed,
      completed_at: completed ? new Date().toISOString() : null,
    }));

    const { error } = await this.db
      .from('acm_entries')
      .upsert(rows, { onConflict: 'journal_entry_id,item_index' });
    if (error) throw error;
  }

  // ── Quests ───────────────────────────────────────────────────────────────

  async getQuestEntries(userId: string, date: string): Promise<QuestEntry[]> {
    const { data, error } = await this.db
      .from('quest_entries')
      .select('*')
      .eq('user_id', userId)
      .eq('entry_date', date)
      .order('class_name');
    if (error) throw error;
    return data ?? [];
  }

  async upsertQuestEntry(userId: string, date: string, className: string, label: string, content: string): Promise<void> {
    const { error } = await this.db
      .from('quest_entries')
      .upsert({
        user_id: userId,
        entry_date: date,
        class_name: className,
        quest_label: label,
        content,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,entry_date,class_name,quest_label' });
    if (error) throw error;
  }

  // ── Activity ─────────────────────────────────────────────────────────────

  async logActivity(userId: string, activity: Omit<ActivityEntry, 'id' | 'user_id'>): Promise<void> {
    const { error } = await this.db
      .from('activity_log')
      .insert({ ...activity, user_id: userId });
    if (error) throw error;
  }

  async getActivityLog(userId: string, limit = 50): Promise<ActivityEntry[]> {
    const { data, error } = await this.db
      .from('activity_log')
      .select('*')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  // ── Vault ────────────────────────────────────────────────────────────────

  async getVaultItems(userId: string): Promise<VaultItem[]> {
    const { data, error } = await this.db
      .from('vault_items')
      .select('*')
      .eq('user_id', userId)
      .order('acquired_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async upsertVaultItem(userId: string, item: Partial<VaultItem>): Promise<void> {
    const { error } = await this.db
      .from('vault_items')
      .upsert({ ...item, user_id: userId });
    if (error) throw error;
  }

  // ── Fitbit tokens ────────────────────────────────────────────────────────

  async getFitbitTokens(userId: string): Promise<FitbitTokens | null> {
    const { data, error } = await this.db
      .from('fitbit_tokens')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    // TODO Phase 2: decrypt tokens here (column-level encryption)
    return {
      access_token:   data.access_token_encrypted,
      refresh_token:  data.refresh_token_encrypted,
      expires_at:     Number(data.expires_at),
      fitbit_user_id: data.fitbit_user_id ?? undefined,
    };
  }

  async saveFitbitTokens(userId: string, tokens: FitbitTokens): Promise<void> {
    // TODO Phase 2: encrypt tokens before storing
    const { error } = await this.db
      .from('fitbit_tokens')
      .upsert({
        user_id:                 userId,
        access_token_encrypted:  tokens.access_token,
        refresh_token_encrypted: tokens.refresh_token,
        expires_at:              tokens.expires_at,
        fitbit_user_id:          tokens.fitbit_user_id ?? null,
      }, { onConflict: 'user_id' });
    if (error) throw error;
  }

  // ── Wearable tokens (multi-provider) ─────────────────────────────────────

  async getWearableTokens(userId: string, provider: string): Promise<WearableTokenRow | null> {
    const { data, error } = await this.db
      .from('wearable_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      access_token:  data.access_token_encrypted,
      refresh_token: data.refresh_token_encrypted,
      expires_at:    new Date(data.expires_at).getTime(),
      scope:         data.scope ?? undefined,
    };
  }

  async saveWearableTokens(
    userId: string,
    provider: string,
    tokens: WearableTokenRow,
  ): Promise<void> {
    const { error } = await this.db
      .from('wearable_tokens')
      .upsert({
        user_id:                userId,
        provider,
        access_token_encrypted: tokens.access_token,
        refresh_token_encrypted: tokens.refresh_token,
        expires_at:             new Date(tokens.expires_at).toISOString(),
        scope:                  tokens.scope ?? null,
      }, { onConflict: 'user_id,provider' });
    if (error) throw error;
  }

  // ── Treasury ─────────────────────────────────────────────────────────────

  private monthBounds(yyyyMM: string): { start: string; end: string } {
    const [y, m] = yyyyMM.split('-').map(Number);
    const end = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return { start: `${yyyyMM}-01`, end };
  }

  async getSpendingEntries(userId: string, month?: string): Promise<SpendingEntry[]> {
    let q = this.db.from('spending_entries').select('*').eq('user_id', userId);
    if (month) {
      const { start, end } = this.monthBounds(month);
      q = q.gte('date', start).lt('date', end);
    }
    const { data, error } = await (q as any).order('date', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SpendingEntry[];
  }

  async addSpendingEntry(userId: string, entry: Omit<SpendingEntry, 'id' | 'user_id'>): Promise<SpendingEntry> {
    const { data, error } = await this.db
      .from('spending_entries')
      .insert({ ...entry, user_id: userId })
      .select()
      .single();
    if (error) throw error;
    return data as SpendingEntry;
  }

  async deleteSpendingEntry(userId: string, id: string): Promise<void> {
    const { error } = await this.db
      .from('spending_entries')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  }

  async getTreasurySettings(userId: string): Promise<TreasurySettings | null> {
    const { data, error } = await this.db
      .from('treasury_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data as TreasurySettings | null;
  }

  async upsertTreasurySettings(userId: string, settings: Partial<TreasurySettings>): Promise<void> {
    const { error } = await this.db
      .from('treasury_settings')
      .upsert({ ...settings, user_id: userId, updated_at: new Date().toISOString() },
               { onConflict: 'user_id' });
    if (error) throw error;
  }

  // ── Character Profile ─────────────────────────────────────────────────────

  async getCharacterProfile(userId: string): Promise<CharacterProfile | null> {
    const { data, error } = await this.db
      .from('character_profile')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data as CharacterProfile | null;
  }

  async upsertCharacterProfile(userId: string, profile: Partial<CharacterProfile>): Promise<void> {
    const { error } = await this.db
      .from('character_profile')
      .upsert({ ...profile, user_id: userId, updated_at: new Date().toISOString() },
               { onConflict: 'user_id' });
    if (error) throw error;
  }

  // ── Quest Lines ────────────────────────────────────────────────────────

  async getQuestLines(userId: string): Promise<QuestLineEntry[]> {
    const { data, error } = await this.db
      .from('quest_lines')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as QuestLineEntry[];
  }

  async upsertQuestLines(userId: string, questLines: QuestLineEntry[]): Promise<void> {
    // Delete existing quest lines for this user then insert fresh
    await this.db.from('quest_lines').delete().eq('user_id', userId);
    if (questLines.length === 0) return;
    const rows = questLines.map((ql, idx) => {
      const { id: _id, user_id: _uid, ...rest } = ql;
      return {
        ...rest,
        user_id:    userId,
        sort_order: ql.sort_order ?? idx,
        updated_at: new Date().toISOString(),
      };
    });
    const { error } = await this.db.from('quest_lines').insert(rows);
    if (error) throw error;
  }

  async getGrandConvergence(userId: string): Promise<GrandConvergenceData | null> {
    const { data, error } = await this.db
      .from('grand_convergence')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data as GrandConvergenceData | null;
  }

  async upsertGrandConvergence(userId: string, data: Partial<GrandConvergenceData>): Promise<void> {
    const { error } = await this.db
      .from('grand_convergence')
      .upsert({ ...data, user_id: userId, updated_at: new Date().toISOString() },
               { onConflict: 'user_id' });
    if (error) throw error;
  }
}
