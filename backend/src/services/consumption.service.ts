import { Server as SocketIOServer } from 'socket.io';
import { ACTION_ITEMS_LABELS } from '../config/acm.config';
import { ConsumptionEffectsConfig, resolveConsumptionConfig } from '../config/consumptionEffects.config';
import { JournalEntry } from './data/IDataService';
import { getDataService } from './data/dataService';
import {
  AlcoholDose,
  CaffeineDose,
  EffectContext,
  EffectDraft,
  SugarDose,
  SupplementDose,
  ACM_ALCOHOL_ITEM_INDEX,
  addCalendarDays,
  alcoholAbstinencePrompt,
  detectDietFlags,
  localDateInZone,
  normalizeBedtime,
  planConsumptionEffects,
  standardDrinks,
  zonedParts,
} from './consumptionEffects';
import { applyEffectDraft, getAllEffects } from './statusEffects.service';
import { getStatusEffectStore, JsonResult } from './statusEffect.store';
import { StatusEffect } from '../models/statusEffect';
import { emitToUser } from '../realtime/userEmit';
import { postSystemMessage } from './systemQuest.service';

let io: SocketIOServer | null = null;

export function setConsumptionSocketIO(socket: SocketIOServer | null): void {
  io = socket;
}

export class ConsumptionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface AlcoholInput {
  volumeOz: number;
  abvPercent: number;
}

export interface SupplementInput {
  key: string;
  amount: number;
  unit?: string;
}

export interface ConsumptionInput {
  idempotencyKey?: string;
  itemName?: string;
  protein?: number;
  calories?: number;
  buffValue?: string;
  waterOz?: number;
  clientDate?: string;
  consumedAt?: string;
  caffeineMg?: number;
  addedSugarG?: number;
  alcohol?: AlcoholInput | null;
  supplements?: SupplementInput[];
  bodyWeightLb?: number;
  notes?: string;
  bedtime?: string;
}

export interface AbstinencePrompt {
  itemIndex: 0;
  label: string;
  prompt: true;
  broken: false;
  message: string;
}

export interface ConsumptionResult {
  itemName: string;
  clientDate: string;
  consumedAt: string;
  proteinGrams: number;
  mealCount: number;
  hydrationOz: number | null;
  effects: StatusEffect[];
  abstinencePrompt: AbstinencePrompt | null;
  dietFlags: string[];
  noticeBody: string | null;
  effectsError: string | null;
  idempotentReplay: boolean;
  message: string;
}

export interface ConsumptionOptions {
  notifySystem?: boolean;
  authKind?: 'user' | 'service';
  now?: Date;
  config?: ConsumptionEffectsConfig;
  journal?: {
    getJournalEntry(userId: string, date: string): Promise<JournalEntry | null>;
    upsertJournalEntry(userId: string, entry: Partial<JournalEntry>): Promise<void>;
  };
}

interface NormalizedConsumption {
  itemName: string;
  protein: number;
  calories: number;
  buffValue?: string;
  waterOz: number;
  caffeineMg: number;
  addedSugarG: number;
  alcohol: AlcoholInput | null;
  supplements: SupplementInput[];
  notes?: string;
  consumedAt: Date;
  idempotencyKey: string | null;
  bedtimeOverride: string | null;
  bodyWeightLb: number | null;
  clientDate: string | null;
}

function asNumber(value: unknown, field: string, fallback?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new ConsumptionError('invalid_consumption', `${field} is required`, 400);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConsumptionError('invalid_consumption', `${field} must be a number`, 400);
  }
  return value;
}

