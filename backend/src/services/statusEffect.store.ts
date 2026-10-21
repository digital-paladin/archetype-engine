import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from '../lib/supabase';
import { EffectStat, StatusEffect, StatusEffectCategory, StatusEffectType } from '../models/statusEffect';

export type JsonResult = Record<string, unknown>;

export interface ConsumptionClaim {
  replay: JsonResult | null;
  pending: boolean;
}

export interface StatusEffectStore {
  listActive(userId: string, nowIso: string): Promise<StatusEffect[]>;
  listAll(userId: string): Promise<StatusEffect[]>;
  findByKey(userId: string, effectKey: string): Promise<StatusEffect | null>;
  insert(userId: string, effect: StatusEffect): Promise<StatusEffect>;
  update(userId: string, effect: StatusEffect): Promise<StatusEffect>;
  remove(userId: string, id: string): Promise<boolean>;
  clear(userId: string): Promise<void>;
  claimConsumption(userId: string, key: string): Promise<ConsumptionClaim>;
  completeConsumption(userId: string, key: string, result: JsonResult): Promise<void>;
  releaseConsumption(userId: string, key: string): Promise<void>;
}

const UNSCOPED = '__unscoped__';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isActive(effect: StatusEffect, nowIso: string): boolean {
  return effect.expiresAt === null || effect.expiresAt > nowIso;
}

interface ConsumptionRow {
  status: 'pending' | 'complete';
  result: JsonResult | null;
}

export class MemoryStatusEffectStore implements StatusEffectStore {
  private effects: Array<StatusEffect & { userId: string }> = [];
  private events = new Map<string, ConsumptionRow>();

  constructor(private readonly onChange?: () => void) {}

  private touch(): void {
    this.onChange?.();
  }

  private eventKey(userId: string, key: string): string {
    return `${userId}\0${key}`;
  }

  async listActive(userId: string, nowIso: string): Promise<StatusEffect[]> {
    return this.effects
      .filter(e => e.userId === userId && isActive(e, nowIso))
      .map(stripUser);
  }

  async listAll(userId: string): Promise<StatusEffect[]> {
    return this.effects.filter(e => e.userId === userId).map(stripUser);
  }

  async findByKey(userId: string, effectKey: string): Promise<StatusEffect | null> {
    const found = this.effects.find(e => e.userId === userId && e.effectKey === effectKey);
    return found ? stripUser(found) : null;
  }

  async insert(userId: string, effect: StatusEffect): Promise<StatusEffect> {
    if (effect.effectKey && this.effects.some(e => e.userId === userId && e.effectKey === effect.effectKey)) {
      const err = new Error('duplicate key') as Error & { code: string };
      err.code = '23505';
      throw err;
    }
    this.effects.push({ ...clone(effect), userId });
    this.touch();
    return clone(effect);
  }

  async update(userId: string, effect: StatusEffect): Promise<StatusEffect> {
    const idx = this.effects.findIndex(e => e.userId === userId && e.id === effect.id);
    if (idx < 0) throw new Error('status effect not found');
    this.effects[idx] = { ...clone(effect), userId };
    this.touch();
    return clone(effect);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const before = this.effects.length;
    this.effects = this.effects.filter(e => !(e.userId === userId && e.id === id));
    if (this.effects.length === before) return false;
    this.touch();
    return true;
  }

  async clear(userId: string): Promise<void> {
    this.effects = this.effects.filter(e => e.userId !== userId);
    this.touch();
  }

  async claimConsumption(userId: string, key: string): Promise<ConsumptionClaim> {
    const id = this.eventKey(userId, key);
    const existing = this.events.get(id);
    if (existing?.status === 'complete' && existing.result) return { replay: clone(existing.result), pending: false };
    if (existing?.status === 'pending') return { replay: null, pending: true };
    this.events.set(id, { status: 'pending', result: null });
    this.touch();
    return { replay: null, pending: false };
  }

  async completeConsumption(userId: string, key: string, result: JsonResult): Promise<void> {
    this.events.set(this.eventKey(userId, key), { status: 'complete', result: clone(result) });
    this.touch();
  }

  async releaseConsumption(userId: string, key: string): Promise<void> {
    const id = this.eventKey(userId, key);
    const existing = this.events.get(id);
    if (existing?.status === 'pending') {
      this.events.delete(id);
      this.touch();
    }
  }

