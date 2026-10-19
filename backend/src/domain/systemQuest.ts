/**
 * System quest rules: shape, Thursday rest day, recovery-only penalties,
 * and hidden-quest masking. Persistence and XP live in the service layer.
 */

export const QUEST_KINDS = ['daily', 'emergency', 'hidden', 'penalty'] as const;
export type QuestKind = (typeof QUEST_KINDS)[number];

export const QUEST_STATUSES = ['active', 'cleared', 'failed', 'expired'] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

export const QUEST_SOURCES = ['grokbot', 'user', 'system'] as const;
export type QuestSource = (typeof QUEST_SOURCES)[number];

/** Real-world penalty shapes. Extra training is intentionally absent. */
export const RECOVERY_TYPES = [
  'earlier_lights_out',
  'mobility',
  'rest',
  'walk',
  'stretch',
  'hydration',
  'nutrition',
  'sleep',
  'meditation',
  'sunlight',
] as const;
export type RecoveryType = (typeof RECOVERY_TYPES)[number];

export const REWARD_APPROVALS = ['not_required', 'pending', 'approved', 'declined'] as const;
export type RewardApproval = (typeof REWARD_APPROVALS)[number];

export interface QuestObjective {
  id: string;
  label: string;
  target: number;
  progress: number;
  done: boolean;
}

export interface QuestPenalty {
  recoveryType: RecoveryType;
  /** Positive amounts. The server subtracts them; callers cannot send negative XP. */
  xpPenalty?: Record<string, number>;
  /** Created only when the parent quest fails or expires. */
  penaltyQuest?: QuestDraft;
}

export interface QuestResolution {
  outcome: 'cleared' | 'failed' | 'expired';
  xpPlanned: ClassXp[];
  xpCommitted: boolean;
  penaltyQuestId?: string;
  at: string;
}

export interface ClassXp {
  className: string;
  xp: number;
}

export interface SystemQuestRecord {
  id: string;
  userId: string;
  idempotencyKey: string;
  kind: QuestKind;
  title: string;
  description: string;
  objectives: QuestObjective[];
  deadline: string | null;
  scheduledFor: string | null;
  xpReward: Record<string, number>;
  rewardNote: string | null;
  rewardCostsMoney: boolean;
  rewardApproval: RewardApproval;
  penalty: QuestPenalty | null;
  status: QuestStatus;
  hiddenUntilRevealed: boolean;
  revealedAt: string | null;
  source: QuestSource;
  training: boolean;
  thursdayTrainingFlag: boolean;
  recoveryType: RecoveryType | null;
  parentQuestId: string | null;
  resolution: QuestResolution | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface QuestDraft {
  idempotencyKey?: string;
  kind?: QuestKind;
  title: string;
  description?: string;
  objectives: Array<{ id?: string; label: string; target?: number; progress?: number; done?: boolean }>;
  deadline?: string | null;
  scheduledFor?: string | null;
  xpReward?: Record<string, number>;
  rewardNote?: string | null;
  rewardCostsMoney?: boolean;
  penalty?: QuestPenalty;
  hiddenUntilRevealed?: boolean;
  training?: boolean;
  recoveryType?: RecoveryType;
  acknowledgeThursdayRest?: boolean;
}

export interface SystemMessageRecord {
  id: string;
  userId: string;
  idempotencyKey: string | null;
  body: string;
  questId: string | null;
  source: QuestSource;
  createdAt: string;
}

export class SystemQuestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const TRAINING_TEXT = /\b(training|workout|work-out|lifting|sparring|hiit|gym)\b/i;

export function calendarDateInChicago(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find(p => p.type === 'year')?.value ?? '0000';
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const d = parts.find(p => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export function isThursdayYmd(ymd: string): boolean {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return false;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 4;
}

export function questCalendarDate(
  input: { scheduledFor?: string | null; deadline?: string | null },
  now: Date,
): string {
  if (input.scheduledFor && /^\d{4}-\d{2}-\d{2}$/.test(input.scheduledFor)) return input.scheduledFor;
  if (input.deadline) {
    const parsed = new Date(input.deadline);
    if (!Number.isNaN(parsed.getTime())) return calendarDateInChicago(parsed);
  }
  return calendarDateInChicago(now);
}

function assertXpMap(value: unknown, field: string, allowEmpty: boolean): Record<string, number> {
  if (value == null) {
    if (allowEmpty) return {};
    throw new SystemQuestError('invalid_quest', `${field} is required`, 400);
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SystemQuestError('invalid_quest', `${field} must be an object of class name to XP`, 400);
  }
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) throw new SystemQuestError('invalid_quest', `${field} has an empty class name`, 400);
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || !Number.isInteger(raw)) {
      throw new SystemQuestError('invalid_quest', `${field}.${key} must be a non-negative integer`, 400);
    }
    if (raw > 0) out[key] = raw;
  }
  return out;
}

