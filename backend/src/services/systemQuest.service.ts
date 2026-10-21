import { Server as SocketIOServer } from 'socket.io';
import {
  ClassXp,
  planQuestCorrection,
  presentQuest,
  PublicQuest,
  QuestEdit,
  QuestStatus,
  SystemMessageRecord,
  SystemQuestError,
  SystemQuestRecord,
  normalizeQuestDraft,
  xpMapToAwards,
} from '../domain/systemQuest';
import { emitToUser } from '../realtime/userEmit';
import { getDataService } from './data/dataService';
import { getSystemQuestStore, newQuestId } from './systemQuest.store';
import { ActivityWhenError, resolveActivityWhen } from './activityOccurredAt';
import { persistClassXpAwards } from './xpAward.service';

let io: SocketIOServer | null = null;

export function setSystemSocketIO(socket: SocketIOServer | null): void {
  io = socket;
}

export interface SystemNotice {
  type: 'issued' | 'cleared' | 'failed' | 'expired' | 'revealed' | 'message' | 'progress' | 'edited';
  title: string;
  detail: string;
  questId?: string;
  at: string;
}

function notify(userId: string, notice: SystemNotice): void {
  emitToUser(io, userId, 'system:notice', notice);
}

function isUnique(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

export interface CreateQuestResult {
  quest: PublicQuest;
  created: boolean;
  idempotentReplay: boolean;
  warning: string | null;
}

function blankRecord(
  userId: string,
  idempotencyKey: string,
  source: SystemQuestRecord['source'],
  quest: ReturnType<typeof normalizeQuestDraft>['quest'],
  now: Date,
  parentQuestId: string | null,
): SystemQuestRecord {
  const iso = now.toISOString();
  return {
    id: newQuestId(),
    userId,
    idempotencyKey,
    kind: quest.kind,
    title: quest.title,
    description: quest.description,
    objectives: quest.objectives,
    deadline: quest.deadline,
    scheduledFor: quest.scheduledFor,
    xpReward: quest.xpReward,
    rewardNote: quest.rewardNote,
    rewardCostsMoney: quest.rewardCostsMoney,
    rewardApproval: quest.rewardApproval,
    penalty: quest.penalty,
    status: 'active',
    hiddenUntilRevealed: quest.hiddenUntilRevealed,
    revealedAt: null,
    source,
    training: quest.training,
    thursdayTrainingFlag: quest.thursdayTrainingFlag,
    recoveryType: quest.recoveryType,
    parentQuestId,
    resolution: null,
    edits: [],
    createdAt: iso,
    updatedAt: iso,
    resolvedAt: null,
  };
}

export async function createSystemQuest(
  userId: string,
  body: Record<string, unknown>,
  authKind: 'user' | 'service',
  opts?: { now?: Date; internalSource?: SystemQuestRecord['source']; parentQuestId?: string | null; includeHidden?: boolean },
): Promise<CreateQuestResult> {
  const now = opts?.now ?? new Date();
  const store = getSystemQuestStore();
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (idempotencyKey) {
    const existing = await store.findByIdempotency(userId, idempotencyKey);
    if (existing) {
      return {
        quest: presentQuest(existing, { includeHidden: true }),
        created: false,
        idempotentReplay: true,
        warning: null,
      };
    }
  }

  const normalized = normalizeQuestDraft(body, {
    authKind,
    now,
    internalSource: opts?.internalSource,
  });

  const record = blankRecord(
    userId,
    normalized.idempotencyKey,
    normalized.source,
    normalized.quest,
    now,
    opts?.parentQuestId ?? null,
  );

  let stored: SystemQuestRecord;
  try {
    stored = await store.insert(record);
  } catch (err) {
    if (isUnique(err)) {
      const existing = await store.findByIdempotency(userId, normalized.idempotencyKey);
      if (existing) {
        return {
          quest: presentQuest(existing, { includeHidden: true }),
          created: false,
          idempotentReplay: true,
          warning: null,
        };
      }
    }
    throw err;
  }

  if (stored.deadline && new Date(stored.deadline).getTime() <= now.getTime()) {
    const resolved = await resolveSystemQuest(userId, stored.id, 'expired', { now });
    return {
      quest: resolved.quest,
      created: true,
      idempotentReplay: false,
      warning: normalized.warning,
    };
  }

  const sealed = stored.hiddenUntilRevealed && !stored.revealedAt;
  const presented = presentQuest(stored, { includeHidden: true });
  notify(userId, {
    type: 'issued',
    title: sealed ? 'A hidden quest has been issued' : stored.title,
    detail: sealed
      ? 'The System is withholding the details.'
      : (stored.description || 'A new quest is waiting.'),
    questId: stored.id,
    at: stored.createdAt,
  });

  return { quest: presented, created: true, idempotentReplay: false, warning: normalized.warning };
}

/** Quest XP lands on scheduledFor when that day is a valid activity day; otherwise now. */
function questActivityWhen(quest: SystemQuestRecord) {
  if (!quest.scheduledFor) return resolveActivityWhen({});
  try {
    return resolveActivityWhen({ date: quest.scheduledFor });
  } catch (err) {
    if (err instanceof ActivityWhenError) {
      console.warn(
        `[SYSTEM] scheduledFor ${quest.scheduledFor} is not a usable activity day (${err.message}); using request time`,
      );
      return resolveActivityWhen({});
    }
    throw err;
  }
}

async function commitXp(userId: string, planned: ClassXp[], quest: SystemQuestRecord): Promise<ClassXp[]> {
  const when = questActivityWhen(quest);
  const applied = await persistClassXpAwards(userId, planned, {
    onLevelUp: ({ className, newLevel }) => {
      emitToUser(io, userId, 'level-up', {
        class: className,
        newLevel,
        date: when.date,
        source: 'system-quest',
        questId: quest.id,
      });
    },
  });
  const db = getDataService();
  const total = applied.reduce((sum, row) => sum + row.xp, 0);
  try {
    await db.logActivity(userId, {
      activity_type: `System:${quest.status}:${quest.hiddenUntilRevealed && !quest.revealedAt ? 'hidden' : quest.title}`,
      class_name: applied[0]?.className ?? 'Sage',
      xp_awarded: total,
      notes: `system-quest:${quest.id}`,
      logged_at: when.loggedAt,
    });
  } catch (err) {
    console.error('[SYSTEM] activity log write failed:', err instanceof Error ? err.message : err);
  }
  return applied.map(row => ({ className: row.className, xp: row.xp }));
}

export interface ResolveResult {
  quest: PublicQuest;
  alreadyResolved: boolean;
  xpApplied: ClassXp[];
  changed: boolean;
}

export async function resolveSystemQuest(
  userId: string,
  id: string,
  outcome: 'cleared' | 'failed' | 'expired',
  opts?: { now?: Date },
): Promise<ResolveResult> {
  const now = opts?.now ?? new Date();
  const store = getSystemQuestStore();
  const existing = await store.findById(userId, id);
  if (!existing) throw new SystemQuestError('not_found', 'Quest not found', 404);

  if (existing.status !== 'active') {
    return finishStaleResolution(existing);
  }

  const planned = outcome === 'cleared'
    ? xpMapToAwards(existing.xpReward, 1)
    : xpMapToAwards(existing.penalty?.xpPenalty, -1);

  const iso = now.toISOString();
  const next: SystemQuestRecord = {
    ...existing,
    status: outcome,
    revealedAt: existing.revealedAt ?? iso,
    resolvedAt: iso,
    updatedAt: iso,
    resolution: {
      outcome,
      xpPlanned: planned,
      xpCommitted: false,
      at: iso,
    },
  };

  const cas = await store.compareAndSetStatus(userId, id, 'active', next);
  if (!cas) throw new SystemQuestError('not_found', 'Quest not found', 404);
  if (!cas.changed) return finishStaleResolution(cas.quest);

  let xpApplied: ClassXp[] = [];
  try {
    xpApplied = await commitXp(userId, planned, next);
  } catch (err) {
    const revert: SystemQuestRecord = {
      ...existing,
      status: 'active',
      revealedAt: existing.revealedAt,
      resolvedAt: null,
      resolution: null,
      updatedAt: new Date().toISOString(),
    };
    await store.compareAndSetStatus(userId, id, outcome, revert);
    throw err;
  }

  let penaltyQuestId: string | undefined;
  if (outcome !== 'cleared' && existing.penalty?.penaltyQuest) {
    try {
      const child = await createSystemQuest(
        userId,
        {
          ...existing.penalty.penaltyQuest,
          kind: 'penalty',
          idempotencyKey: existing.penalty.penaltyQuest.idempotencyKey || `penalty:${existing.id}`,
          recoveryType: existing.penalty.penaltyQuest.recoveryType ?? existing.penalty.recoveryType,
          training: false,
        },
        'user',
        { now, internalSource: 'system', parentQuestId: existing.id, includeHidden: true },
      );
      penaltyQuestId = child.quest.id;
    } catch (err) {
      console.error('[SYSTEM] linked penalty quest was not created:', err instanceof Error ? err.message : err);
    }
  }

  const committed: SystemQuestRecord = {
    ...next,
    resolution: {
      outcome,
      xpPlanned: planned,
      xpCommitted: true,
      ...(penaltyQuestId ? { penaltyQuestId } : {}),
      at: iso,
    },
  };
  await store.update(committed);

  const detail = xpApplied.length
    ? xpApplied.map(row => `${row.xp > 0 ? '+' : ''}${row.xp} ${row.className}`).join(', ')
    : (outcome === 'cleared' ? 'Quest cleared.' : 'The penalty has been recorded.');

  notify(userId, {
    type: outcome,
    title: existing.title,
    detail,
    questId: existing.id,
    at: iso,
  });

  return {
    quest: presentQuest(committed),
    alreadyResolved: false,
    xpApplied,
    changed: true,
  };
}

async function finishStaleResolution(existing: SystemQuestRecord): Promise<ResolveResult> {
  if (existing.resolution && existing.resolution.xpCommitted !== true) {
    const applied = await commitXp(existing.userId, existing.resolution.xpPlanned, existing);
    const updated: SystemQuestRecord = {
      ...existing,
      resolution: { ...existing.resolution, xpCommitted: true },
      updatedAt: new Date().toISOString(),
    };
    await getSystemQuestStore().update(updated);
    return {
      quest: presentQuest(updated),
      alreadyResolved: true,
      xpApplied: applied,
      changed: false,
    };
  }
  return {
    quest: presentQuest(existing),
    alreadyResolved: true,
    xpApplied: [],
    changed: false,
  };
}

export async function listSystemQuests(
  userId: string,
  opts?: { status?: QuestStatus; includeHidden?: boolean; now?: Date },
): Promise<{ quests: PublicQuest[]; serverTime: string }> {
  const now = opts?.now ?? new Date();
  await expireDueForUser(userId, now);
  const rows = await getSystemQuestStore().listByUser(userId);
  const filtered = opts?.status ? rows.filter(q => q.status === opts.status) : rows;
  return {
    serverTime: now.toISOString(),
    quests: filtered.map(q => presentQuest(q, { includeHidden: opts?.includeHidden })),
  };
}

export async function getSystemQuest(
  userId: string,
  id: string,
  opts?: { includeHidden?: boolean; now?: Date },
): Promise<PublicQuest> {
  const now = opts?.now ?? new Date();
  await expireDueForUser(userId, now);
  const quest = await getSystemQuestStore().findById(userId, id);
  if (!quest) throw new SystemQuestError('not_found', 'Quest not found', 404);
  return presentQuest(quest, { includeHidden: opts?.includeHidden });
}

async function expireDueForUser(userId: string, now: Date): Promise<void> {
  const due = await getSystemQuestStore().listActiveDue(now.toISOString(), userId);
  for (const quest of due) {
    await resolveSystemQuest(userId, quest.id, 'expired', { now });
  }
}

export async function expireDueQuests(now = new Date()): Promise<number> {
  const due = await getSystemQuestStore().listActiveDue(now.toISOString());
  let changed = 0;
  for (const quest of due) {
    const result = await resolveSystemQuest(quest.userId, quest.id, 'expired', { now });
    if (result.changed) changed += 1;
  }
  return changed;
}

export async function updateQuestProgress(
  userId: string,
  id: string,
  body: { objectiveId?: string; progress?: number; done?: boolean },
): Promise<PublicQuest> {
  const store = getSystemQuestStore();
  const quest = await store.findById(userId, id);
  if (!quest) throw new SystemQuestError('not_found', 'Quest not found', 404);
  if (quest.status !== 'active') {
    throw new SystemQuestError('not_active', 'Only active quests accept progress', 409);
  }
  if (!body.objectiveId) throw new SystemQuestError('invalid_quest', 'objectiveId is required', 400);
  const objective = quest.objectives.find(o => o.id === body.objectiveId);
  if (!objective) throw new SystemQuestError('not_found', 'Objective not found', 404);
  if (body.progress != null) {
    if (typeof body.progress !== 'number' || !Number.isInteger(body.progress) || body.progress < 0) {
      throw new SystemQuestError('invalid_quest', 'progress must be a non-negative integer', 400);
    }
    objective.progress = Math.min(body.progress, objective.target);
  }
  if (body.done === true) objective.progress = objective.target;
  objective.done = body.done === true || objective.progress >= objective.target;
  quest.updatedAt = new Date().toISOString();
  const saved = await store.update(quest);
  notify(userId, {
    type: 'progress',
    title: quest.hiddenUntilRevealed && !quest.revealedAt ? 'Hidden quest updated' : quest.title,
    detail: `${objective.label}: ${objective.progress}/${objective.target}`,
    questId: quest.id,
    at: quest.updatedAt,
  });
  return presentQuest(saved);
}

export interface CorrectQuestResult {
  quest: PublicQuest;
  idempotentReplay: boolean;
  changes: string[];
}

const MAX_STORED_EDITS = 50;

function correctionIdempotencyKey(value: unknown): string {
  const idempotencyKey = typeof value === 'string' ? value.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > 200 || /[\r\n]/.test(idempotencyKey)) {
    throw new SystemQuestError('invalid_quest', 'idempotencyKey is required (1–200 characters)', 400);
  }
  return idempotencyKey;
}

