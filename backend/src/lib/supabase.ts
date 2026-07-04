import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';

/**
 * Lazy-initialized Supabase clients.
 * Clients are created on first use (not at import time) so that dotenv.config()
 * in server.ts has already loaded the environment variables.
 *
 * WebSocket is explicitly passed via both `global` and `realtime.transport` so that
 * Supabase Realtime works in Node.js environments (Railway) where no global WebSocket exists.
 */

let _authClient: SupabaseClient | null = null;
let _adminClient: SupabaseClient | null = null;

const wsOptions = {
  realtime: { transport: WebSocket as any },
};

/** Anon-key client — used for auth operations (login, token verification). */
export function getSupabaseAuth(): SupabaseClient {
  if (!_authClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY not set in environment');
    _authClient = createClient(url, key, wsOptions);
  }
  return _authClient;
}

/** Service-role client — used for privileged DB operations (bypasses RLS). */
export function getSupabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in environment');
    _adminClient = createClient(url, key, wsOptions);
  }
  return _adminClient;
}
