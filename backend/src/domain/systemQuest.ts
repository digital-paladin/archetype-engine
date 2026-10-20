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

/** One applied correction. The idempotency key makes a retry of the same edit a no-op. */
export interface QuestEdit {
  idempotencyKey: string;
  reason: string | null;
  changes: string[];
  at: string;
  source: QuestSource;
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
  /** Append-only. Empty until the first correction. */
  edits: QuestEdit[];
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
  editedAt: string | null;
  editCount: number;
  /** Player-visible reason from the latest correction. Null while the quest is sealed. */
  lastEditReason: string | null;
}

function editMarker(quest: SystemQuestRecord, revealReason: boolean): Pick<PublicQuest, 'editedAt' | 'editCount' | 'lastEditReason'> {
  const edits = quest.edits ?? [];
  const last = edits.length ? edits[edits.length - 1] : null;
  return {
    editedAt: last?.at ?? null,
    editCount: edits.length,
    lastEditReason: revealReason ? (last?.reason ?? null) : null,
  };
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
      ...editMarker(quest, false),
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
    ...editMarker(quest, true),
  };
}

export function xpMapToAwards(map: Record<string, number> | undefined, sign: 1 | -1): ClassXp[] {
  if (!map) return [];
  return Object.entries(map)
    .filter(([, xp]) => xp > 0)
    .map(([className, xp]) => ({ className, xp: sign * xp }));
}

const CORRECTION_FIELDS = new Set([
  'idempotencyKey',
  'reason',
  'acknowledgeXpIncrease',
  'title',
  'description',
  'deadline',
  'objectives',
  'xpReward',
  'penalty',
]);

export interface QuestCorrectionPlan {
  title: string;
  description: string;
  deadline: string | null;
  objectives: QuestObjective[];
  xpReward: Record<string, number>;
  penalty: QuestPenalty | null;
  reason: string | null;
  changes: string[];
}

/**
 * Plan a correction of an active quest. Does not check status or idempotency.
 * Raising xpReward or penalty.xpPenalty requires acknowledgeXpIncrease so the
 * increase cannot land unnoticed; the change line records it either way.
 */
export function planQuestCorrection(
  quest: Pick<SystemQuestRecord, 'kind' | 'title' | 'description' | 'deadline' | 'objectives' | 'xpReward' | 'penalty'>,
  body: Record<string, unknown>,
  now: Date,
): QuestCorrectionPlan {
  for (const key of Object.keys(body)) {
    if (!CORRECTION_FIELDS.has(key)) {
      throw new SystemQuestError('invalid_quest', `${key} cannot be changed by a correction`, 400);
    }
  }
  if ('acknowledgeXpIncrease' in body && typeof body.acknowledgeXpIncrease !== 'boolean') {
    throw new SystemQuestError('invalid_quest', 'acknowledgeXpIncrease must be a boolean', 400);
  }
  const reason = readCorrectionReason(body);

  const changes: string[] = [];
  const increases: Record<string, unknown> = {};
  const acknowledge = body.acknowledgeXpIncrease === true;

  let title = quest.title;
  let description = quest.description;
  let deadline = quest.deadline;
  let objectives = quest.objectives.map(objective => ({ ...objective }));
  let xpReward = { ...quest.xpReward };
  let penalty: QuestPenalty | null = quest.penalty
    ? JSON.parse(JSON.stringify(quest.penalty)) as QuestPenalty
    : null;

  if ('title' in body) {
    const next = requireText(body.title, 'title', 200);
    if (next !== title) {
      changes.push(`title: "${title}" → "${next}"`);
      title = next;
    }
  }

  if ('description' in body) {
    if (typeof body.description !== 'string') {
      throw new SystemQuestError('invalid_quest', 'description must be a string', 400);
    }
    const next = body.description.trim().slice(0, 4000);
    if (next !== description) {
      changes.push('description updated');
      description = next;
    }
  }

  if ('deadline' in body) {
    const next = parseCorrectionDeadline(body.deadline, now);
    if (next !== deadline) {
      changes.push(deadlineChangeLine(deadline, next));
      deadline = next;
    }
  }

  if ('objectives' in body) {
    if (body.objectives == null) {
      throw new SystemQuestError('invalid_quest', 'objectives cannot be removed', 400);
    }
    objectives = applyObjectiveEdits(objectives, body.objectives, changes);
  }

  if ('xpReward' in body) {
    const before = { ...xpReward };
    const next = assertXpMap(body.xpReward, 'xpReward', quest.kind === 'penalty');
    if (quest.kind !== 'penalty' && Object.keys(next).length === 0) {
      throw new SystemQuestError('invalid_quest', 'xpReward must include at least one class', 400);
    }
    if (!sameXp(before, next)) {
      if (xpIncreased(before, next)) {
        increases.xpReward = { previous: before, next };
        changes.push(`xpReward increased (acknowledged): ${formatXp(before)} → ${formatXp(next)}`);
      } else {
        changes.push(`xpReward: ${formatXp(before)} → ${formatXp(next)}`);
      }
      xpReward = next;
    }
  }

  if ('penalty' in body) {
    penalty = applyPenaltyEdit(penalty, body.penalty, changes, increases);
  }

  if (Object.keys(increases).length > 0 && !acknowledge) {
    throw new SystemQuestError(
      'xp_increase_not_acknowledged',
      'Raising xpReward or penalty.xpPenalty requires acknowledgeXpIncrease: true. The increase is recorded in the quest history.',
      422,
      increases,
    );
  }

  if (changes.length === 0) {
    throw new SystemQuestError('no_changes', 'Nothing on this quest changed', 400);
  }

  return {
    title,
    description,
    deadline,
    objectives,
    xpReward,
    penalty,
    reason,
    changes,
  };
}