function assertRecoveryType(value: unknown, field: string): RecoveryType {
  if (typeof value !== 'string' || !(RECOVERY_TYPES as readonly string[]).includes(value)) {
    throw new SystemQuestError(
      'penalty_must_be_recovery',
      `${field} must be a recovery type (${RECOVERY_TYPES.join(', ')}). Penalties cannot assign extra training.`,
      422,
    );
  }
  return value as RecoveryType;
}

function normalizeObjectives(raw: unknown): QuestObjective[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SystemQuestError('invalid_quest', 'objectives must be a non-empty array', 400);
  }
  if (raw.length > 20) {
    throw new SystemQuestError('invalid_quest', 'objectives cannot exceed 20', 400);
  }
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new SystemQuestError('invalid_quest', `objectives[${index}] must be an object`, 400);
    }
    const row = item as Record<string, unknown>;
    if (typeof row.label !== 'string' || !row.label.trim()) {
      throw new SystemQuestError('invalid_quest', `objectives[${index}].label is required`, 400);
    }
    const target = row.target == null ? 1 : row.target;
    const progress = row.progress == null ? 0 : row.progress;
    if (typeof target !== 'number' || !Number.isInteger(target) || target < 1 || target > 1_000_000) {
      throw new SystemQuestError('invalid_quest', `objectives[${index}].target must be an integer >= 1`, 400);
    }
    if (typeof progress !== 'number' || !Number.isInteger(progress) || progress < 0 || progress > 1_000_000) {
      throw new SystemQuestError('invalid_quest', `objectives[${index}].progress must be a non-negative integer`, 400);
    }
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 80) : `obj-${index + 1}`;
    const done = row.done === true || progress >= target;
    return {
      id,
      label: row.label.trim().slice(0, 300),
      target,
      progress: Math.min(progress, target),
      done,
    };
  });
}

function assertPenalty(penalty: unknown, training: boolean): QuestPenalty | null {
  if (penalty == null) {
    if (training) {
      throw new SystemQuestError(
        'penalty_must_be_recovery',
        'A penalty quest cannot be training. Use a recovery type such as earlier lights-out or mobility.',
        422,
      );
    }
    return null;
  }
  if (typeof penalty !== 'object' || Array.isArray(penalty)) {
    throw new SystemQuestError('invalid_quest', 'penalty must be an object', 400);
  }
  if (training) {
    throw new SystemQuestError(
      'penalty_must_be_recovery',
      'Penalties must be recovery-type (earlier lights-out, mobility, rest), never extra training.',
      422,
    );
  }
  const row = penalty as Record<string, unknown>;
  const recoveryType = assertRecoveryType(row.recoveryType, 'penalty.recoveryType');
  const xpPenalty = row.xpPenalty == null ? undefined : assertXpMap(row.xpPenalty, 'penalty.xpPenalty', true);
  let penaltyQuest: QuestDraft | undefined;
  if (row.penaltyQuest != null) {
    if (typeof row.penaltyQuest !== 'object' || Array.isArray(row.penaltyQuest)) {
      throw new SystemQuestError('invalid_quest', 'penalty.penaltyQuest must be an object', 400);
    }
    const nested = row.penaltyQuest as QuestDraft;
    if (nested.training) {
      throw new SystemQuestError(
        'penalty_must_be_recovery',
        'A linked penalty quest cannot be training.',
        422,
      );
    }
    if (nested.kind && nested.kind !== 'penalty') {
      throw new SystemQuestError('invalid_quest', 'penalty.penaltyQuest.kind must be penalty', 400);
    }
    assertRecoveryType(nested.recoveryType ?? nested.penalty?.recoveryType, 'penalty.penaltyQuest.recoveryType');
    if (!nested.title || typeof nested.title !== 'string') {
      throw new SystemQuestError('invalid_quest', 'penalty.penaltyQuest.title is required', 400);
    }
    normalizeObjectives(nested.objectives);
    penaltyQuest = nested;
  }
  return { recoveryType, ...(xpPenalty && Object.keys(xpPenalty).length ? { xpPenalty } : {}), ...(penaltyQuest ? { penaltyQuest } : {}) };
}

