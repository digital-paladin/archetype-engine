import { getSupabaseAdmin } from '../lib/supabase';
import { OuraError } from './ouraErrors';
import {
  OuraActivitySummary,
  OuraReadinessSummary,
  OuraSleepSummary,
} from './ouraNormalize';

export type OuraSyncStatusName =
  | 'ok'
  | 'partial'
  | 'no_data'
  | 'error'
  | 'revoked'
  | 'rate_limited'
  | 'forbidden';

export interface OuraSummaryRecord {
  user_id: string;
  summary_date: string;
  timezone: string | null;
  sleep: OuraSleepSummary | null;
  readiness: OuraReadinessSummary | null;
  activity: OuraActivitySummary | null;
  provenance: Record<string, unknown>;
  partial: boolean;
  no_data: boolean;
  synced_at: string;
}

export interface OuraSyncStatusRecord {
  user_id: string;
  last_sync_at: string;
  last_sync_status: OuraSyncStatusName;
  last_sync_detail: string;
  last_summary_date: string | null;
  timezone: string | null;
}

export function mapOuraStorageError(error: { message?: string; code?: string }): OuraError {
  const message = error.message || '';
  const code = error.code || '';
  const namesTable = /oura_daily_summaries|oura_sync_status/i.test(message);
  const missing = code === '42P01'
    || code === 'PGRST205'
    || (namesTable && /does not exist|schema cache|could not find/i.test(message));
  if (missing) {
    return new OuraError(
      'Oura summary storage is not ready. Apply supabase/migrations/015_oura_daily_summaries.sql.',
      503,
      'storage',
    );
  }
  console.error(`[OURA] storage ${code || 'error'}`);
  return new OuraError('Oura summary storage failed.', 500, 'storage');
}

export async function upsertOuraSummary(row: OuraSummaryRecord): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('oura_daily_summaries')
    .upsert(row, { onConflict: 'user_id,summary_date' });
  if (error) throw mapOuraStorageError(error);
}

export async function upsertOuraSyncStatus(row: OuraSyncStatusRecord): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('oura_sync_status')
    .upsert({
      ...row,
      last_sync_detail: row.last_sync_detail.slice(0, 500),
    }, { onConflict: 'user_id' });
  if (error) throw mapOuraStorageError(error);
}

export async function getOuraSyncStatus(userId: string): Promise<OuraSyncStatusRecord | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('oura_sync_status')
    .select('user_id, last_sync_at, last_sync_status, last_sync_detail, last_summary_date, timezone')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw mapOuraStorageError(error);
  return data ?? null;
}

export async function getLatestOuraSummary(userId: string): Promise<OuraSummaryRecord | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('oura_daily_summaries')
    .select('user_id, summary_date, timezone, sleep, readiness, activity, provenance, partial, no_data, synced_at')
    .eq('user_id', userId)
    .order('summary_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw mapOuraStorageError(error);
  return data ?? null;
}

export async function deleteOuraUserData(userId: string): Promise<void> {
  const db = getSupabaseAdmin();
  for (const table of ['oura_daily_summaries', 'oura_sync_status'] as const) {
    const { error } = await db.from(table).delete().eq('user_id', userId);
    if (error) throw mapOuraStorageError(error);
  }
}