function readCorrectionReason(body: Record<string, unknown>): string | null {
  if (!('reason' in body) || body.reason == null || body.reason === '') return null;
  if (typeof body.reason !== 'string') {
    throw new SystemQuestError('invalid_quest', 'reason must be a string', 400);
  }
  const reason = body.reason.trim().slice(0, 500);
  if (body.reason.trim().length > 500) {
    throw new SystemQuestError('invalid_quest', 'reason cannot exceed 500 characters', 400);
  }
  return reason || null;
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SystemQuestError('invalid_quest', `${field} is required`, 400);
  }
  return value.trim().slice(0, max);
}

function parseTarget(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw new SystemQuestError('invalid_quest', `${field} must be an integer >= 1`, 400);
  }
  return value;
}

function parseCorrectionDeadline(value: unknown, now: Date): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new SystemQuestError('invalid_quest', 'deadline must be an ISO timestamp or null', 400);
  }
  const iso = new Date(value).toISOString();
  if (new Date(iso).getTime() <= now.getTime()) {
    throw new SystemQuestError('invalid_quest', 'deadline must be in the future', 400);
  }
  return iso;
}

function deadlineChangeLine(before: string | null, after: string | null): string {
  if (before && after) return `deadline: ${before} → ${after}`;
  if (after) return `deadline set to ${after}`;
  return 'deadline cleared';
}

function formatXp(map: Record<string, number>): string {
  const entries = Object.entries(map).filter(([, xp]) => xp > 0).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return 'none';
  return entries.map(([name, xp]) => `${name} ${xp}`).join(', ');
}

function sameXp(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  }
  return true;
}

function xpIncreased(before: Record<string, number>, after: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if ((after[key] ?? 0) > (before[key] ?? 0)) return true;
  }
  return false;
}

interface ObjectiveUpdate {
  id: string;
  label?: string;
  target?: number;
}

interface ObjectiveAdd {
  id?: string;
  label: string;
  target: number;
}

