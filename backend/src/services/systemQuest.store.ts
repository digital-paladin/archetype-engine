import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from '../lib/supabase';
import {
  QuestObjective,
  QuestPenalty,
  QuestResolution,
  QuestKind,
  QuestSource,
  QuestStatus,
  RecoveryType,
  RewardApproval,
  SystemMessageRecord,
  SystemQuestRecord,
} from '../domain/systemQuest';

export interface SystemQuestStore {
  findByIdempotency(userId: string, key: string): Promise<SystemQuestRecord | null>;
  findById(userId: string, id: string): Promise<SystemQuestRecord | null>;
  insert(quest: SystemQuestRecord): Promise<SystemQuestRecord>;
  update(quest: SystemQuestRecord): Promise<SystemQuestRecord>;
  /**
   * Write `next` only when the row is still `from`. Returns null when the
   * quest is missing. `changed` is false when another resolution won the race.
   */
  compareAndSetStatus(
    userId: string,
    id: string,
    from: QuestStatus,
    next: SystemQuestRecord,
  ): Promise<{ quest: SystemQuestRecord; changed: boolean } | null>;
  listByUser(userId: string): Promise<SystemQuestRecord[]>;
  listActiveDue(nowIso: string, userId?: string): Promise<SystemQuestRecord[]>;
  insertMessage(message: SystemMessageRecord): Promise<SystemMessageRecord>;
  findMessageByIdempotency(userId: string, key: string): Promise<SystemMessageRecord | null>;
  listMessages(userId: string, limit: number): Promise<SystemMessageRecord[]>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MemorySystemQuestStore implements SystemQuestStore {
  private quests: SystemQuestRecord[] = [];
  private messages: SystemMessageRecord[] = [];

  async findByIdempotency(userId: string, key: string): Promise<SystemQuestRecord | null> {
    return clone(this.quests.find(q => q.userId === userId && q.idempotencyKey === key) ?? null);
  }

  async findById(userId: string, id: string): Promise<SystemQuestRecord | null> {
    return clone(this.quests.find(q => q.userId === userId && q.id === id) ?? null);
  }

  async insert(quest: SystemQuestRecord): Promise<SystemQuestRecord> {
    if (this.quests.some(q => q.userId === quest.userId && q.idempotencyKey === quest.idempotencyKey)) {
      const err = new Error('duplicate key') as Error & { code: string };
      err.code = '23505';
      throw err;
    }
    this.quests.push(clone(quest));
    return clone(quest);
  }

  async update(quest: SystemQuestRecord): Promise<SystemQuestRecord> {
    const idx = this.quests.findIndex(q => q.userId === quest.userId && q.id === quest.id);
    if (idx < 0) throw new Error('quest not found');
    this.quests[idx] = clone(quest);
    return clone(quest);
  }

  async compareAndSetStatus(
    userId: string,
    id: string,
    from: QuestStatus,
    next: SystemQuestRecord,
  ): Promise<{ quest: SystemQuestRecord; changed: boolean } | null> {
    const idx = this.quests.findIndex(q => q.userId === userId && q.id === id);
    if (idx < 0) return null;
    if (this.quests[idx].status !== from) return { quest: clone(this.quests[idx]), changed: false };
    this.quests[idx] = clone(next);
    return { quest: clone(next), changed: true };
  }

  async listByUser(userId: string): Promise<SystemQuestRecord[]> {
    return this.quests.filter(q => q.userId === userId).map(q => clone(q));
  }

  async listActiveDue(nowIso: string, userId?: string): Promise<SystemQuestRecord[]> {
    const now = new Date(nowIso).getTime();
    return this.quests
      .filter(q => q.status === 'active' && q.deadline && new Date(q.deadline).getTime() <= now)
      .filter(q => !userId || q.userId === userId)
      .map(q => clone(q));
  }

  async insertMessage(message: SystemMessageRecord): Promise<SystemMessageRecord> {
    if (message.idempotencyKey && this.messages.some(m => m.userId === message.userId && m.idempotencyKey === message.idempotencyKey)) {
      const err = new Error('duplicate key') as Error & { code: string };
      err.code = '23505';
      throw err;
    }
    this.messages.push(clone(message));
    return clone(message);
  }

  async findMessageByIdempotency(userId: string, key: string): Promise<SystemMessageRecord | null> {
    return clone(this.messages.find(m => m.userId === userId && m.idempotencyKey === key) ?? null);
  }

  async listMessages(userId: string, limit: number): Promise<SystemMessageRecord[]> {
    return this.messages
      .filter(m => m.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(m => clone(m));
  }
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === '23505';
}

function rowToQuest(row: Record<string, unknown>): SystemQuestRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    idempotencyKey: String(row.idempotency_key),
    kind: row.kind as QuestKind,
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    objectives: (row.objectives as QuestObjective[]) ?? [],
    deadline: row.deadline ? new Date(String(row.deadline)).toISOString() : null,
    scheduledFor: row.scheduled_for ? String(row.scheduled_for).slice(0, 10) : null,
    xpReward: (row.xp_reward as Record<string, number>) ?? {},
    rewardNote: row.reward_note ? String(row.reward_note) : null,
    rewardCostsMoney: row.reward_costs_money === true,
    rewardApproval: (row.reward_approval as RewardApproval) ?? 'not_required',
    penalty: (row.penalty as QuestPenalty | null) ?? null,
    status: row.status as QuestStatus,
    hiddenUntilRevealed: row.hidden_until_revealed === true,
    revealedAt: row.revealed_at ? new Date(String(row.revealed_at)).toISOString() : null,
    source: row.source as QuestSource,
    training: row.training === true,
    thursdayTrainingFlag: row.thursday_training_flag === true,
    recoveryType: (row.recovery_type as RecoveryType | null) ?? null,
    parentQuestId: row.parent_quest_id ? String(row.parent_quest_id) : null,
    resolution: (row.resolution as QuestResolution | null) ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)).toISOString() : null,
  };
}