function normalize(input: ConsumptionInput, now: Date): NormalizedConsumption {
  const itemName = typeof input.itemName === 'string' ? input.itemName.trim() : '';
  if (!itemName || itemName.length > 200) {
    throw new ConsumptionError('invalid_consumption', 'itemName is required (1–200 characters)', 400);
  }
  const protein = asNumber(input.protein, 'protein', 0);
  const calories = asNumber(input.calories, 'calories', 0);
  const waterOz = asNumber(input.waterOz, 'waterOz', 0);
  const caffeineMg = asNumber(input.caffeineMg, 'caffeineMg', 0);
  const addedSugarG = asNumber(input.addedSugarG, 'addedSugarG', 0);
  if (protein < 0 || calories < 0 || waterOz < 0 || caffeineMg < 0 || addedSugarG < 0) {
    throw new ConsumptionError('invalid_consumption', 'Amounts cannot be negative', 400);
  }
  let alcohol: AlcoholInput | null = null;
  if (input.alcohol) {
    const volumeOz = asNumber(input.alcohol.volumeOz, 'alcohol.volumeOz');
    const abvPercent = asNumber(input.alcohol.abvPercent, 'alcohol.abvPercent');
    if (volumeOz <= 0 || abvPercent <= 0 || abvPercent > 100) {
      throw new ConsumptionError('invalid_consumption', 'alcohol.volumeOz and alcohol.abvPercent must be positive (ABV ≤ 100)', 400);
    }
    alcohol = { volumeOz, abvPercent };
  }
  const supplements: SupplementInput[] = [];
  if (input.supplements !== undefined) {
    if (!Array.isArray(input.supplements)) {
      throw new ConsumptionError('invalid_consumption', 'supplements must be an array', 400);
    }
    for (const entry of input.supplements) {
      const key = typeof entry?.key === 'string' ? entry.key.trim().toLowerCase() : '';
      const amount = asNumber(entry?.amount, 'supplements.amount');
      if (!key || amount <= 0) {
        throw new ConsumptionError('invalid_consumption', 'each supplement needs a key and a positive amount', 400);
      }
      supplements.push({ key, amount, unit: entry.unit });
    }
  }
  let consumedAt = now;
  if (input.consumedAt) {
    consumedAt = new Date(input.consumedAt);
    if (Number.isNaN(consumedAt.getTime())) {
      throw new ConsumptionError('invalid_consumption', 'consumedAt must be an ISO timestamp', 400);
    }
  }
  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (input.idempotencyKey !== undefined && (!idempotencyKey || idempotencyKey.length > 200 || /[\r\n]/.test(idempotencyKey))) {
    throw new ConsumptionError('invalid_consumption', 'idempotencyKey must be 1–200 characters', 400);
  }
  const bodyWeightLb = input.bodyWeightLb === undefined || input.bodyWeightLb === null
    ? null
    : asNumber(input.bodyWeightLb, 'bodyWeightLb');
  const clientDate = typeof input.clientDate === 'string' ? input.clientDate.trim() : '';
  if (clientDate && !/^\d{4}-\d{2}-\d{2}$/.test(clientDate)) {
    throw new ConsumptionError('invalid_consumption', 'clientDate must be YYYY-MM-DD', 400);
  }
  return {
    itemName,
    protein,
    calories,
    buffValue: input.buffValue,
    waterOz,
    caffeineMg,
    addedSugarG,
    alcohol,
    supplements,
    notes: input.notes,
    consumedAt,
    idempotencyKey: idempotencyKey || null,
    bedtimeOverride: input.bedtime ?? null,
    bodyWeightLb,
    clientDate: clientDate || null,
  };
}

function dosesFrom<T>(effect: StatusEffect | undefined): T[] {
  const doses = effect?.meta && Array.isArray((effect.meta as { doses?: unknown }).doses)
    ? (effect.meta as { doses: T[] }).doses
    : [];
  return doses;
}

function activeEffect(effects: StatusEffect[], key: string, now: Date): StatusEffect | undefined {
  return effects.find(effect => effect.effectKey === key && (effect.expiresAt === null || new Date(effect.expiresAt).getTime() > now.getTime()));
}

async function resolveBedtime(
  userId: string,
  clientDate: string,
  journal: NonNullable<ConsumptionOptions['journal']>,
  fallback: string,
  override: string | null,
): Promise<string> {
  if (override) return normalizeBedtime(override, fallback);
  const today = await journal.getJournalEntry(userId, clientDate);
  if (today?.sleep_start) return normalizeBedtime(today.sleep_start, fallback);
  const yesterday = await journal.getJournalEntry(userId, addCalendarDays(clientDate, -1));
  if (yesterday?.sleep_start) return normalizeBedtime(yesterday.sleep_start, fallback);
  return fallback;
}

function noticeFor(result: Omit<ConsumptionResult, 'noticeBody' | 'idempotentReplay' | 'effectsError'>): string {
  const lines = [
    `Logged ${result.itemName}.`,
  ];
  if (result.effects.length === 0) {
    lines.push('No status effect changed.');
  } else {
    for (const effect of result.effects) {
      const mods = effect.effects.map(stat => `${stat.stat} ${stat.modifier}`).join(', ');
      const dose = effect.dose ? ` (${effect.dose})` : '';
      lines.push(`${effect.name}${dose}: ${mods}.`);
    }
  }
  if (result.abstinencePrompt) lines.push(result.abstinencePrompt.message);
  if (result.dietFlags.length > 0) {
    lines.push(`Diet flag: ${result.dietFlags.join(', ')}. The log was kept. Confirm it matches the player's rules.`);
  }
  return lines.join(' ');
}