function applyObjectiveEdits(objectives: QuestObjective[], raw: unknown, changes: string[]): QuestObjective[] {
  if (typeof raw !== 'object' || raw == null || Array.isArray(raw)) {
    throw new SystemQuestError('invalid_quest', 'objectives must be an object with update, add, and/or remove', 400);
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== 'update' && key !== 'add' && key !== 'remove') {
      throw new SystemQuestError('invalid_quest', `objectives.${key} is not a correction field`, 400);
    }
  }

  const updates = parseObjectiveUpdates(body.update);
  const adds = parseObjectiveAdds(body.add);
  const removes = parseObjectiveRemoves(body.remove);
  assertUniqueIds(updates.map(update => update.id), 'objectives.update');
  assertUniqueIds(adds.map(add => add.id).filter((id): id is string => !!id), 'objectives.add');
  assertUniqueIds(removes, 'objectives.remove');

  const updateIds = new Set(updates.map(update => update.id));
  const removeIds = new Set(removes);
  for (const id of updateIds) {
    if (removeIds.has(id)) {
      throw new SystemQuestError('invalid_quest', `objective ${id} cannot be updated and removed in one correction`, 400);
    }
  }

  const next = objectives.map(objective => ({ ...objective }));
  for (const update of updates) {
    const objective = next.find(item => item.id === update.id);
    if (!objective) throw new SystemQuestError('not_found', `Objective ${update.id} not found`, 404);
    if (update.label != null && update.label !== objective.label) {
      changes.push(`objective ${update.id} label: "${objective.label}" → "${update.label}"`);
      objective.label = update.label;
    }
    if (update.target != null && update.target !== objective.target) {
      if (update.target < objective.progress) {
        throw new SystemQuestError(
          'target_below_progress',
          `objective ${update.id} target ${update.target} is below current progress ${objective.progress}`,
          409,
        );
      }
      changes.push(`objective ${update.id} target: ${objective.target} → ${update.target}`);
      objective.target = update.target;
      objective.done = objective.progress >= objective.target;
    }
  }

  for (const id of removes) {
    const index = next.findIndex(item => item.id === id);
    if (index < 0) throw new SystemQuestError('not_found', `Objective ${id} not found`, 404);
    const objective = next[index];
    if (objective.progress > 0 || objective.done) {
      throw new SystemQuestError(
        'objective_has_progress',
        `objective ${id} already has progress and cannot be removed`,
        409,
      );
    }
    next.splice(index, 1);
    changes.push(`removed objective ${objective.id}: "${objective.label}"`);
  }

  for (const add of adds) {
    const id = add.id ?? nextObjectiveId(next);
    if (next.some(item => item.id === id) || updateIds.has(id)) {
      throw new SystemQuestError('invalid_quest', `objective id ${id} already exists`, 400);
    }
    next.push({ id, label: add.label, target: add.target, progress: 0, done: false });
    changes.push(`added objective ${id}: "${add.label}" (target ${add.target})`);
  }

  if (next.length === 0) {
    throw new SystemQuestError('invalid_quest', 'A quest must keep at least one objective', 400);
  }
  if (next.length > 20) {
    throw new SystemQuestError('invalid_quest', 'objectives cannot exceed 20', 400);
  }
  return next;
}

function assertUniqueIds(ids: string[], field: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new SystemQuestError('invalid_quest', `duplicate objective id ${id} in ${field}`, 400);
    seen.add(id);
  }
}

function parseObjectiveUpdates(raw: unknown): ObjectiveUpdate[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new SystemQuestError('invalid_quest', 'objectives.update must be an array', 400);
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new SystemQuestError('invalid_quest', `objectives.update[${index}] must be an object`, 400);
    }
    const row = item as Record<string, unknown>;
    if ('progress' in row || 'done' in row) {
      throw new SystemQuestError('invalid_quest', 'objective progress is changed through PATCH /progress', 400);
    }
    if (typeof row.id !== 'string' || !row.id.trim()) {
      throw new SystemQuestError('invalid_quest', `objectives.update[${index}].id is required`, 400);
    }
    const update: ObjectiveUpdate = { id: row.id.trim().slice(0, 80) };
    if ('label' in row) update.label = requireText(row.label, `objectives.update[${index}].label`, 300);
    if ('target' in row) update.target = parseTarget(row.target, `objectives.update[${index}].target`);
    if (update.label == null && update.target == null) {
      throw new SystemQuestError('invalid_quest', `objectives.update[${index}] needs a label or target`, 400);
    }
    return update;
  });
}

