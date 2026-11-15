import { getSupabaseAdmin } from '../lib/supabase';

export interface WearableXpAwardRow {
  userId: string;
  dedupeKey: string;
  metric: string;
  awardDate: string;
  source: string;
  activityType: string;
  className: string;
  xpAwarded: number;
}

export interface WearableXpAwardStore {
  findByKey(userId: string, dedupeKey: string): Promise<WearableXpAwardRow | null>;
  insert(row: WearableXpAwardRow): Promise<WearableXpAwardRow>;
  /** XP already stored for sleep, readiness adherence, and steps on one civil date. */
  passiveXpOnDate(userId: string, awardDate: string): Promise<number>;
}

const PASSIVE_METRICS = new Set(['sleep', 'readiness-adherence', 'steps']);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

export class MemoryWearableXpAwardStore implements WearableXpAwardStore {
  private rows: WearableXpAwardRow[] = [];

  async findByKey(userId: string, dedupeKey: string): Promise<WearableXpAwardRow | null> {
    const found = this.rows.find(row => row.userId === userId && row.dedupeKey === dedupeKey);
    return found ? clone(found) : null;
  }

  async insert(row: WearableXpAwardRow): Promise<WearableXpAwardRow> {
    if (this.rows.some(existing => existing.userId === row.userId && existing.dedupeKey === row.dedupeKey)) {
      const err = new Error('duplicate key') as Error & { code: string };
      err.code = '23505';
      throw err;
    }
    this.rows.push(clone(row));
    return clone(row);
  }

  async passiveXpOnDate(userId: string, awardDate: string): Promise<number> {
    return this.rows
      .filter(row => row.userId === userId && row.awardDate === awardDate && PASSIVE_METRICS.has(row.metric))
      .reduce((sum, row) => sum + row.xpAwarded, 0);
  }
}

export function awardToRow(row: WearableXpAwardRow): Record<string, unknown> {
  return {
    user_id: row.userId,
    dedupe_key: row.dedupeKey,
    metric: row.metric,
    award_date: row.awardDate,
    source: row.source,
    activity_type: row.activityType,
    class_name: row.className,
    xp_awarded: row.xpAwarded,
  };
}

export function rowToAward(row: Record<string, unknown>): WearableXpAwardRow {
  const xp = typeof row.xp_awarded === 'number' ? row.xp_awarded : Number(row.xp_awarded);
  return {
    userId: String(row.user_id),
    dedupeKey: String(row.dedupe_key),
    metric: String(row.metric),
    awardDate: String(row.award_date).slice(0, 10),
    source: String(row.source),
    activityType: String(row.activity_type),
    className: String(row.class_name),
    xpAwarded: Number.isFinite(xp) ? xp : 0,
  };
}

export class SupabaseWearableXpAwardStore implements WearableXpAwardStore {
  async findByKey(userId: string, dedupeKey: string): Promise<WearableXpAwardRow | null> {
    const { data, error } = await getSupabaseAdmin()
      .from('wearable_xp_awards')
      .select('*')
      .eq('user_id', userId)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToAward(data as Record<string, unknown>) : null;
  }

  async insert(row: WearableXpAwardRow): Promise<WearableXpAwardRow> {
    const { data, error } = await getSupabaseAdmin()
      .from('wearable_xp_awards')
      .insert(awardToRow(row))
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
    return rowToAward(data as Record<string, unknown>);
  }

  async passiveXpOnDate(userId: string, awardDate: string): Promise<number> {
    const { data, error } = await getSupabaseAdmin()
      .from('wearable_xp_awards')
      .select('xp_awarded, metric')
      .eq('user_id', userId)
      .eq('award_date', awardDate)
      .in('metric', ['sleep', 'readiness-adherence', 'steps']);
    if (error) throw error;
    return (data ?? []).reduce((sum, row) => {
      const xp = typeof row.xp_awarded === 'number' ? row.xp_awarded : Number(row.xp_awarded);
      return sum + (Number.isFinite(xp) ? xp : 0);
    }, 0);
  }
}

let store: WearableXpAwardStore | null = null;

export function getWearableXpAwardStore(): WearableXpAwardStore {
  if (!store) store = new SupabaseWearableXpAwardStore();
  return store;
}

export function setWearableXpAwardStore(next: WearableXpAwardStore | null): void {
  store = next;
}
