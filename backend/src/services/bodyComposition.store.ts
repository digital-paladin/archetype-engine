import { getSupabaseAdmin } from '../lib/supabase';
import { BodyCompositionReading, StoredBodyComposition } from '../domain/bodyComposition';

export interface BodyCompositionStore {
  findByIdempotency(userId: string, key: string): Promise<StoredBodyComposition | null>;
  insert(reading: StoredBodyComposition): Promise<StoredBodyComposition>;
  list(userId: string, limit: number): Promise<StoredBodyComposition[]>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

export class MemoryBodyCompositionStore implements BodyCompositionStore {
  private rows: StoredBodyComposition[] = [];

  async findByIdempotency(userId: string, key: string): Promise<StoredBodyComposition | null> {
    const found = this.rows.find(row => row.userId === userId && row.idempotencyKey === key);
    return found ? clone(found) : null;
  }

  async insert(reading: StoredBodyComposition): Promise<StoredBodyComposition> {
    if (this.rows.some(row => row.userId === reading.userId && row.idempotencyKey === reading.idempotencyKey)) {
      const err = new Error('duplicate key') as Error & { code: string };
      err.code = '23505';
      throw err;
    }
    this.rows.push(clone(reading));
    return clone(reading);
  }

  async list(userId: string, limit: number): Promise<StoredBodyComposition[]> {
    return this.rows
      .filter(row => row.userId === userId)
      .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(row => clone(row));
  }
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function readingToRow(reading: StoredBodyComposition): Record<string, unknown> {
  return {
    id: reading.id,
    user_id: reading.userId,
    idempotency_key: reading.idempotencyKey,
    source: reading.source,
    measured_at: reading.measuredAt,
    fasted: reading.fasted,
    context: reading.context,
    notes: reading.notes,
    health_score: reading.healthScore,
    health_score_label: reading.healthScoreLabel,
    health_score_confidence_pct: reading.healthScoreConfidencePct,
    biological_age_years: reading.biologicalAgeYears,
    metabolic_age_years: reading.metabolicAgeYears,
    body_fat_pct: reading.bodyFatPct,
    body_water_pct: reading.bodyWaterPct,
    skeletal_muscle_mass_lb: reading.skeletalMuscleMassLb,
    weight_lb: reading.weightLb,
    body_composition_grade: reading.bodyCompositionGrade,
    activity_grade: reading.activityGrade,
    sleep_grade: reading.sleepGrade,
    body_fat_label: reading.bodyFatLabel,
    body_water_label: reading.bodyWaterLabel,
    skeletal_muscle_mass_label: reading.skeletalMuscleMassLabel,
    weight_label: reading.weightLabel,
    biological_age_label: reading.biologicalAgeLabel,
    metabolic_age_label: reading.metabolicAgeLabel,
    created_at: reading.createdAt,
  };
}

export function rowToReading(row: Record<string, unknown>): StoredBodyComposition {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    idempotencyKey: String(row.idempotency_key),
    source: String(row.source),
    measuredAt: iso(row.measured_at),
    fasted: bool(row.fasted),
    context: text(row.context),
    notes: text(row.notes),
    healthScore: num(row.health_score),
    healthScoreLabel: text(row.health_score_label),
    healthScoreConfidencePct: num(row.health_score_confidence_pct),
    biologicalAgeYears: num(row.biological_age_years),
    metabolicAgeYears: num(row.metabolic_age_years),
    bodyFatPct: num(row.body_fat_pct),
    bodyWaterPct: num(row.body_water_pct),
    skeletalMuscleMassLb: num(row.skeletal_muscle_mass_lb),
    weightLb: num(row.weight_lb),
    bodyCompositionGrade: text(row.body_composition_grade),
    activityGrade: text(row.activity_grade),
    sleepGrade: text(row.sleep_grade),
    bodyFatLabel: text(row.body_fat_label),
    bodyWaterLabel: text(row.body_water_label),
    skeletalMuscleMassLabel: text(row.skeletal_muscle_mass_label),
    weightLabel: text(row.weight_label),
    biologicalAgeLabel: text(row.biological_age_label),
    metabolicAgeLabel: text(row.metabolic_age_label),
    createdAt: iso(row.created_at),
  };
}

export class SupabaseBodyCompositionStore implements BodyCompositionStore {
  async findByIdempotency(userId: string, key: string): Promise<StoredBodyComposition | null> {
    const { data, error } = await getSupabaseAdmin()
      .from('body_composition_readings')
      .select('*')
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToReading(data as Record<string, unknown>) : null;
  }

  async insert(reading: StoredBodyComposition): Promise<StoredBodyComposition> {
    const { data, error } = await getSupabaseAdmin()
      .from('body_composition_readings')
      .insert(readingToRow(reading))
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
    return rowToReading(data as Record<string, unknown>);
  }

  async list(userId: string, limit: number): Promise<StoredBodyComposition[]> {
    const { data, error } = await getSupabaseAdmin()
      .from('body_composition_readings')
      .select('*')
      .eq('user_id', userId)
      .order('measured_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(row => rowToReading(row as Record<string, unknown>));
  }
}

let store: BodyCompositionStore | null = null;

export function getBodyCompositionStore(): BodyCompositionStore {
  if (!store) store = new SupabaseBodyCompositionStore();
  return store;
}

export function setBodyCompositionStore(next: BodyCompositionStore | null): void {
  store = next;
}
