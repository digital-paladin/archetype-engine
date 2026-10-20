import { randomUUID } from 'crypto';
import { EffectStat, StatusEffect, StatusEffectCategory, StatusEffectType } from '../models/statusEffect';
import { EffectDraft } from './consumptionEffects';
import { getStatusEffectStore, newEffectId } from './statusEffect.store';

export interface CreateEffectPayload {
  name: string;
  type: StatusEffectType;
  category: StatusEffectCategory;
  source: string;
  icon: string;
  effects: EffectStat[];
  duration: number;   // minutes, -1 = indefinite
  notes?: string;
  dose?: string;
  effectKey?: string | null;
  autoApplied?: boolean;
  meta?: Record<string, unknown>;
}

function expiresAtFor(appliedAt: string, durationMinutes: number): string | null {
  if (durationMinutes === -1) return null;
  return new Date(new Date(appliedAt).getTime() + durationMinutes * 60 * 1000).toISOString();
}

function isCurrent(effect: StatusEffect, now: Date): boolean {
  return effect.expiresAt === null || new Date(effect.expiresAt).getTime() > now.getTime();
}

export async function getAllEffects(userId: string, now = new Date()): Promise<StatusEffect[]> {
  return getStatusEffectStore().listActive(userId, now.toISOString());
}

export async function addEffect(userId: string, payload: CreateEffectPayload, now = new Date()): Promise<StatusEffect> {
  const appliedAt = now.toISOString();
  const effect: StatusEffect = {
    id: newEffectId(),
    name: payload.name,
    type: payload.type,
    category: payload.category || 'other',
    source: payload.source,
    icon: payload.icon,
    effects: payload.effects,
    appliedAt,
    duration: payload.duration,
    expiresAt: expiresAtFor(appliedAt, payload.duration),
    notes: payload.notes,
    dose: payload.dose,
    effectKey: payload.effectKey ?? null,
    autoApplied: payload.autoApplied === true,
    meta: payload.meta,
  };
  const saved = await getStatusEffectStore().insert(userId, effect);
  console.log(`[STATUS EFFECTS] Added: "${saved.name}" (${saved.type}) expires ${saved.expiresAt ?? 'never'}`);
  return saved;
}

export async function removeEffect(userId: string, id: string): Promise<boolean> {
  return getStatusEffectStore().remove(userId, id);
}

export async function removeEffectByKey(userId: string, effectKey: string): Promise<boolean> {
  const existing = await getStatusEffectStore().findByKey(userId, effectKey);
  if (!existing) return false;
  return getStatusEffectStore().remove(userId, existing.id);
}

export async function clearAllEffects(userId: string): Promise<void> {
  await getStatusEffectStore().clear(userId);
}

/**
 * Create or refresh one auto effect. An active row keeps its id.
 * An expired row is reused so the unique effect_key does not collide.
 */
export async function applyEffectDraft(userId: string, draft: EffectDraft, now = new Date()): Promise<StatusEffect | null> {
  if (draft.remove) {
    await removeEffectByKey(userId, draft.effectKey);
    return null;
  }
  const store = getStatusEffectStore();
  const existing = await store.findByKey(userId, draft.effectKey);
  const keepAppliedAt = existing && isCurrent(existing, now);
  const appliedAt = keepAppliedAt ? existing.appliedAt : now.toISOString();
  const expiresAt = draft.duration === -1
    ? null
    : new Date(now.getTime() + draft.duration * 60 * 1000).toISOString();
  const duration = draft.duration === -1
    ? -1
    : Math.max(1, Math.round((new Date(expiresAt!).getTime() - new Date(appliedAt).getTime()) / 60000));
  const effect: StatusEffect = {
    id: existing?.id ?? randomUUID(),
    name: draft.name,
    type: draft.type,
    category: draft.category,
    source: draft.source,
    icon: draft.icon,
    effects: draft.effects,
    appliedAt,
    duration,
    expiresAt,
    notes: draft.notes,
    dose: draft.dose,
    effectKey: draft.effectKey,
    autoApplied: true,
    meta: draft.meta,
  };
  if (existing) return store.update(userId, effect);
  return store.insert(userId, effect);
}

// ── Auto-managed "Sleep Deprived" debuff ────────────────────────────────────

const SLEEP_DEPRIVED_NAME = 'Sleep Deprived';
const SLEEP_DEPRIVED_KEY = 'sleep-deprived';
/** Reuses the same boundary as the "Fatigued" vitality bucket — one canonical threshold. */
export const SLEEP_DEPRIVED_VITALITY_THRESHOLD = 60;

function buildSleepDeprivedDraft(sleepDebt: number): EffectDraft {
  return {
    effectKey: SLEEP_DEPRIVED_KEY,
    name: SLEEP_DEPRIVED_NAME,
    type: 'debuff',
    category: 'training',
    source: `14-day rolling sleep debt: ${sleepDebt}h`,
    icon: '😴',
    effects: [
      { stat: 'Focus', modifier: '-20%', direction: 'negative' },
      { stat: 'XP Consolidation', modifier: '-10%', direction: 'negative' },
    ],
    duration: -1,
    dose: `${sleepDebt}h sleep debt`,
    notes: 'Applied while vitality is under the sleep-debt threshold. It clears when vitality recovers.',
    autoApplied: true,
    meta: { kind: SLEEP_DEPRIVED_KEY, sleepDebt },
  };
}

/**
 * Auto-applies/removes the "Sleep Deprived" debuff based on the current
 * vitality reading. Called from syncSleepDebtFromJournal() every time it
 * runs. Idempotent: re-applying while still active refreshes the debt figure
 * and keeps the same row.
 */
export async function syncSleepDeprivedEffect(userId: string, vitality: number, sleepDebt: number): Promise<void> {
  const store = getStatusEffectStore();
  const all = await store.listAll(userId);
  for (const effect of all) {
    if (effect.name === SLEEP_DEPRIVED_NAME && effect.effectKey !== SLEEP_DEPRIVED_KEY) {
      await store.remove(userId, effect.id);
    }
  }
  const shouldBeActive = vitality < SLEEP_DEPRIVED_VITALITY_THRESHOLD;
  if (!shouldBeActive) {
    await removeEffectByKey(userId, SLEEP_DEPRIVED_KEY);
    return;
  }
  await applyEffectDraft(userId, buildSleepDeprivedDraft(sleepDebt));
}