function parseObjectiveAdds(raw: unknown): ObjectiveAdd[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new SystemQuestError('invalid_quest', 'objectives.add must be an array', 400);
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new SystemQuestError('invalid_quest', `objectives.add[${index}] must be an object`, 400);
    }
    const row = item as Record<string, unknown>;
    if ('progress' in row || 'done' in row) {
      throw new SystemQuestError('invalid_quest', 'new objectives start at zero progress', 400);
    }
    const label = requireText(row.label, `objectives.add[${index}].label`, 300);
    const target = row.target == null ? 1 : parseTarget(row.target, `objectives.add[${index}].target`);
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 80) : undefined;
    return { id, label, target };
  });
}

function parseObjectiveRemoves(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new SystemQuestError('invalid_quest', 'objectives.remove must be an array of ids', 400);
  return raw.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new SystemQuestError('invalid_quest', `objectives.remove[${index}] must be an objective id`, 400);
    }
    return item.trim().slice(0, 80);
  });
}

function nextObjectiveId(existing: { id: string }[]): string {
  const ids = new Set(existing.map(item => item.id));
  let n = existing.length + 1;
  let id = `obj-${n}`;
  while (ids.has(id)) {
    n += 1;
    id = `obj-${n}`;
  }
  return id;
}

function applyPenaltyEdit(
  existing: QuestPenalty | null,
  patch: unknown,
  changes: string[],
  increases: Record<string, unknown>,
): QuestPenalty | null {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new SystemQuestError('invalid_quest', 'penalty must be an object', 400);
  }
  if (!existing) {
    throw new SystemQuestError('no_penalty', 'This quest has no penalty to adjust', 409);
  }
  const row = patch as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (key !== 'recoveryType' && key !== 'xpPenalty' && key !== 'penaltyQuest') {
      throw new SystemQuestError('invalid_quest', `penalty.${key} cannot be changed by a correction`, 400);
    }
  }

  const next: QuestPenalty = JSON.parse(JSON.stringify(existing)) as QuestPenalty;
  if ('recoveryType' in row) {
    const recoveryType = assertRecoveryType(row.recoveryType, 'penalty.recoveryType');
    if (recoveryType !== next.recoveryType) {
      changes.push(`penalty.recoveryType: ${next.recoveryType} → ${recoveryType}`);
      next.recoveryType = recoveryType;
      const nested = row.penaltyQuest;
      const nestedSetsType = !!nested && typeof nested === 'object' && !Array.isArray(nested)
        && 'recoveryType' in (nested as Record<string, unknown>);
      if (next.penaltyQuest && !nestedSetsType) {
        next.penaltyQuest = { ...next.penaltyQuest, recoveryType };
      }
    }
  }

  if ('xpPenalty' in row) {
    const before = { ...(next.xpPenalty ?? {}) };
    const xpPenalty = assertXpMap(row.xpPenalty, 'penalty.xpPenalty', true);
    if (!sameXp(before, xpPenalty)) {
      if (xpIncreased(before, xpPenalty)) {
        increases.xpPenalty = { previous: before, next: xpPenalty };
        changes.push(`penalty.xpPenalty increased (acknowledged): ${formatXp(before)} → ${formatXp(xpPenalty)}`);
      } else {
        changes.push(`penalty.xpPenalty: ${formatXp(before)} → ${formatXp(xpPenalty)}`);
      }
      if (Object.keys(xpPenalty).length) next.xpPenalty = xpPenalty;
      else delete next.xpPenalty;
    }
  }

  if ('penaltyQuest' in row) {
    const merged = mergePenaltyQuest(next, row.penaltyQuest, changes);
    if (merged) next.penaltyQuest = merged;
    else delete next.penaltyQuest;
  }

  return next;
}

