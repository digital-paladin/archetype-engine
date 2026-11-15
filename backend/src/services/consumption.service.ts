import { randomUUID } from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { ACTION_ITEMS_LABELS } from '../config/acm.config';
import { ConsumptionEffectsConfig, resolveConsumptionConfig } from '../config/consumptionEffects.config';
import { FoodLogEdit, FoodLogItem, JournalEntry, JournalFoodDay } from './data/IDataService';
import { getDataService } from './data/dataService';
import {
  AlcoholDose,
  CaffeineDose,
  ConsumptionSignals,
  EffectContext,
  EffectDraft,
  SugarDose,
  SupplementDose,
  ACM_ALCOHOL_ITEM_INDEX,
  addCalendarDays,
  alcoholAbstinencePrompt,
  bedtimeForDate,
  detectDietFlags,
  localDateInZone,
  normalizeBedtime,
  planConsumptionEffects,
  projectHydration,
  projectProtein,
  standardDrinks,
  zonedParts,
} from './consumptionEffects';
import { applyCorrectionDraft, applyEffectDraft, getAllEffects } from './statusEffects.service';
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
  /** Label total sugar. Stored only; it does not flag the row or apply Sugar Rush. */
  totalSugarG?: number | null;
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
  id: string;
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
  journal?: ConsumptionJournal;
}

export interface ConsumptionJournal {
  getJournalEntry(userId: string, date: string): Promise<JournalEntry | null>;
  upsertJournalEntry(userId: string, entry: Partial<JournalEntry>): Promise<void>;
  listJournalFoodDays?(userId: string): Promise<JournalFoodDay[]>;
}

export interface PublicConsumptionEntry {
  id: string;
  date: string;
  itemName: string;
  protein: number;
  calories: number;
  waterOz: number;
  caffeineMg: number;
  addedSugarG: number;
  totalSugarG: number | null;
  alcohol: AlcoholInput | null;
  supplements: SupplementInput[];
  notes: string | null;
  consumedAt: string;
  dietFlags: string[];
  editedAt: string | null;
  editCount: number;
}

export interface ConsumptionCorrectionInput {
  idempotencyKey?: string;
  /** Journal day to search first. Omit to scan every day that has a food log. */
  date?: string;
  reason?: string;
  itemName?: string;
  notes?: string | null;
  protein?: number;
  calories?: number;
  waterOz?: number;
  caffeineMg?: number;
  addedSugarG?: number;
  totalSugarG?: number | null;
  alcohol?: AlcoholInput | null;
  supplements?: SupplementInput[];
}

export interface ConsumptionCorrectionResult {
  id: string;
  date: string;
  entry: PublicConsumptionEntry;
  changes: string[];
  previous: Record<string, unknown>;
  proteinGrams: number;
  mealCount: number;
  hydrationOz: number | null;
  effects: StatusEffect[];
  dietFlags: string[];
  effectsError: string | null;
  noticeBody: string | null;
  idempotentReplay: boolean;
  message: string;
}