  /** Test/helper: move legacy unscoped rows onto a user when that user has none. */
  adoptUnscoped(userId: string): 'import' | 'ignore' | 'skip' {
    const unscoped = this.effects.filter(e => e.userId === UNSCOPED);
    if (unscoped.length === 0) return 'skip';
    const owners = new Set(this.effects.filter(e => e.userId !== UNSCOPED).map(e => e.userId));
    if (owners.size > 0 && !owners.has(userId)) return 'ignore';
    if (this.effects.some(e => e.userId === userId)) return 'ignore';
    for (const row of unscoped) row.userId = userId;
    this.touch();
    return 'import';
  }

  loadRows(rows: Array<StatusEffect & { userId?: string }>): void {
    for (const row of rows) {
      const userId = row.userId || UNSCOPED;
      const { userId: _ignored, ...effect } = row;
      this.effects.push({ ...effect, userId });
    }
  }

  dumpRows(): Array<StatusEffect & { userId: string }> {
    return clone(this.effects);
  }
}

function stripUser(row: StatusEffect & { userId: string }): StatusEffect {
  const { userId: _userId, ...effect } = row;
  return clone(effect);
}

export interface LegacyFileRead {
  found: boolean;
  effects: Array<StatusEffect & { userId?: string }>;
  error?: string;
}

export function effectsFilePath(): string {
  if (process.env.STATUS_EFFECTS_PATH) return process.env.STATUS_EFFECTS_PATH;
  const journal = process.env.JOURNAL_PATH || '';
  return journal ? path.join(path.dirname(journal), 'status-effects.json') : '';
}

export function readLegacyEffectsFile(filePath: string): LegacyFileRead {
  if (!filePath) return { found: false, effects: [] };
  try {
    if (!fs.existsSync(filePath)) return { found: false, effects: [] };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) return { found: true, effects: [], error: 'status-effects.json is not an array' };
    const effects = parsed.filter(isStatusEffectShape).map(normalizeLegacyEffect);
    return { found: true, effects };
  } catch (err) {
    return {
      found: true,
      effects: [],
      error: err instanceof Error ? err.message : 'could not read status-effects.json',
    };
  }
}

export function planLegacyJsonImport(opts: {
  fileFound: boolean;
  rowCount: number;
  effectCount: number;
  readError?: string;
}): { action: 'skip' | 'ignore' | 'import'; reason: string } {
  if (!opts.fileFound) return { action: 'skip', reason: 'no status-effects.json' };
  if (opts.readError) return { action: 'ignore', reason: opts.readError };
  if (opts.rowCount > 0) return { action: 'ignore', reason: 'Supabase already has status_effects rows' };
  if (opts.effectCount <= 0) return { action: 'ignore', reason: 'status-effects.json has no effects' };
  return { action: 'import', reason: 'status_effects is empty' };
}

function isStatusEffectShape(value: unknown): value is StatusEffect & { userId?: string } {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<StatusEffect>;
  return typeof row.id === 'string' && typeof row.name === 'string' && typeof row.type === 'string';
}

function normalizeLegacyEffect(row: StatusEffect & { userId?: string }): StatusEffect & { userId?: string } {
  return {
    ...row,
    effects: Array.isArray(row.effects) ? row.effects : [],
    duration: typeof row.duration === 'number' ? row.duration : -1,
    expiresAt: row.expiresAt ?? null,
    appliedAt: row.appliedAt || new Date(0).toISOString(),
    source: row.source || 'Imported',
    icon: row.icon || '✦',
    category: row.category || 'other',
  };
}

export function archiveLegacyFile(filePath: string): void {
  if (!filePath || !fs.existsSync(filePath)) return;
  const dest = `${filePath}.imported`;
  try {
    fs.renameSync(filePath, dest);
  } catch (err) {
    console.warn(`[STATUS EFFECTS] Imported JSON but could not rename ${filePath}: ${err instanceof Error ? err.message : err}`);
  }
}

export class FileStatusEffectStore implements StatusEffectStore {
  private readonly memory: MemoryStatusEffectStore;
  private adopted = false;
  private warned = false;

