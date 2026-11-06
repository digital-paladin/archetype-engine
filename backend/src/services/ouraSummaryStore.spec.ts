import { OuraError } from './ouraErrors';
import {
  deleteOuraUserData,
  getLatestOuraSummary,
  mapOuraStorageError,
  upsertOuraSummary,
} from './ouraSummaryStore';

const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let upsertError: { code?: string; message?: string } | null = null;

jest.mock('../lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const api: {
        upsert: (row: unknown, opts: unknown) => Promise<{ error: typeof upsertError }>;
        select: () => typeof api;
        eq: (col: string, val: string) => typeof api;
        order: () => typeof api;
        limit: () => typeof api;
        maybeSingle: () => Promise<{ data: null; error: null }>;
        delete: () => { eq: (col: string, val: string) => Promise<{ error: null }> };
      } = {
        upsert: (row: unknown, opts: unknown) => {
          calls.push({ table, op: 'upsert', args: [row, opts] });
          return Promise.resolve({ error: upsertError });
        },
        select: () => api,
        eq: (col: string, val: string) => {
          calls.push({ table, op: 'eq', args: [col, val] });
          return api;
        },
        order: () => api,
        limit: () => api,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        delete: () => ({
          eq: (col: string, val: string) => {
            calls.push({ table, op: 'delete', args: [col, val] });
            return Promise.resolve({ error: null });
          },
        }),
      };
      return api;
    },
  }),
}));

describe('Oura summary store', () => {
  beforeEach(() => {
    calls.length = 0;
    upsertError = null;
  });

  it('upserts one row per user and summary date', async () => {
    await upsertOuraSummary({
      user_id: 'user-1',
      summary_date: '2026-11-06',
      timezone: '-05:00',
      sleep: null,
      readiness: null,
      activity: null,
      provenance: { provider: 'oura' },
      partial: false,
      no_data: true,
      synced_at: '2026-11-06T12:00:00.000Z',
    });
    expect(calls[0]).toMatchObject({
      table: 'oura_daily_summaries',
      op: 'upsert',
    });
    expect(calls[0].args[1]).toEqual({ onConflict: 'user_id,summary_date' });
    expect((calls[0].args[0] as { user_id: string }).user_id).toBe('user-1');
  });

  it('reads and deletes only the requested user', async () => {
    await getLatestOuraSummary('user-1');
    await deleteOuraUserData('user-1');
    const eq = calls.filter((call) => call.op === 'eq' || call.op === 'delete');
    expect(eq.every((call) => call.args[0] === 'user_id' && call.args[1] === 'user-1')).toBe(true);
    expect(calls.filter((call) => call.op === 'delete').map((call) => call.table)).toEqual([
      'oura_daily_summaries',
      'oura_sync_status',
    ]);
  });

  it('turns a missing table into a migration error without echoing the driver message', () => {
    const err = mapOuraStorageError({
      code: 'PGRST205',
      message: "Could not find the table 'oura_daily_summaries' token=secret-access",
    });
    expect(err).toBeInstanceOf(OuraError);
    expect(err.safeMessage).toMatch(/015_oura_daily_summaries\.sql/);
    expect(err.safeMessage).not.toContain('secret-access');
    expect(err.httpStatus).toBe(503);
  });
});