export interface ConsumptionListResult {
  date: string;
  entries: PublicConsumptionEntry[];
  proteinGrams: number;
  mealCount: number;
  hydrationOz: number | null;
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
  totalSugarG: number;
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
  const totalSugarG = asNumber(input.totalSugarG, 'totalSugarG', 0);
  if (protein < 0 || calories < 0 || waterOz < 0 || caffeineMg < 0 || addedSugarG < 0 || totalSugarG < 0) {
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
    totalSugarG,
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
  cfg: ConsumptionEffectsConfig,
  override: string | null,
): Promise<string> {
  const scheduled = bedtimeForDate(clientDate, cfg);
  if (override) return normalizeBedtime(override, scheduled);
  const today = await journal.getJournalEntry(userId, clientDate);
  if (today?.sleep_start) return normalizeBedtime(today.sleep_start, scheduled);
  const yesterday = await journal.getJournalEntry(userId, addCalendarDays(clientDate, -1));
  if (yesterday?.sleep_start) return normalizeBedtime(yesterday.sleep_start, scheduled);
  return scheduled;
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
  const bedtime = await resolveBedtime(userId, clientDate, journal, cfg, normalized.bedtimeOverride);

  const entry = await journal.getJournalEntry(userId, clientDate);
  const proteinGrams = (entry?.protein_grams_logged ?? 0) + normalized.protein;
  const mealCount = normalized.calories > 0 ? (entry?.meal_count ?? 0) + 1 : (entry?.meal_count ?? 0);
  const hydrationOz = normalized.waterOz > 0
    ? (entry?.hydration_oz ?? 0) + normalized.waterOz
    : (entry?.hydration_oz ?? null);
  const proteinLevel: 'low' | 'medium' | 'high' =
    proteinGrams >= 130 ? 'high' : proteinGrams >= 80 ? 'medium' : 'low';

  const logId = randomUUID();
  const dietFlags = flagsFor(normalized.itemName, normalized.notes ?? null, normalized.buffValue ?? null, normalized.addedSugarG);
  const existingLog = Array.isArray(entry?.food_log) ? [...entry!.food_log] : [];
  existingLog.push(toFoodLogItem({
    id: logId,
    itemName: normalized.itemName,
    protein: normalized.protein,
    calories: normalized.calories,
    waterOz: normalized.waterOz,
    caffeineMg: normalized.caffeineMg,
    addedSugarG: normalized.addedSugarG,
    totalSugarG: normalized.totalSugarG > 0 ? normalized.totalSugarG : null,
    alcohol: normalized.alcohol,
    supplements: normalized.supplements,
    notes: normalized.notes?.trim() ? normalized.notes.trim() : null,
    buffValue: normalized.buffValue ?? null,
    consumedAt: normalized.consumedAt.toISOString(),
    dietFlags,
    editedAt: null,
    edits: [],
  }));

  await journal.upsertJournalEntry(userId, {
    entry_date: clientDate,
    protein_grams_logged: proteinGrams,
    protein_level: proteinLevel,
    meal_count: mealCount,
    food_log: existingLog,
    ...(hydrationOz !== null && hydrationOz !== undefined ? { hydration_oz: hydrationOz } : {}),
  });

  let effects: StatusEffect[] = [];
  let effectsError: string | null = null;
  try {
    effects = await applySignals(userId, normalized, logId, {
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
    id: logId,
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
  logId: string,
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
    entryId: logId,
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STORED_CONSUMPTION_EDITS = 20;
const NOTE_MAX = 2000;
const STACK_KEYS = ['alcohol', 'caffeine', 'sugar', 'creatine', 'magnesium', 'melatonin'] as const;
type StackKey = typeof STACK_KEYS[number];

interface ItemSnapshot {
  id: string;
  itemName: string;
  protein: number;
  calories: number;
  waterOz: number;
  caffeineMg: number;
  addedSugarG: number;
  totalSugarG: number | null;
  alcohol: AlcoholInput | null;
  supplements: SupplementInput[];
  notes: string | null;
  buffValue: string | null;
  consumedAt: string;
  dietFlags: string[];
  editedAt: string | null;
  edits: FoodLogEdit[];
}

interface StackDoses {
  alcohol: AlcoholDose[];
  caffeine: CaffeineDose[];
  sugar: SugarDose[];
  creatine: SupplementDose[];
  magnesium: SupplementDose[];
  melatonin: SupplementDose[];
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function flagsFor(
  itemName: string,
  notes: string | null,
  buffValue: string | null,
  addedSugarG: number,
): string[] {
  const flags = detectDietFlags(itemName, `${notes ?? ''} ${buffValue ?? ''}`);
  if (addedSugarG > 0) flags.push('added-sugar');
  return flags;
}

function toFoodLogItem(snapshot: ItemSnapshot): FoodLogItem {
  return {
    id: snapshot.id,
    item: snapshot.itemName,
    protein: snapshot.protein,
    calories: snapshot.calories,
    ts: snapshot.consumedAt,
    ...(snapshot.waterOz > 0 ? { waterOz: snapshot.waterOz } : {}),
    ...(snapshot.caffeineMg > 0 ? { caffeineMg: snapshot.caffeineMg } : {}),
    ...(snapshot.addedSugarG > 0 ? { addedSugarG: snapshot.addedSugarG } : {}),
    ...(snapshot.totalSugarG != null && snapshot.totalSugarG > 0 ? { totalSugarG: snapshot.totalSugarG } : {}),
    ...(snapshot.alcohol ? { alcohol: snapshot.alcohol } : {}),
    ...(snapshot.supplements.length > 0 ? { supplements: snapshot.supplements } : {}),
    ...(snapshot.notes ? { notes: snapshot.notes } : {}),
    ...(snapshot.buffValue ? { buffValue: snapshot.buffValue } : {}),
    ...(snapshot.dietFlags.length > 0 ? { dietFlags: snapshot.dietFlags } : {}),
    ...(snapshot.editedAt ? { editedAt: snapshot.editedAt } : {}),
    ...(snapshot.edits.length > 0 ? { edits: snapshot.edits } : {}),
  };
}

function readSnapshot(item: FoodLogItem, fallbackId: string): ItemSnapshot {
  const notes = typeof item.notes === 'string' && item.notes.trim() ? item.notes.trim() : null;
  const buffValue = typeof item.buffValue === 'string' && item.buffValue.trim() ? item.buffValue : null;
  const addedSugarG = finiteNumber(item.addedSugarG);
  const itemName = typeof item.item === 'string' ? item.item : '';
  const supplements = Array.isArray(item.supplements) ? item.supplements : [];
  return {
    id: item.id || fallbackId,
    itemName,
    protein: finiteNumber(item.protein),
    calories: finiteNumber(item.calories),
    waterOz: finiteNumber(item.waterOz),
    caffeineMg: finiteNumber(item.caffeineMg),
    addedSugarG,
    totalSugarG: item.totalSugarG == null ? null : finiteNumber(item.totalSugarG),
    alcohol: item.alcohol && finiteNumber(item.alcohol.volumeOz) > 0 && finiteNumber(item.alcohol.abvPercent) > 0
      ? { volumeOz: item.alcohol.volumeOz, abvPercent: item.alcohol.abvPercent }
      : null,
    supplements,
    notes,
    buffValue,
    consumedAt: item.ts,
    dietFlags: flagsFor(itemName, notes, buffValue, addedSugarG),
    editedAt: item.editedAt ?? null,
    edits: Array.isArray(item.edits) ? item.edits : [],
  };
}

function presentEntry(date: string, snapshot: ItemSnapshot): PublicConsumptionEntry {
  return {
    id: snapshot.id,
    date,
    itemName: snapshot.itemName,
    protein: snapshot.protein,
    calories: snapshot.calories,
    waterOz: snapshot.waterOz,
    caffeineMg: snapshot.caffeineMg,
    addedSugarG: snapshot.addedSugarG,
    totalSugarG: snapshot.totalSugarG,
    alcohol: snapshot.alcohol,
    supplements: snapshot.supplements,
    notes: snapshot.notes,
    consumedAt: snapshot.consumedAt,
    dietFlags: snapshot.dietFlags,
    editedAt: snapshot.editedAt,
    editCount: snapshot.edits.length,
  };
}

function journalOf(options: ConsumptionOptions): ConsumptionJournal {
  return options.journal ?? getDataService();
}

export async function listConsumption(
  userId: string,
  date: string,
  options: ConsumptionOptions = {},
): Promise<ConsumptionListResult> {
  if (!DATE_RE.test(date)) {
    throw new ConsumptionError('invalid_consumption', 'date must be YYYY-MM-DD', 400);
  }
  const journal = journalOf(options);
  const entry = await journal.getJournalEntry(userId, date);
  const log = Array.isArray(entry?.food_log) ? entry.food_log.map(item => ({ ...item })) : [];
  let dirty = false;
  const entries: PublicConsumptionEntry[] = [];
  for (let i = 0; i < log.length; i++) {
    if (!log[i].id) {
      log[i].id = randomUUID();
      dirty = true;
    }
    entries.push(presentEntry(date, readSnapshot(log[i], log[i].id!)));
  }
  if (dirty) {
    await journal.upsertJournalEntry(userId, { entry_date: date, food_log: log });
  }
  return {
    date,
    entries,
    proteinGrams: finiteNumber(entry?.protein_grams_logged),
    mealCount: finiteNumber(entry?.meal_count),
    hydrationOz: entry?.hydration_oz ?? null,
  };
}

export async function correctConsumption(
  userId: string,
  id: string,
  input: ConsumptionCorrectionInput,
  options: ConsumptionOptions = {},
): Promise<ConsumptionCorrectionResult> {
  if (!id || typeof id !== 'string' || id.trim() === '' || id.length > 80) {
    throw new ConsumptionError('not_found', 'Consumption entry not found', 404);
  }
  const body = input ?? {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new ConsumptionError('invalid_consumption', 'body must be an object', 400);
  }
  const idempotencyKey = readIdempotency(body.idempotencyKey);
  const dateHint = readDateHint(body.date);
  const reason = readReason(body.reason);
  const journal = journalOf(options);
  const located = await locateEntry(journal, userId, id, dateHint);
  if (!located) throw new ConsumptionError('not_found', 'Consumption entry not found', 404);

  const current = readSnapshot(located.day.food_log[located.index], id);
  const prior = idempotencyKey ? current.edits.find(edit => edit.idempotencyKey === idempotencyKey) : undefined;
  if (prior) return replayCorrection(userId, located.date, located.day, current, prior);

  const next = applyPatch(current, body);
  const changes = diffSnapshot(current, next);
  const proteinGrams = finiteNumber(located.day.protein_grams_logged);
  const mealCount = finiteNumber(located.day.meal_count);
  const hydrationOz = located.day.hydration_oz ?? null;
  if (changes.length === 0) {
    return {
      id: current.id,
      date: located.date,
      entry: presentEntry(located.date, current),
      changes: [],
      previous: {},
      proteinGrams,
      mealCount,
      hydrationOz,
      effects: [],
      dietFlags: current.dietFlags,
      effectsError: null,
      noticeBody: null,
      idempotentReplay: false,
      message: `${current.itemName} is already recorded with those values.`,
    };
  }

  const editedAt = (options.now ?? new Date()).toISOString();
  const previous = previousValues(current, next);
  const edit: FoodLogEdit = {
    idempotencyKey,
    at: editedAt,
    source: options.authKind === 'service' ? 'service' : 'user',
    reason,
    changes,
    previous,
  };
  next.editedAt = editedAt;
  next.dietFlags = flagsFor(next.itemName, next.notes, next.buffValue, next.addedSugarG);
  next.edits = [...current.edits, edit].slice(-MAX_STORED_CONSUMPTION_EDITS);

  const nextProtein = Math.max(0, proteinGrams - current.protein + next.protein);
  const mealDelta = (next.calories > 0 ? 1 : 0) - (current.calories > 0 ? 1 : 0);
  const nextMeals = Math.max(0, mealCount + mealDelta);
  const nextHydration = current.waterOz === next.waterOz
    ? hydrationOz
    : Math.max(0, (hydrationOz ?? 0) - current.waterOz + next.waterOz);
  const proteinLevel: 'low' | 'medium' | 'high' =
    nextProtein >= 130 ? 'high' : nextProtein >= 80 ? 'medium' : 'low';
  const foodLog = located.day.food_log.slice();
  foodLog[located.index] = toFoodLogItem(next);
  await journal.upsertJournalEntry(userId, {
    entry_date: located.date,
    protein_grams_logged: nextProtein,
    protein_level: proteinLevel,
    meal_count: nextMeals,
    food_log: foodLog,
    ...(nextHydration !== null ? { hydration_oz: nextHydration } : {}),
  });

  let effects: StatusEffect[] = [];
  let effectsError: string | null = null;
  try {
    effects = await recalculateAfterCorrection(userId, {
      date: located.date,
      before: current,
      after: next,
      proteinGrams: nextProtein,
      oldProteinTotal: proteinGrams,
      hydrationOz: nextHydration ?? 0,
      oldHydration: hydrationOz ?? 0,
      proteinChanged: current.protein !== next.protein,
      waterChanged: current.waterOz !== next.waterOz,
    }, options);
    emitToUser(io, userId, 'status-effects-updated', { at: editedAt });
  } catch (err) {
    effectsError = err instanceof Error ? err.message : 'status effects failed';
    console.error(`[CONSUME] Correction effects failed for ${userId}: ${effectsError}`);
  }

  const noticeBody = correctionNotice(next.itemName, changes, next.dietFlags, effects, reason);
  if (options.notifySystem) {
    try {
      await postSystemMessage(userId, {
        body: noticeBody,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:correction-notice` : undefined,
      }, options.authKind ?? 'service');
    } catch (err) {
      console.error('[CONSUME] Correction notice failed:', err instanceof Error ? err.message : err);
    }
  }

  return {
    id: next.id,
    date: located.date,
    entry: presentEntry(located.date, next),
    changes,
    previous,
    proteinGrams: nextProtein,
    mealCount: nextMeals,
    hydrationOz: nextHydration,
    effects,
    dietFlags: next.dietFlags,
    effectsError,
    noticeBody: options.notifySystem ? noticeBody : null,
    idempotentReplay: false,
    message: `Updated ${next.itemName}.`,
  };
}

async function replayCorrection(
  userId: string,
  date: string,
  day: JournalFoodDay,
  current: ItemSnapshot,
  prior: FoodLogEdit,
): Promise<ConsumptionCorrectionResult> {
  return {
    id: current.id,
    date,
    entry: presentEntry(date, current),
    changes: prior.changes,
    previous: prior.previous,
    proteinGrams: finiteNumber(day.protein_grams_logged),
    mealCount: finiteNumber(day.meal_count),
    hydrationOz: day.hydration_oz ?? null,
    effects: await effectsForEntry(userId, current.id),
    dietFlags: current.dietFlags,
    effectsError: null,
    noticeBody: null,
    idempotentReplay: true,
    message: `${current.itemName} was already corrected with this idempotencyKey.`,
  };
}

async function locateEntry(
  journal: ConsumptionJournal,
  userId: string,
  id: string,
  dateHint: string | null,
): Promise<{ date: string; day: JournalFoodDay; index: number } | null> {
  if (dateHint) {
    const hinted = await dayById(journal, userId, dateHint, id);
    if (hinted) return hinted;
  }
  if (!journal.listJournalFoodDays) return null;
  const days = await journal.listJournalFoodDays(userId);
  for (const day of days) {
    if (dateHint && day.entry_date === dateHint) continue;
    const index = (day.food_log ?? []).findIndex(item => item.id === id);
    if (index >= 0) return { date: day.entry_date, day, index };
  }
  return null;
}

async function dayById(
  journal: ConsumptionJournal,
  userId: string,
  date: string,
  id: string,
): Promise<{ date: string; day: JournalFoodDay; index: number } | null> {
  const entry = await journal.getJournalEntry(userId, date);
  const foodLog = Array.isArray(entry?.food_log) ? entry.food_log : [];
  const index = foodLog.findIndex(item => item.id === id);
  if (!entry || index < 0) return null;
  return {
    date,
    index,
    day: {
      entry_date: date,
      food_log: foodLog,
      protein_grams_logged: entry.protein_grams_logged,
      meal_count: entry.meal_count,
      hydration_oz: entry.hydration_oz,
      sleep_start: entry.sleep_start,
    },
  };
}

const EDITABLE_FIELDS = [
  'itemName', 'notes', 'protein', 'calories', 'waterOz', 'caffeineMg',
  'addedSugarG', 'totalSugarG', 'alcohol', 'supplements',
] as const;

function applyPatch(current: ItemSnapshot, body: ConsumptionCorrectionInput): ItemSnapshot {
  const keys = EDITABLE_FIELDS.filter(key => Object.prototype.hasOwnProperty.call(body, key));
  if (keys.length === 0) {
    throw new ConsumptionError(
      'invalid_consumption',
      'Provide a field to change: itemName, notes, calories, protein, addedSugarG, totalSugarG, waterOz, caffeineMg, alcohol, or supplements',
      400,
    );
  }
  const next: ItemSnapshot = {
    ...current,
    alcohol: current.alcohol ? { ...current.alcohol } : null,
    supplements: current.supplements.map(supplement => ({ ...supplement })),
    edits: current.edits.slice(),
  };
  if (keys.includes('itemName')) {
    const itemName = typeof body.itemName === 'string' ? body.itemName.trim() : '';
    if (!itemName || itemName.length > 200) {
      throw new ConsumptionError('invalid_consumption', 'itemName is required (1–200 characters)', 400);
    }
    next.itemName = itemName;
  }
  if (keys.includes('notes')) {
    if (body.notes === null || body.notes === '') next.notes = null;
    else if (typeof body.notes === 'string' && body.notes.trim().length <= NOTE_MAX) next.notes = body.notes.trim();
    else throw new ConsumptionError('invalid_consumption', `notes must be a string up to ${NOTE_MAX} characters`, 400);
  }
  for (const field of ['protein', 'calories', 'waterOz', 'caffeineMg', 'addedSugarG'] as const) {
    if (!keys.includes(field)) continue;
    const value = asNumber(body[field], field);
    if (value < 0) throw new ConsumptionError('invalid_consumption', 'Amounts cannot be negative', 400);
    next[field] = value;
  }
  if (keys.includes('totalSugarG')) {
    if (body.totalSugarG === null) next.totalSugarG = null;
    else {
      const value = asNumber(body.totalSugarG, 'totalSugarG');
      if (value < 0) throw new ConsumptionError('invalid_consumption', 'Amounts cannot be negative', 400);
      // Zero is the same as unset. The field is omitted on the food log either way.
      next.totalSugarG = value > 0 ? value : null;
    }
  }
  if (keys.includes('alcohol')) {
    if (body.alcohol === null) next.alcohol = null;
    else if (body.alcohol && typeof body.alcohol === 'object') {
      const volumeOz = asNumber(body.alcohol.volumeOz, 'alcohol.volumeOz');
      const abvPercent = asNumber(body.alcohol.abvPercent, 'alcohol.abvPercent');
      if (volumeOz <= 0 || abvPercent <= 0 || abvPercent > 100) {
        throw new ConsumptionError('invalid_consumption', 'alcohol.volumeOz and alcohol.abvPercent must be positive (ABV ≤ 100)', 400);
      }
      next.alcohol = { volumeOz, abvPercent };
    } else {
      throw new ConsumptionError('invalid_consumption', 'alcohol must be an object or null', 400);
    }
  }
  if (keys.includes('supplements')) {
    if (!Array.isArray(body.supplements)) {
      throw new ConsumptionError('invalid_consumption', 'supplements must be an array', 400);
    }
    const supplements: SupplementInput[] = [];
    for (const supplement of body.supplements) {
      const key = typeof supplement?.key === 'string' ? supplement.key.trim().toLowerCase() : '';
      const amount = asNumber(supplement?.amount, 'supplements.amount');
      if (!key || amount <= 0) {
        throw new ConsumptionError('invalid_consumption', 'each supplement needs a key and a positive amount', 400);
      }
      supplements.push({ key, amount, unit: supplement.unit });
    }
    next.supplements = supplements;
  }
  return next;
}

function showValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function comparedFields(before: ItemSnapshot, after: ItemSnapshot): Array<[string, unknown, unknown]> {
  return [
    ['itemName', before.itemName, after.itemName],
    ['notes', before.notes, after.notes],
    ['protein', before.protein, after.protein],
    ['calories', before.calories, after.calories],
    ['waterOz', before.waterOz, after.waterOz],
    ['caffeineMg', before.caffeineMg, after.caffeineMg],
    ['addedSugarG', before.addedSugarG, after.addedSugarG],
    ['totalSugarG', before.totalSugarG, after.totalSugarG],
    ['alcohol', before.alcohol, after.alcohol],
    ['supplements', before.supplements, after.supplements],
  ];
}

function diffSnapshot(before: ItemSnapshot, after: ItemSnapshot): string[] {
  const lines: string[] = [];
  for (const [name, left, right] of comparedFields(before, after)) {
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    lines.push(`${name}: ${showValue(left)} → ${showValue(right)}`);
  }
  return lines;
}

function previousValues(before: ItemSnapshot, after: ItemSnapshot): Record<string, unknown> {
  const previous: Record<string, unknown> = {};
  for (const [name, left, right] of comparedFields(before, after)) {
    if (JSON.stringify(left) !== JSON.stringify(right)) previous[name] = left ?? null;
  }
  return previous;
}

function readIdempotency(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ConsumptionError('invalid_consumption', 'idempotencyKey must be 1–200 characters', 400);
  }
  const key = value.trim();
  if (!key || key.length > 200 || /[\r\n]/.test(key)) {
    throw new ConsumptionError('invalid_consumption', 'idempotencyKey must be 1–200 characters', 400);
  }
  return key;
}

function readDateHint(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new ConsumptionError('invalid_consumption', 'date must be YYYY-MM-DD', 400);
  }
  return value;
}

function readReason(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > 500) {
    throw new ConsumptionError('invalid_consumption', 'reason must be a string up to 500 characters', 400);
  }
  return value.trim();
}

function correctionNotice(
  itemName: string,
  changes: string[],
  dietFlags: string[],
  effects: StatusEffect[],
  reason: string | null,
): string {
  const lines = [`Corrected ${itemName}.`];
  if (reason) lines.push(reason);
  if (changes.length > 0) lines.push(`${changes.join('; ')}.`);
  if (effects.length === 0) lines.push('No status effect changed.');
  else {
    for (const effect of effects) {
      const mods = effect.effects.map(stat => `${stat.stat} ${stat.modifier}`).join(', ');
      const dose = effect.dose ? ` (${effect.dose})` : '';
      lines.push(`${effect.name}${dose}: ${mods}.`);
    }
  }
  if (dietFlags.length > 0) lines.push(`Diet flag: ${dietFlags.join(', ')}.`);
  return lines.join(' ').slice(0, 4000);
}

interface CorrectionTotals {
  date: string;
  before: ItemSnapshot;
  after: ItemSnapshot;
  proteinGrams: number;
  oldProteinTotal: number;
  hydrationOz: number;
  oldHydration: number;
  proteinChanged: boolean;
  waterChanged: boolean;
}

async function recalculateAfterCorrection(
  userId: string,
  totals: CorrectionTotals,
  options: ConsumptionOptions,
): Promise<StatusEffect[]> {
  const cfg = resolveConsumptionConfig(options.config);
  const wallNow = options.now ?? new Date();
  const today = localDateInZone(wallNow, cfg.timeZone);
  const journal = journalOf(options);
  const bedtime = await resolveBedtime(userId, totals.date, journal, cfg, null);
  const all = await getStatusEffectStore().listAll(userId);
  const returned: StatusEffect[] = [];
  const touched = new Set<StackKey>([
    ...contributedKeys(totals.before),
    ...contributedKeys(totals.after),
  ]);

  if (touched.size > 0) {
    const stripped = stripEntryDoses(all, totals.before);
    for (const key of touched) {
      const saved = await reprojectStackKey(userId, key, totals.after, stripped, bedtime, cfg);
      if (saved) returned.push(saved);
    }
  }

  if (totals.proteinChanged) {
    const building = all.find(effect => effect.effectKey === 'protein-building');
    const goal = all.find(effect => effect.effectKey === 'protein-goal');
    const refresh = totals.date === today
      || metaClose(building, 'proteinGrams', totals.oldProteinTotal)
      || metaClose(goal, 'proteinGrams', totals.oldProteinTotal);
    if (refresh) {
      const drafts = projectProtein(totals.proteinGrams, cfg);
      returned.push(...await applyProteinDrafts(userId, drafts, totals.date === today ? wallNow : new Date(totals.after.consumedAt), building ?? goal ?? null));
    }
  }

  if (totals.waterChanged) {
    const hydrated = all.find(effect => effect.effectKey === 'hydrated');
    const dry = all.find(effect => effect.effectKey === 'dehydration');
    const refresh = totals.date === today
      || metaClose(hydrated, 'hydrationOz', totals.oldHydration)
      || metaClose(dry, 'hydrationOz', totals.oldHydration);
    if (refresh) {
      const hourSource = totals.date === today ? wallNow : new Date(totals.after.consumedAt);
      const drafts = projectHydration(totals.hydrationOz, zonedParts(hourSource, cfg.timeZone).hour, cfg);
      returned.push(...await applyHydrationDrafts(userId, drafts, hourSource, hydrated, dry));
    }
  }

  return returned;
}

function contributedKeys(item: ItemSnapshot): StackKey[] {
  const keys: StackKey[] = [];
  if (item.alcohol) keys.push('alcohol');
  if (item.caffeineMg > 0) keys.push('caffeine');
  if (item.addedSugarG > 0) keys.push('sugar');
  for (const supplement of item.supplements) {
    if (supplement.key === 'creatine' || supplement.key === 'magnesium' || supplement.key === 'melatonin') {
      keys.push(supplement.key);
    }
  }
  return keys;
}

function metaClose(effect: StatusEffect | undefined, field: string, expected: number): boolean {
  const value = effect?.meta ? (effect.meta as Record<string, unknown>)[field] : undefined;
  return typeof value === 'number' && Math.abs(value - expected) < 0.05;
}

interface DoseIdentity {
  entryId?: string;
  at: string;
  itemName: string;
}

function stripMatching<T extends DoseIdentity>(
  doses: T[],
  entryId: string,
  legacy: T | null,
  same: (dose: T, legacy: T) => boolean,
): T[] {
  if (doses.some(dose => dose.entryId === entryId)) return doses.filter(dose => dose.entryId !== entryId);
  if (!legacy) return doses;
  const index = doses.findIndex(dose => !dose.entryId && dose.at === legacy.at && dose.itemName === legacy.itemName && same(dose, legacy));
  if (index < 0) return doses;
  return doses.filter((_, i) => i !== index);
}

function stripEntryDoses(effects: StatusEffect[], before: ItemSnapshot): StackDoses {
  const row = (key: string) => effects.find(effect => effect.effectKey === key);
  const supplement = (key: string): SupplementDose[] => {
    const amount = before.supplements.find(item => item.key === key)?.amount ?? 0;
    const legacy = amount > 0
      ? { at: before.consumedAt, itemName: before.itemName, amount }
      : null;
    return stripMatching(dosesFrom<SupplementDose>(row(key)), before.id, legacy, (dose, prior) => dose.amount === prior.amount);
  };
  return {
    alcohol: stripMatching(
      dosesFrom<AlcoholDose>(row('alcohol')),
      before.id,
      before.alcohol
        ? { at: before.consumedAt, itemName: before.itemName, standardDrinks: 0, volumeOz: before.alcohol.volumeOz, abvPercent: before.alcohol.abvPercent, hoursUntilBed: 0 }
        : null,
      (dose, prior) => dose.volumeOz === prior.volumeOz && dose.abvPercent === prior.abvPercent,
    ),
    caffeine: stripMatching(
      dosesFrom<CaffeineDose>(row('caffeine')),
      before.id,
      before.caffeineMg > 0 ? { at: before.consumedAt, itemName: before.itemName, mg: before.caffeineMg, hoursUntilBed: 0 } : null,
      (dose, prior) => dose.mg === prior.mg,
    ),
    sugar: stripMatching(
      dosesFrom<SugarDose>(row('sugar')),
      before.id,
      before.addedSugarG > 0 ? { at: before.consumedAt, itemName: before.itemName, grams: before.addedSugarG } : null,
      (dose, prior) => dose.grams === prior.grams,
    ),
    creatine: supplement('creatine'),
    magnesium: supplement('magnesium'),
    melatonin: supplement('melatonin'),
  };
}

function snapshotSignals(item: ItemSnapshot): ConsumptionSignals {
  return {
    itemName: item.itemName,
    consumedAt: item.consumedAt,
    entryId: item.id,
    waterOz: item.waterOz,
    caffeineMg: item.caffeineMg,
    addedSugarG: item.addedSugarG,
    alcohol: item.alcohol,
    supplements: item.supplements,
  };
}

function signalsForKey(base: ConsumptionSignals, key: StackKey): ConsumptionSignals {
  return {
    ...base,
    alcohol: key === 'alcohol' ? base.alcohol ?? null : null,
    caffeineMg: key === 'caffeine' ? base.caffeineMg ?? 0 : 0,
    addedSugarG: key === 'sugar' ? base.addedSugarG ?? 0 : 0,
    waterOz: 0,
    supplements: key === 'creatine' || key === 'magnesium' || key === 'melatonin'
      ? (base.supplements ?? []).filter(supplement => supplement.key === key)
      : [],
  };
}

function signalContributes(signals: ConsumptionSignals, key: StackKey): boolean {
  if (key === 'alcohol') return !!signals.alcohol;
  if (key === 'caffeine') return (signals.caffeineMg ?? 0) > 0;
  if (key === 'sugar') return (signals.addedSugarG ?? 0) > 0;
  return (signals.supplements ?? []).some(supplement => supplement.key === key && supplement.amount > 0);
}

function removeDraft(key: string): EffectDraft {
  return {
    effectKey: key,
    name: key,
    type: 'debuff',
    category: 'food',
    source: '',
    icon: '·',
    effects: [],
    duration: -1,
    dose: '',
    notes: '',
    autoApplied: true,
    meta: {},
    remove: true,
  };
}

async function reprojectStackKey(
  userId: string,
  key: StackKey,
  after: ItemSnapshot,
  stripped: StackDoses,
  bedtime: string,
  cfg: ConsumptionEffectsConfig,
): Promise<StatusEffect | null> {
  const signals = signalsForKey(snapshotSignals(after), key);
  const existing = stripped[key];
  const times = existing.map(dose => new Date(dose.at).getTime()).filter(time => Number.isFinite(time));
  if (signalContributes(signals, key)) {
    const at = new Date(after.consumedAt).getTime();
    if (Number.isFinite(at)) times.push(at);
  }
  if (times.length === 0) {
    await applyCorrectionDraft(userId, removeDraft(key), new Date(after.consumedAt));
    return null;
  }
  const projectionNow = new Date(Math.max(...times));
  const ctx: EffectContext = {
    now: projectionNow,
    bedtime,
    timeZone: cfg.timeZone,
    hydrationOz: 0,
    proteinGrams: 0,
    localHour: zonedParts(projectionNow, cfg.timeZone).hour,
    alcoholDoses: key === 'alcohol' ? stripped.alcohol : [],
    caffeineDoses: key === 'caffeine' ? stripped.caffeine : [],
    sugarDoses: key === 'sugar' ? stripped.sugar : [],
    creatineDoses: key === 'creatine' ? stripped.creatine : [],
    magnesiumDoses: key === 'magnesium' ? stripped.magnesium : [],
    melatoninDoses: key === 'melatonin' ? stripped.melatonin : [],
    config: cfg,
  };
  const draft = planConsumptionEffects(signals, ctx).find(item => item.effectKey === key && !item.remove);
  if (!draft) {
    await applyCorrectionDraft(userId, removeDraft(key), projectionNow);
    return null;
  }
  return applyCorrectionDraft(userId, draft, projectionNow);
}

async function applyProteinDrafts(
  userId: string,
  drafts: EffectDraft[],
  projectionNow: Date,
  schedule: StatusEffect | null,
): Promise<StatusEffect[]> {
  const saved: StatusEffect[] = [];
  for (const draft of drafts.filter(item => !item.remove)) {
    const row = await applyCorrectionDraft(userId, draft, projectionNow, schedule);
    if (row) saved.push(row);
  }
  for (const draft of drafts.filter(item => item.remove)) {
    await applyCorrectionDraft(userId, draft, projectionNow);
  }
  return saved;
}

async function applyHydrationDrafts(
  userId: string,
  drafts: EffectDraft[],
  projectionNow: Date,
  hydrated: StatusEffect | undefined,
  dehydration: StatusEffect | undefined,
): Promise<StatusEffect[]> {
  const saved: StatusEffect[] = [];
  for (const draft of drafts.filter(item => !item.remove)) {
    const schedule = draft.effectKey === 'hydrated' ? hydrated : draft.effectKey === 'dehydration' ? dehydration : undefined;
    const row = await applyCorrectionDraft(userId, draft, projectionNow, schedule);
    if (row) saved.push(row);
  }
  for (const draft of drafts.filter(item => item.remove)) {
    await applyCorrectionDraft(userId, draft, projectionNow);
  }
  return saved;
}

async function effectsForEntry(userId: string, entryId: string): Promise<StatusEffect[]> {
  const all = await getStatusEffectStore().listAll(userId);
  return all.filter(effect => {
    const doses = effect.meta && Array.isArray((effect.meta as { doses?: unknown }).doses)
      ? (effect.meta as { doses: Array<{ entryId?: string }> }).doses
      : [];
    return doses.some(dose => dose.entryId === entryId);
  });
}