function correctionMessageBody(quest: SystemQuestRecord, edit: QuestEdit): string {
  const sealed = quest.hiddenUntilRevealed && !quest.revealedAt;
  if (sealed) return 'The System corrected a hidden quest.';
  const lines = [
    `The System corrected "${quest.title}".`,
    edit.reason ? `Reason: ${edit.reason}` : null,
    ...edit.changes.map(change => `• ${change}`),
  ].filter((line): line is string => !!line);
  return lines.join('\n').slice(0, 4000);
}

async function ensureCorrectionMessage(userId: string, quest: SystemQuestRecord, edit: QuestEdit): Promise<void> {
  const key = `quest-edit:${quest.id}:${edit.idempotencyKey}`;
  const store = getSystemQuestStore();
  const existing = await store.findMessageByIdempotency(userId, key);
  if (existing) return;
  const message: SystemMessageRecord = {
    id: newQuestId(),
    userId,
    idempotencyKey: key,
    body: correctionMessageBody(quest, edit),
    questId: quest.id,
    source: edit.source,
    createdAt: edit.at,
  };
  try {
    await store.insertMessage(message);
  } catch (err) {
    if (isUnique(err)) return;
    throw err;
  }
}

/**
 * Correct an active quest: objective text and targets, add or remove
 * objectives that have no progress, deadline, and penalty wording.
 * Cleared, failed, and expired quests are rejected. A repeated
 * idempotencyKey returns the quest as it is now and does not apply again.
 */