export interface NormalizedQuest {
  draft: {
    kind: QuestKind;
    title: string;
    description: string;
    objectives: QuestObjective[];
    deadline: string | null;
    scheduledFor: string | null;
    xpReward: Record<string, number>;
    rewardNote: string | null;
    rewardCostsMoney: boolean;
    rewardApproval: RewardApproval;
    penalty: QuestPenalty | null;
    hiddenUntilRevealed: boolean;
    training: boolean;
    thursdayTrainingFlag: boolean;
    recoveryType: RecoveryType | null;
  };
  warning: string | null;
}

/**
 * Validate a create payload.
 * Explicit training on a Thursday is rejected (422) unless the player
 * session sets acknowledgeThursdayRest. Service credentials cannot override.
 * Keyword matches are stored as thursdayTrainingFlag so the window can show them.
 */
export function normalizeQuestDraft(
  body: Record<string, unknown>,
  opts: { authKind: 'user' | 'service'; now: Date; internalSource?: QuestSource },
): { idempotencyKey: string; source: QuestSource; quest: NormalizedQuest['draft']; warning: string | null } {
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > 200 || /[\r\n]/.test(idempotencyKey)) {
    throw new SystemQuestError('invalid_quest', 'idempotencyKey is required (1–200 characters)', 400);
  }

  const kind = body.kind;
  if (typeof kind !== 'string' || !(QUEST_KINDS as readonly string[]).includes(kind)) {
    throw new SystemQuestError('invalid_quest', `kind must be one of ${QUEST_KINDS.join(', ')}`, 400);
  }

  if (typeof body.title !== 'string' || !body.title.trim()) {
    throw new SystemQuestError('invalid_quest', 'title is required', 400);
  }
  const title = body.title.trim().slice(0, 200);
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 4000) : '';

  const training = body.training === true;
  const recoveryType = kind === 'penalty'
    ? assertRecoveryType(body.recoveryType ?? (body.penalty as QuestPenalty | undefined)?.recoveryType, 'recoveryType')
    : (body.recoveryType == null ? null : assertRecoveryType(body.recoveryType, 'recoveryType'));

  if (kind === 'penalty' && training) {
    throw new SystemQuestError(
      'penalty_must_be_recovery',
      'Penalty quests must be recovery-type, never extra training.',
      422,
    );
  }

  const penalty = assertPenalty(body.penalty, kind === 'penalty' ? training : false);
  if (kind === 'penalty' && !recoveryType) {
    throw new SystemQuestError('penalty_must_be_recovery', 'Penalty quests require a recoveryType', 422);
  }

  const objectives = normalizeObjectives(body.objectives);
  const xpReward = assertXpMap(body.xpReward, 'xpReward', kind === 'penalty');
  if (kind !== 'penalty' && Object.keys(xpReward).length === 0) {
    throw new SystemQuestError('invalid_quest', 'xpReward must include at least one class', 400);
  }

  let deadline: string | null = null;
  if (body.deadline != null && body.deadline !== '') {
    if (typeof body.deadline !== 'string' || Number.isNaN(new Date(body.deadline).getTime())) {
      throw new SystemQuestError('invalid_quest', 'deadline must be an ISO timestamp', 400);
    }
    deadline = new Date(body.deadline).toISOString();
  }

  let scheduledFor: string | null = null;
  if (body.scheduledFor != null && body.scheduledFor !== '') {
    if (typeof body.scheduledFor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.scheduledFor)) {
      throw new SystemQuestError('invalid_quest', 'scheduledFor must be YYYY-MM-DD', 400);
    }
    scheduledFor = body.scheduledFor;
  }

  const rewardCostsMoney = body.rewardCostsMoney === true;
  const rewardNote = typeof body.rewardNote === 'string' && body.rewardNote.trim()
    ? body.rewardNote.trim().slice(0, 500)
    : null;
  if (rewardCostsMoney && !rewardNote) {
    throw new SystemQuestError('invalid_quest', 'rewardNote is required when rewardCostsMoney is true', 400);
  }

  const onThursday = isThursdayYmd(questCalendarDate({ scheduledFor, deadline }, opts.now));
  const looksLikeTraining = training || TRAINING_TEXT.test(`${title}\n${description}`);
  let thursdayTrainingFlag = false;
  let warning: string | null = null;

  if (onThursday && training) {
    const canOverride = opts.authKind === 'user' && body.acknowledgeThursdayRest === true;
    if (!canOverride) {
      throw new SystemQuestError(
        'thursday_rest_day',
        'Thursday is a rest day. Training quests are not issued. Recovery penalties (earlier lights-out, mobility) are allowed.',
        422,
        { flagged: true },
      );
    }
    thursdayTrainingFlag = true;
    warning = 'Thursday rest day acknowledged by the player. This training quest is flagged.';
  } else if (onThursday && looksLikeTraining && kind !== 'penalty') {
    thursdayTrainingFlag = true;
    warning = 'Thursday rest day: this quest looks like training and is flagged. The System did not block it because training was not set explicitly.';
  }

  let source: QuestSource;
  if (opts.internalSource) {
    source = opts.internalSource;
  } else if (opts.authKind === 'service') {
    source = 'grokbot';
    if (body.source != null && body.source !== 'grokbot') {
      throw new SystemQuestError('invalid_quest', 'Service credentials can only set source to grokbot', 400);
    }
  } else {
    source = body.source == null ? 'user' : (body.source as QuestSource);
    if (source !== 'user' && source !== 'grokbot') {
      throw new SystemQuestError('invalid_quest', 'source must be grokbot or user', 400);
    }
  }

  const hiddenUntilRevealed = kind === 'hidden'
    ? body.hiddenUntilRevealed !== false
    : body.hiddenUntilRevealed === true;

  return {
    idempotencyKey,
    source,
    warning,
    quest: {
      kind: kind as QuestKind,
      title,
      description,
      objectives,
      deadline,
      scheduledFor,
      xpReward,
      rewardNote,
      rewardCostsMoney,
      rewardApproval: rewardCostsMoney ? 'pending' : 'not_required',
      penalty,
      hiddenUntilRevealed,
      training,
      thursdayTrainingFlag,
      recoveryType,
    },
  };
}