export async function logConsumption(
  userId: string,
  input: ConsumptionInput,
  options: ConsumptionOptions = {},
): Promise<ConsumptionResult> {
  const now = options.now ?? new Date();
  const normalized = normalize(input, now);
  const store = getStatusEffectStore();

  if (normalized.idempotencyKey) {
    const claim = await store.claimConsumption(userId, normalized.idempotencyKey);
    if (claim.replay) {
      return { ...(claim.replay as unknown as ConsumptionResult), idempotentReplay: true };
    }
    if (claim.pending) {
      throw new ConsumptionError(
        'idempotency_in_progress',
        'A consumption log with this idempotencyKey is already in progress',
        409,
      );
    }
  }

  try {
    const result = await writeConsumption(userId, normalized, options, now);
    if (normalized.idempotencyKey) {
      await store.completeConsumption(userId, normalized.idempotencyKey, result as unknown as JsonResult);
    }
    return result;
  } catch (err) {
    if (normalized.idempotencyKey) {
      await store.releaseConsumption(userId, normalized.idempotencyKey).catch(() => undefined);
    }
    throw err;
  }
}

async function writeConsumption(
  userId: string,
  normalized: NormalizedConsumption,
  options: ConsumptionOptions,
  now: Date,
): Promise<ConsumptionResult> {
  const cfg = resolveConsumptionConfig(options.config);
  if (normalized.bodyWeightLb) cfg.protein.bodyWeightLb = normalized.bodyWeightLb;
  const journal = options.journal ?? getDataService();
  const clientDate = normalizeClientDate(normalized, cfg.timeZone);
  const bedtime = await resolveBedtime(userId, clientDate, journal, cfg.defaultBedtime, normalized.bedtimeOverride);
  cfg.defaultBedtime = bedtime;

  const entry = await journal.getJournalEntry(userId, clientDate);
  const proteinGrams = (entry?.protein_grams_logged ?? 0) + normalized.protein;
  const mealCount = normalized.calories > 0 ? (entry?.meal_count ?? 0) + 1 : (entry?.meal_count ?? 0);
  const hydrationOz = normalized.waterOz > 0
    ? (entry?.hydration_oz ?? 0) + normalized.waterOz
    : (entry?.hydration_oz ?? null);
  const proteinLevel: 'low' | 'medium' | 'high' =
    proteinGrams >= 130 ? 'high' : proteinGrams >= 80 ? 'medium' : 'low';

  const existingLog = Array.isArray(entry?.food_log) ? [...entry!.food_log] : [];
  const tracked = normalized.calories > 0
    || normalized.protein > 0
    || normalized.caffeineMg > 0
    || normalized.addedSugarG > 0
    || normalized.alcohol
    || normalized.supplements.length > 0;
  if (tracked) {
    existingLog.push({
      item: normalized.itemName,
      protein: normalized.protein,
      calories: normalized.calories,
      ts: normalized.consumedAt.toISOString(),
      ...(normalized.waterOz > 0 ? { waterOz: normalized.waterOz } : {}),
      ...(normalized.caffeineMg > 0 ? { caffeineMg: normalized.caffeineMg } : {}),
      ...(normalized.addedSugarG > 0 ? { addedSugarG: normalized.addedSugarG } : {}),
      ...(normalized.alcohol ? { alcohol: normalized.alcohol } : {}),
      ...(normalized.supplements.length > 0 ? { supplements: normalized.supplements } : {}),
    });
  }

  await journal.upsertJournalEntry(userId, {
    entry_date: clientDate,
    protein_grams_logged: proteinGrams,
    protein_level: proteinLevel,
    meal_count: mealCount,
    food_log: existingLog,
    ...(hydrationOz !== null && hydrationOz !== undefined ? { hydration_oz: hydrationOz } : {}),
  });

  const dietFlags = detectDietFlags(
    normalized.itemName,
    `${normalized.notes ?? ''} ${normalized.buffValue ?? ''}`,
  );
  if (normalized.addedSugarG > 0) dietFlags.push('added-sugar');

  let effects: StatusEffect[] = [];
  let effectsError: string | null = null;
  try {
    effects = await applySignals(userId, normalized, {
      now: normalized.consumedAt,
      bedtime,
      timeZone: cfg.timeZone,
      hydrationOz: hydrationOz ?? 0,
      proteinGrams,
      localHour: zonedParts(normalized.consumedAt, cfg.timeZone).hour,
      config: cfg,
    });
    emitToUser(io, userId, 'status-effects-updated', { at: now.toISOString() });
  } catch (err) {
    effectsError = err instanceof Error ? err.message : 'status effects failed';
    console.error(`[CONSUME] Status effects failed for ${userId}: ${effectsError}`);
  }

  const drinks = normalized.alcohol
    ? standardDrinks(normalized.alcohol.volumeOz, normalized.alcohol.abvPercent, cfg.alcohol.ozEthanolPerStandardDrink)
    : 0;
  const abstinencePrompt = alcoholAbstinencePrompt(drinks);
  if (abstinencePrompt) {
    abstinencePrompt.label = ACTION_ITEMS_LABELS[ACM_ALCOHOL_ITEM_INDEX] ?? abstinencePrompt.label;
  }

  const partial = {
    itemName: normalized.itemName,
    clientDate,
    consumedAt: normalized.consumedAt.toISOString(),
    proteinGrams,
    mealCount,
    hydrationOz,
    effects,
    abstinencePrompt,
    dietFlags,
    message: `Consumed ${normalized.itemName}: +${normalized.protein}g protein, ${normalized.calories} kcal logged`,
  };
  const noticeBody = noticeFor(partial);
  if (options.notifySystem) {
    try {
      await postSystemMessage(userId, {
        body: noticeBody,
        idempotencyKey: normalized.idempotencyKey ? `${normalized.idempotencyKey}:notice` : undefined,
      }, options.authKind ?? 'service');
    } catch (err) {
      console.error('[CONSUME] System notice failed:', err instanceof Error ? err.message : err);
    }
  }

  return {
    ...partial,
    noticeBody: options.notifySystem ? noticeBody : null,
    effectsError,
    idempotentReplay: false,
  };
}