function questToRow(quest: SystemQuestRecord): Record<string, unknown> {
  return {
    id: quest.id,
    user_id: quest.userId,
    idempotency_key: quest.idempotencyKey,
    kind: quest.kind,
    title: quest.title,
    description: quest.description,
    objectives: quest.objectives,
    deadline: quest.deadline,
    scheduled_for: quest.scheduledFor,
    xp_reward: quest.xpReward,
    reward_note: quest.rewardNote,
    reward_costs_money: quest.rewardCostsMoney,
    reward_approval: quest.rewardApproval,
    penalty: quest.penalty,
    status: quest.status,
    hidden_until_revealed: quest.hiddenUntilRevealed,
    revealed_at: quest.revealedAt,
    source: quest.source,
    training: quest.training,
    thursday_training_flag: quest.thursdayTrainingFlag,
    recovery_type: quest.recoveryType,
    parent_quest_id: quest.parentQuestId,
    resolution: quest.resolution,
    created_at: quest.createdAt,
    updated_at: quest.updatedAt,
    resolved_at: quest.resolvedAt,
  };
}

function rowToMessage(row: Record<string, unknown>): SystemMessageRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    body: String(row.body ?? ''),
    questId: row.quest_id ? String(row.quest_id) : null,
    source: row.source as QuestSource,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export class SupabaseSystemQuestStore implements SystemQuestStore {
  async findByIdempotency(userId: string, key: string): Promise<SystemQuestRecord | null> {
    const { data, error } = await getSupabaseAdmin()
      .from('system_quests')
      .select('*')
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToQuest(data) : null;
  }

  async findById(userId: string, id: string): Promise<SystemQuestRecord | null> {
    const { data, error } = await getSupabaseAdmin()
      .from('system_quests')
      .select('*')
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToQuest(data) : null;
  }

  async insert(quest: SystemQuestRecord): Promise<SystemQuestRecord> {
    const { data, error } = await getSupabaseAdmin()
      .from('system_quests')
      .insert(questToRow(quest))
      .select('*')
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const err = new Error(error.message) as Error & { code: string };
        err.code = '23505';
        throw err;
      }
      throw error;
    }
    return rowToQuest(data);
  }

  async update(quest: SystemQuestRecord): Promise<SystemQuestRecord> {
    const { data, error } = await getSupabaseAdmin()
      .from('system_quests')
      .update(questToRow(quest))
      .eq('user_id', quest.userId)
      .eq('id', quest.id)
      .select('*')
      .single();
    if (error) throw error;
    return rowToQuest(data);
  }

  async compareAndSetStatus(
    userId: string,
    id: string,
    from: QuestStatus,
    next: SystemQuestRecord,
  ): Promise<{ quest: SystemQuestRecord; changed: boolean } | null> {
    const { data, error } = await getSupabaseAdmin()
      .from('system_quests')
      .update(questToRow(next))
      .eq('user_id', userId)
      .eq('id', id)
      .eq('status', from)
      .select('*');
    if (error) throw error;
    if (data && data.length > 0) return { quest: rowToQuest(data[0]), changed: true };
    const current = await this.findById(userId, id);
    if (!current) return null;
    return { quest: current, changed: false };
  }

  async listByUser(userId: string): Promise<SystemQuestRecord[]> {
    const { data, error } = await getSupabaseAdmin()
      .from('system_quests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(row => rowToQuest(row));
  }

  async listActiveDue(nowIso: string, userId?: string): Promise<SystemQuestRecord[]> {
    let query = getSupabaseAdmin()
      .from('system_quests')
      .select('*')
      .eq('status', 'active')
      .not('deadline', 'is', null)
      .lte('deadline', nowIso);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(row => rowToQuest(row));
  }

  async insertMessage(message: SystemMessageRecord): Promise<SystemMessageRecord> {
    const { data, error } = await getSupabaseAdmin()
      .from('system_messages')
      .insert({
        id: message.id,
        user_id: message.userId,
        idempotency_key: message.idempotencyKey,
        body: message.body,
        quest_id: message.questId,
        source: message.source,
        created_at: message.createdAt,
      })
      .select('*')
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const err = new Error(error.message) as Error & { code: string };
        err.code = '23505';
        throw err;
      }
      throw error;
    }
    return rowToMessage(data);
  }

  async findMessageByIdempotency(userId: string, key: string): Promise<SystemMessageRecord | null> {
    const { data, error } = await getSupabaseAdmin()
      .from('system_messages')
      .select('*')
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToMessage(data) : null;
  }

  async listMessages(userId: string, limit: number): Promise<SystemMessageRecord[]> {
    const { data, error } = await getSupabaseAdmin()
      .from('system_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(row => rowToMessage(row));
  }
}

let store: SystemQuestStore | null = null;

export function getSystemQuestStore(): SystemQuestStore {
  if (!store) store = new SupabaseSystemQuestStore();
  return store;
}

export function setSystemQuestStore(next: SystemQuestStore | null): void {
  store = next;
}

export function newQuestId(): string {
  return randomUUID();
}
