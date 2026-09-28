import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { StatusEffect, StatusEffectType, StatusEffectCategory, EffectStat } from '../models/statusEffect';

// Persist effects alongside activity-log.json (same journal directory)
const JOURNAL_PATH = process.env.JOURNAL_PATH || '';
const EFFECTS_FILE: string = process.env.STATUS_EFFECTS_PATH ||
  (JOURNAL_PATH ? path.join(path.dirname(JOURNAL_PATH), 'status-effects.json') : '');

let effects: StatusEffect[] = [];

// ── Disk I/O ───────────────────────────────────────────────────────────────

function loadFromDisk(): void {
  if (!EFFECTS_FILE) return;
  try {
    if (fs.existsSync(EFFECTS_FILE)) {
      const parsed: StatusEffect[] = JSON.parse(fs.readFileSync(EFFECTS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        effects = parsed;
        console.log(`[STATUS EFFECTS] ✅ Loaded ${effects.length} effects from disk`);
      }
    }
  } catch (err) {
    console.warn(`[STATUS EFFECTS] Could not load from disk: ${err instanceof Error ? err.message : err}`);
  }
}

function saveToDisk(): void {
  if (!EFFECTS_FILE) return;
  try {
    fs.mkdirSync(path.dirname(EFFECTS_FILE), { recursive: true });
    fs.writeFileSync(EFFECTS_FILE, JSON.stringify(effects, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[STATUS EFFECTS] Could not save to disk: ${err instanceof Error ? err.message : err}`);
  }
}

loadFromDisk();

// ── Helpers ────────────────────────────────────────────────────────────────

function removeExpired(): void {
  const now = new Date().toISOString();
  const before = effects.length;
  effects = effects.filter(e => e.expiresAt === null || e.expiresAt > now);
  if (effects.length !== before) {
    saveToDisk();
  }
}

function computeExpiresAt(appliedAt: string, durationMinutes: number): string | null {
  if (durationMinutes === -1) return null;
  const ms = durationMinutes * 60 * 1000;
  return new Date(new Date(appliedAt).getTime() + ms).toISOString();
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface CreateEffectPayload {
  name: string;
  type: StatusEffectType;
  category: StatusEffectCategory;
  source: string;
  icon: string;
  effects: EffectStat[];
  duration: number;   // minutes, -1 = indefinite
  notes?: string;
}

export function getAllEffects(): StatusEffect[] {
  removeExpired();
  return [...effects];
}

export function addEffect(payload: CreateEffectPayload): StatusEffect {
  const appliedAt = new Date().toISOString();
  const newEffect: StatusEffect = {
    id: randomUUID(),
    ...payload,
    appliedAt,
    expiresAt: computeExpiresAt(appliedAt, payload.duration),
  };
  effects.push(newEffect);
  saveToDisk();
  console.log(`[STATUS EFFECTS] Added: "${newEffect.name}" (${newEffect.type}) expires ${newEffect.expiresAt ?? 'never'}`);
  return newEffect;
}

export function removeEffect(id: string): boolean {
  const before = effects.length;
  effects = effects.filter(e => e.id !== id);
  if (effects.length !== before) {
    saveToDisk();
    return true;
  }
  return false;
}

export function clearAllEffects(): void {
  effects = [];
  saveToDisk();
}

// ── Auto-managed "Sleep Deprived" debuff ────────────────────────────────────

const SLEEP_DEPRIVED_NAME = 'Sleep Deprived';
/** Reuses the same boundary as the "Fatigued" vitality bucket — one canonical threshold. */
export const SLEEP_DEPRIVED_VITALITY_THRESHOLD = 60;

function buildSleepDeprivedPayload(sleepDebt: number): CreateEffectPayload {
  return {
    name: SLEEP_DEPRIVED_NAME,
    type: 'debuff',
    category: 'training',
    source: `14-day rolling sleep debt: ${sleepDebt}h`,
    icon: '😴',
    effects: [
      { stat: 'Focus',            modifier: '-20%', direction: 'negative' },
      { stat: 'XP Consolidation', modifier: '-10%', direction: 'negative' },
    ],
    duration: -1, // condition-managed, not time-managed — see syncSleepDeprivedEffect
  };
}

/**
 * Auto-applies/removes the "Sleep Deprived" debuff based on the current
 * vitality reading. Called from syncSleepDebtFromJournal() every time it
 * runs (wearable sync, consolidation, server cron, dashboard load, manual
 * journal edits) — no separate trigger needed. Idempotent: re-applying while
 * still active just refreshes the displayed debt figure.
 */
export function syncSleepDeprivedEffect(vitality: number, sleepDebt: number): void {
  const existing = getAllEffects().find(e => e.name === SLEEP_DEPRIVED_NAME);
  const shouldBeActive = vitality < SLEEP_DEPRIVED_VITALITY_THRESHOLD;

  if (shouldBeActive && !existing) {
    addEffect(buildSleepDeprivedPayload(sleepDebt));
  } else if (!shouldBeActive && existing) {
    removeEffect(existing.id);
  } else if (shouldBeActive && existing) {
    // Refresh the displayed debt figure rather than leaving a stale source string.
    removeEffect(existing.id);
    addEffect(buildSleepDeprivedPayload(sleepDebt));
  }
}