function normalizeClientDate(normalized: NormalizedConsumption, timeZone: string): string {
  if (normalized.clientDate) return normalized.clientDate;
  return localDateInZone(normalized.consumedAt, timeZone);
}

async function applySignals(
  userId: string,
  normalized: NormalizedConsumption,
  base: Omit<EffectContext, 'alcoholDoses' | 'caffeineDoses' | 'sugarDoses' | 'creatineDoses' | 'magnesiumDoses' | 'melatoninDoses'>,
): Promise<StatusEffect[]> {
  const current = await getAllEffects(userId, base.now);
  const alcohol = activeEffect(current, 'alcohol', base.now);
  const caffeine = activeEffect(current, 'caffeine', base.now);
  const sugar = activeEffect(current, 'sugar', base.now);
  const creatine = activeEffect(current, 'creatine', base.now);
  const magnesium = activeEffect(current, 'magnesium', base.now);
  const melatonin = activeEffect(current, 'melatonin', base.now);
  const ctx: EffectContext = {
    ...base,
    alcoholDoses: dosesFrom<AlcoholDose>(alcohol),
    caffeineDoses: dosesFrom<CaffeineDose>(caffeine),
    sugarDoses: dosesFrom<SugarDose>(sugar),
    creatineDoses: dosesFrom<SupplementDose>(creatine),
    magnesiumDoses: dosesFrom<SupplementDose>(magnesium),
    melatoninDoses: dosesFrom<SupplementDose>(melatonin),
  };
  const drafts = planConsumptionEffects({
    itemName: normalized.itemName,
    consumedAt: normalized.consumedAt.toISOString(),
    waterOz: normalized.waterOz,
    caffeineMg: normalized.caffeineMg,
    addedSugarG: normalized.addedSugarG,
    alcohol: normalized.alcohol,
    supplements: normalized.supplements,
  }, ctx);
  const touched = new Set<string>();
  for (const draft of drafts) {
    await applyEffectDraft(userId, draft, base.now);
    touched.add(draft.effectKey);
  }
  const after = await getAllEffects(userId, base.now);
  return after.filter(effect => effect.effectKey && touched.has(effect.effectKey) && !draftWasRemoval(drafts, effect.effectKey));
}

function draftWasRemoval(drafts: EffectDraft[], key: string): boolean {
  const relevant = drafts.filter(d => d.effectKey === key);
  return relevant.length > 0 && relevant.every(d => d.remove);
}