export async function correctSystemQuest(
  userId: string,
  id: string,
  body: Record<string, unknown>,
  authKind: 'user' | 'service',
): Promise<CorrectQuestResult> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SystemQuestError('invalid_quest', 'body must be an object', 400);
  }
  const idempotencyKey = correctionIdempotencyKey(body.idempotencyKey);
  const store = getSystemQuestStore();
  const existing = await store.findById(userId, id);
  if (!existing) throw new SystemQuestError('not_found', 'Quest not found', 404);

  const prior = (existing.edits ?? []).find(edit => edit.idempotencyKey === idempotencyKey);
  if (prior) {
    await ensureCorrectionMessage(userId, existing, prior);
    return {
      quest: presentQuest(existing, { includeHidden: true }),
      idempotentReplay: true,
      changes: prior.changes,
    };
  }

  if (existing.status !== 'active') {
    throw new SystemQuestError('not_active', 'Only active quests can be corrected', 409);
  }

  const now = new Date();
  const plan = planQuestCorrection(existing, body, now);
  const at = now.toISOString();
  const edit: QuestEdit = {
    idempotencyKey,
    reason: plan.reason,
    changes: plan.changes,
    at,
    source: authKind === 'service' ? 'grokbot' : 'user',
  };
  const next: SystemQuestRecord = {
    ...existing,
    title: plan.title,
    description: plan.description,
    deadline: plan.deadline,
    objectives: plan.objectives,
    xpReward: plan.xpReward,
    penalty: plan.penalty,
    edits: [...(existing.edits ?? []), edit].slice(-MAX_STORED_EDITS),
    updatedAt: at,
  };

  const cas = await store.compareAndSetStatus(userId, id, 'active', next);
  if (!cas) throw new SystemQuestError('not_found', 'Quest not found', 404);
  if (!cas.changed) {
    const raced = (cas.quest.edits ?? []).find(item => item.idempotencyKey === idempotencyKey);
    if (raced) {
      await ensureCorrectionMessage(userId, cas.quest, raced);
      return {
        quest: presentQuest(cas.quest, { includeHidden: true }),
        idempotentReplay: true,
        changes: raced.changes,
      };
    }
    throw new SystemQuestError('not_active', 'Only active quests can be corrected', 409);
  }

  await ensureCorrectionMessage(userId, cas.quest, edit);

  const sealed = cas.quest.hiddenUntilRevealed && !cas.quest.revealedAt;
  const detail = sealed
    ? 'The System adjusted a sealed quest.'
    : (plan.reason ? `${plan.reason} — ${plan.changes.join('; ')}` : plan.changes.join('; ')).slice(0, 500);
  notify(userId, {
    type: 'edited',
    title: sealed ? 'A hidden quest was corrected' : cas.quest.title,
    detail,
    questId: cas.quest.id,
    at,
  });

  return {
    quest: presentQuest(cas.quest, { includeHidden: true }),
    idempotentReplay: false,
    changes: plan.changes,
  };
}