function mergePenaltyQuest(parent: QuestPenalty, patch: unknown, changes: string[]): QuestDraft | undefined {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new SystemQuestError('invalid_quest', 'penalty.penaltyQuest must be an object', 400);
  }
  const row = patch as Record<string, unknown>;
  if (row.training === true) {
    throw new SystemQuestError('penalty_must_be_recovery', 'A linked penalty quest cannot be training.', 422);
  }
  if (row.kind != null && row.kind !== 'penalty') {
    throw new SystemQuestError('invalid_quest', 'penalty.penaltyQuest.kind must be penalty', 400);
  }
  for (const key of Object.keys(row)) {
    if (key !== 'title' && key !== 'description' && key !== 'recoveryType' && key !== 'objectives' && key !== 'kind') {
      throw new SystemQuestError('invalid_quest', `penalty.penaltyQuest.${key} cannot be changed by a correction`, 400);
    }
  }

  if (!parent.penaltyQuest) {
    if (typeof row.title !== 'string' || !Array.isArray(row.objectives)) {
      throw new SystemQuestError('invalid_quest', 'penalty.penaltyQuest title and objectives are required to add one', 400);
    }
    const title = requireText(row.title, 'penalty.penaltyQuest.title', 200);
    const recoveryType = row.recoveryType == null
      ? parent.recoveryType
      : assertRecoveryType(row.recoveryType, 'penalty.penaltyQuest.recoveryType');
    const description = readOptionalDescription(row.description, 'penalty.penaltyQuest.description');
    changes.push(`penalty quest added: "${title}"`);
    return {
      kind: 'penalty',
      title,
      ...(description ? { description } : {}),
      recoveryType,
      training: false,
      objectives: freshObjectives(row.objectives),
    };
  }

  const current: QuestDraft = JSON.parse(JSON.stringify(parent.penaltyQuest)) as QuestDraft;
  const before = changes.length;

  if ('title' in row) {
    const title = requireText(row.title, 'penalty.penaltyQuest.title', 200);
    if (title !== current.title) {
      changes.push(`penalty quest title: "${current.title}" → "${title}"`);
      current.title = title;
    }
  }

  if ('description' in row) {
    const description = readOptionalDescription(row.description, 'penalty.penaltyQuest.description');
    if ((description ?? '') !== (current.description ?? '')) {
      changes.push('penalty quest description updated');
      current.description = description ?? '';
    }
  }

  if ('recoveryType' in row) {
    const recoveryType = assertRecoveryType(row.recoveryType, 'penalty.penaltyQuest.recoveryType');
    if (recoveryType !== current.recoveryType) {
      changes.push(`penalty quest recoveryType: ${current.recoveryType ?? 'none'} → ${recoveryType}`);
      current.recoveryType = recoveryType;
    }
  }

  if ('objectives' in row) {
    const objectives = freshObjectives(row.objectives);
    const previous = objectiveSignature(current.objectives);
    const nextSignature = objectiveSignature(objectives);
    if (previous !== nextSignature) {
      changes.push('penalty quest objectives updated');
      current.objectives = objectives;
    }
  }

  if (changes.length === before) return parent.penaltyQuest;
  current.kind = 'penalty';
  current.training = false;
  if (!current.recoveryType) current.recoveryType = parent.recoveryType;
  return current;
}

function readOptionalDescription(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') {
    throw new SystemQuestError('invalid_quest', `${field} must be a string`, 400);
  }
  return value.trim().slice(0, 4000);
}

function freshObjectives(raw: unknown): QuestDraft['objectives'] {
  if (!Array.isArray(raw)) {
    throw new SystemQuestError('invalid_quest', 'objectives must be a non-empty array', 400);
  }
  raw.forEach((item, index) => {
    if (item && typeof item === 'object' && ('progress' in (item as Record<string, unknown>) || 'done' in (item as Record<string, unknown>))) {
      throw new SystemQuestError('invalid_quest', `objectives[${index}] cannot include progress or done`, 400);
    }
  });
  return normalizeObjectives(raw).map(objective => ({
    id: objective.id,
    label: objective.label,
    target: objective.target,
  }));
}

function objectiveSignature(objectives: QuestDraft['objectives'] | undefined): string {
  return JSON.stringify((objectives ?? []).map(objective => ({
    id: objective.id ?? '',
    label: objective.label,
    target: objective.target ?? 1,
  })));
}