export interface PublicQuest {
  id: string;
  kind: QuestKind;
  status: QuestStatus;
  hidden: boolean;
  revealed: boolean;
  source: QuestSource;
  createdAt: string;
  updatedAt: string;
  deadline: string | null;
  scheduledFor: string | null;
  title: string | null;
  description: string | null;
  objectives: QuestObjective[];
  xpReward: Record<string, number>;
  rewardNote: string | null;
  rewardCostsMoney: boolean;
  rewardApproval: RewardApproval;
  penalty: QuestPenalty | null;
  training: boolean;
  thursdayTrainingFlag: boolean;
  recoveryType: RecoveryType | null;
  parentQuestId: string | null;
  resolution: QuestResolution | null;
  resolvedAt: string | null;
}

/** Hidden, unrevealed quests lose their contents in listings and reads. */
export function presentQuest(quest: SystemQuestRecord, opts?: { includeHidden?: boolean }): PublicQuest {
  const sealed = quest.hiddenUntilRevealed && !quest.revealedAt;
  if (sealed && !opts?.includeHidden) {
    return {
      id: quest.id,
      kind: 'hidden',
      status: quest.status,
      hidden: true,
      revealed: false,
      source: quest.source,
      createdAt: quest.createdAt,
      updatedAt: quest.updatedAt,
      deadline: quest.deadline,
      scheduledFor: null,
      title: null,
      description: null,
      objectives: [],
      xpReward: {},
      rewardNote: null,
      rewardCostsMoney: false,
      rewardApproval: 'not_required',
      penalty: null,
      training: false,
      thursdayTrainingFlag: false,
      recoveryType: null,
      parentQuestId: null,
      resolution: null,
      resolvedAt: null,
    };
  }
  return {
    id: quest.id,
    kind: quest.kind,
    status: quest.status,
    hidden: false,
    revealed: !quest.hiddenUntilRevealed || !!quest.revealedAt,
    source: quest.source,
    createdAt: quest.createdAt,
    updatedAt: quest.updatedAt,
    deadline: quest.deadline,
    scheduledFor: quest.scheduledFor,
    title: quest.title,
    description: quest.description,
    objectives: quest.objectives,
    xpReward: quest.xpReward,
    rewardNote: quest.rewardNote,
    rewardCostsMoney: quest.rewardCostsMoney,
    rewardApproval: quest.rewardApproval,
    penalty: quest.penalty,
    training: quest.training,
    thursdayTrainingFlag: quest.thursdayTrainingFlag,
    recoveryType: quest.recoveryType,
    parentQuestId: quest.parentQuestId,
    resolution: quest.resolution,
    resolvedAt: quest.resolvedAt,
  };
}

export function xpMapToAwards(map: Record<string, number> | undefined, sign: 1 | -1): ClassXp[] {
  if (!map) return [];
  return Object.entries(map)
    .filter(([, xp]) => xp > 0)
    .map(([className, xp]) => ({ className, xp: sign * xp }));
}