export async function revealSystemQuest(userId: string, id: string): Promise<PublicQuest> {
  const store = getSystemQuestStore();
  const quest = await store.findById(userId, id);
  if (!quest) throw new SystemQuestError('not_found', 'Quest not found', 404);
  if (!quest.revealedAt) {
    quest.revealedAt = new Date().toISOString();
    quest.updatedAt = quest.revealedAt;
    await store.update(quest);
    notify(userId, {
      type: 'revealed',
      title: quest.title,
      detail: quest.description || 'The System reveals a hidden quest.',
      questId: quest.id,
      at: quest.revealedAt,
    });
  }
  return presentQuest(quest);
}

export async function decideRewardApproval(
  userId: string,
  id: string,
  decision: 'approved' | 'declined',
  authKind: 'user' | 'service',
): Promise<PublicQuest> {
  if (authKind === 'service') {
    throw new SystemQuestError(
      'approval_required',
      'Real-world rewards that cost money need the player to approve them. A service credential cannot approve them.',
      403,
    );
  }
  if (decision !== 'approved' && decision !== 'declined') {
    throw new SystemQuestError('invalid_quest', 'decision must be approved or declined', 400);
  }
  const store = getSystemQuestStore();
  const quest = await store.findById(userId, id);
  if (!quest) throw new SystemQuestError('not_found', 'Quest not found', 404);
  if (!quest.rewardCostsMoney) {
    throw new SystemQuestError('invalid_quest', 'This quest has no money reward awaiting approval', 400);
  }
  quest.rewardApproval = decision;
  quest.updatedAt = new Date().toISOString();
  const saved = await store.update(quest);
  return presentQuest(saved);
}