  constructor(private readonly filePath: string) {
    this.memory = new MemoryStatusEffectStore(() => this.persist());
    const legacy = readLegacyEffectsFile(filePath);
    if (legacy.error) {
      console.warn(`[STATUS EFFECTS] Ignoring ${filePath}: ${legacy.error}`);
    }
    if (legacy.effects.length > 0) this.memory.loadRows(legacy.effects);
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.memory.dumpRows(), null, 2), 'utf8');
    } catch (err) {
      console.warn(`[STATUS EFFECTS] Could not save ${this.filePath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  private adopt(userId: string): void {
    if (this.adopted) return;
    const plan = this.memory.adoptUnscoped(userId);
    this.adopted = true;
    if (plan === 'ignore' && !this.warned) {
      this.warned = true;
      console.warn('[STATUS EFFECTS] Legacy status-effects.json was not assigned; another user already has effects');
    }
    if (plan === 'import') {
      console.log(`[STATUS EFFECTS] Assigned legacy JSON effects to user ${userId}`);
    }
  }

  async listActive(userId: string, nowIso: string): Promise<StatusEffect[]> {
    this.adopt(userId);
    return this.memory.listActive(userId, nowIso);
  }
  async listAll(userId: string): Promise<StatusEffect[]> {
    this.adopt(userId);
    return this.memory.listAll(userId);
  }
  async findByKey(userId: string, effectKey: string): Promise<StatusEffect | null> {
    this.adopt(userId);
    return this.memory.findByKey(userId, effectKey);
  }
  async insert(userId: string, effect: StatusEffect): Promise<StatusEffect> {
    this.adopt(userId);
    return this.memory.insert(userId, effect);
  }
  async update(userId: string, effect: StatusEffect): Promise<StatusEffect> {
    this.adopt(userId);
    return this.memory.update(userId, effect);
  }
  async remove(userId: string, id: string): Promise<boolean> {
    this.adopt(userId);
    return this.memory.remove(userId, id);
  }
  async clear(userId: string): Promise<void> {
    this.adopt(userId);
    return this.memory.clear(userId);
  }
  async claimConsumption(userId: string, key: string): Promise<ConsumptionClaim> {
    this.adopt(userId);
    return this.memory.claimConsumption(userId, key);
  }
  async completeConsumption(userId: string, key: string, result: JsonResult): Promise<void> {
    return this.memory.completeConsumption(userId, key, result);
  }
  async releaseConsumption(userId: string, key: string): Promise<void> {
    return this.memory.releaseConsumption(userId, key);
  }
}

interface StatusEffectRow {
  id: string;
  user_id: string;
  name: string;
  type: StatusEffectType;
  category: StatusEffectCategory;
  source: string;
  icon: string;
  effects: EffectStat[];
  applied_at: string;
  duration: number;
  expires_at: string | null;
  notes: string | null;
  effect_key: string | null;
  dose: string | null;
  auto_applied: boolean;
  meta: Record<string, unknown> | null;
}

export function rowToEffect(row: StatusEffectRow): StatusEffect {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    category: row.category,
    source: row.source,
    icon: row.icon,
    effects: Array.isArray(row.effects) ? row.effects : [],
    appliedAt: row.applied_at,
    duration: row.duration,
    expiresAt: row.expires_at,
    notes: row.notes ?? undefined,
    effectKey: row.effect_key,
    dose: row.dose ?? undefined,
    autoApplied: row.auto_applied,
    meta: row.meta ?? undefined,
  };
}

export function effectToRow(userId: string, effect: StatusEffect): Record<string, unknown> {
  return {
    id: effect.id,
    user_id: userId,
    name: effect.name,
    type: effect.type,
    category: effect.category || 'other',
    source: effect.source,
    icon: effect.icon,
    effects: effect.effects ?? [],
    applied_at: effect.appliedAt,
    duration: effect.duration,
    expires_at: effect.expiresAt,
    notes: effect.notes ?? null,
    effect_key: effect.effectKey ?? null,
    dose: effect.dose ?? null,
    auto_applied: effect.autoApplied === true,
    meta: effect.meta ?? {},
    updated_at: new Date().toISOString(),
  };
}

export class SupabaseStatusEffectStore implements StatusEffectStore {
  private importAttempted = false;

  private async maybeImport(userId: string): Promise<void> {
    if (this.importAttempted) return;
    this.importAttempted = true;
    const filePath = effectsFilePath();
    const legacy = readLegacyEffectsFile(filePath);
    if (!legacy.found) return;
    try {
      const admin = getSupabaseAdmin();
      const { count, error } = await admin.from('status_effects').select('id', { count: 'exact', head: true });
      if (error) {
        console.warn(`[STATUS EFFECTS] JSON left in place; could not count rows: ${error.message}`);
        return;
      }
      const plan = planLegacyJsonImport({
        fileFound: true,
        rowCount: count ?? 0,
        effectCount: legacy.effects.length,
        readError: legacy.error,
      });
      if (plan.action !== 'import') {
        console.warn(`[STATUS EFFECTS] ${plan.reason}`);
        return;
      }
      for (const effect of legacy.effects) {
        const { error: insertError } = await admin.from('status_effects').insert(effectToRow(userId, {
          ...effect,
          id: effect.id || randomUUID(),
        }));
        if (insertError) {
          console.warn(`[STATUS EFFECTS] Legacy import stopped: ${insertError.message}`);
          return;
        }
      }
      archiveLegacyFile(filePath);
      console.log(`[STATUS EFFECTS] Imported ${legacy.effects.length} JSON effects for user ${userId}`);
    } catch (err) {
      console.warn(`[STATUS EFFECTS] Legacy import skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  async listActive(userId: string, nowIso: string): Promise<StatusEffect[]> {
    await this.maybeImport(userId);
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('status_effects')
      .select('*')
      .eq('user_id', userId)
      .or(`expires_at.is.null,expires_at.gt."${nowIso}"`)
      .order('applied_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(row => rowToEffect(row as StatusEffectRow));
  }

  async listAll(userId: string): Promise<StatusEffect[]> {
    await this.maybeImport(userId);
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from('status_effects').select('*').eq('user_id', userId);
    if (error) throw error;
    return (data ?? []).map(row => rowToEffect(row as StatusEffectRow));
  }

  async findByKey(userId: string, effectKey: string): Promise<StatusEffect | null> {
    await this.maybeImport(userId);
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('status_effects')
      .select('*')
      .eq('user_id', userId)
      .eq('effect_key', effectKey)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToEffect(data as StatusEffectRow) : null;
  }

  async insert(userId: string, effect: StatusEffect): Promise<StatusEffect> {
    await this.maybeImport(userId);
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from('status_effects').insert(effectToRow(userId, effect)).select('*').single();
    if (error) throw error;
    return rowToEffect(data as StatusEffectRow);
  }

  async update(userId: string, effect: StatusEffect): Promise<StatusEffect> {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('status_effects')
      .update(effectToRow(userId, effect))
      .eq('user_id', userId)
      .eq('id', effect.id)
      .select('*')
      .single();
    if (error) throw error;
    return rowToEffect(data as StatusEffectRow);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from('status_effects').delete().eq('user_id', userId).eq('id', id).select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async clear(userId: string): Promise<void> {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from('status_effects').delete().eq('user_id', userId);
    if (error) throw error;
  }

  async claimConsumption(userId: string, key: string): Promise<ConsumptionClaim> {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from('consumption_events').insert({
      user_id: userId,
      idempotency_key: key,
      status: 'pending',
    });
    if (!error) return { replay: null, pending: false };
    if ((error as { code?: string }).code !== '23505') throw error;
    const { data, error: readError } = await admin
      .from('consumption_events')
      .select('status, result')
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .maybeSingle();
    if (readError) throw readError;
    if (data?.status === 'complete' && data.result && typeof data.result === 'object') {
      return { replay: data.result as JsonResult, pending: false };
    }
    return { replay: null, pending: true };
  }

  async completeConsumption(userId: string, key: string, result: JsonResult): Promise<void> {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('consumption_events')
      .update({ status: 'complete', result, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('idempotency_key', key);
    if (error) throw error;
  }

  async releaseConsumption(userId: string, key: string): Promise<void> {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('consumption_events')
      .delete()
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .eq('status', 'pending');
    if (error) throw error;
  }
}

let store: StatusEffectStore | null = null;

export function getStatusEffectStore(): StatusEffectStore {
  if (!store) {
    if (process.env.NODE_ENV === 'test' || process.env.STATUS_EFFECTS_STORE === 'memory') {
      store = new MemoryStatusEffectStore();
    } else if (
      process.env.STATUS_EFFECTS_STORE !== 'file'
      && process.env.SUPABASE_URL
      && process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      store = new SupabaseStatusEffectStore();
    } else {
      store = new FileStatusEffectStore(effectsFilePath());
    }
  }
  return store;
}

export function setStatusEffectStore(next: StatusEffectStore | null): void {
  store = next;
}

export function newEffectId(): string {
  return randomUUID();
}