export async function postSystemMessage(
  userId: string,
  body: Record<string, unknown>,
  authKind: 'user' | 'service',
): Promise<{ message: SystemMessageRecord; idempotentReplay: boolean }> {
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) throw new SystemQuestError('invalid_message', 'body is required', 400);
  if (text.length > 4000) throw new SystemQuestError('invalid_message', 'body cannot exceed 4000 characters', 400);
  const key = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
    ? body.idempotencyKey.trim().slice(0, 200)
    : null;
  const store = getSystemQuestStore();
  if (key) {
    const existing = await store.findMessageByIdempotency(userId, key);
    if (existing) return { message: existing, idempotentReplay: true };
  }
  const message: SystemMessageRecord = {
    id: newQuestId(),
    userId,
    idempotencyKey: key,
    body: text,
    questId: typeof body.questId === 'string' ? body.questId : null,
    source: authKind === 'service' ? 'grokbot' : 'user',
    createdAt: new Date().toISOString(),
  };
  try {
    await store.insertMessage(message);
  } catch (err) {
    if (isUnique(err) && key) {
      const existing = await store.findMessageByIdempotency(userId, key);
      if (existing) return { message: existing, idempotentReplay: true };
    }
    throw err;
  }
  notify(userId, {
    type: 'message',
    title: 'System message',
    detail: text,
    questId: message.questId ?? undefined,
    at: message.createdAt,
  });
  return { message, idempotentReplay: false };
}

export async function listSystemMessages(userId: string, limit = 50): Promise<SystemMessageRecord[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  return getSystemQuestStore().listMessages(userId, capped);
}
