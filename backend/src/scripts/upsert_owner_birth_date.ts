/**
 * upsert_owner_birth_date.ts
 *
 * Sets public.users.birth_date for the Owner (SaaS overall-level source).
 * Never commit a real DOB — pass via backend/.env only.
 *
 *   cd backend
 *   # .env must include PLAYER_BIRTH_DATE=YYYY-MM-DD and OWNER_USER_ID or OWNER_EMAIL
 *   npx ts-node --transpile-only src/scripts/upsert_owner_birth_date.ts
 */

import dotenv from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { calculateOverallLevelInfo } from '../utils/overallLevel';

dotenv.config({ path: resolve(__dirname, '../../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OWNER_USER_ID = process.env.OWNER_USER_ID?.trim();
const OWNER_EMAIL = process.env.OWNER_EMAIL?.trim().toLowerCase();
const BIRTH_DATE = process.env.PLAYER_BIRTH_DATE?.trim();

const BIRTH_RE = /^\d{4}-\d{2}-\d{2}$/;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[BIRTH] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!BIRTH_DATE || !BIRTH_RE.test(BIRTH_DATE)) {
  console.error('[BIRTH] Set PLAYER_BIRTH_DATE=YYYY-MM-DD in backend/.env (do not commit)');
  process.exit(1);
}
if (!OWNER_USER_ID && !OWNER_EMAIL) {
  console.error('[BIRTH] Set OWNER_USER_ID or OWNER_EMAIL in backend/.env');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { fetch: fetch as any },
  realtime: { transport: WebSocket as any },
});

async function resolveUserId(): Promise<{ id: string; email: string }> {
  if (OWNER_USER_ID) {
    const { data, error } = await db.auth.admin.getUserById(OWNER_USER_ID);
    if (error || !data.user) {
      throw new Error(`getUserById failed: ${error?.message || 'not found'}`);
    }
    return { id: data.user.id, email: data.user.email || OWNER_EMAIL || '' };
  }

  const { data, error } = await db.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const user = data.users.find(u => (u.email || '').toLowerCase() === OWNER_EMAIL);
  if (!user) throw new Error(`User ${OWNER_EMAIL} not found`);
  return { id: user.id, email: user.email || OWNER_EMAIL! };
}

async function main(): Promise<void> {
  const user = await resolveUserId();
  console.log(`[BIRTH] user_id=${user.id} email=${user.email || '(none)'}`);

  const { error } = await db.from('users').upsert(
    {
      id: user.id,
      email: user.email || `owner-${user.id}@local`,
      birth_date: BIRTH_DATE,
    },
    { onConflict: 'id' }
  );
  if (error) throw new Error(`users upsert: ${error.message}`);

  const level = calculateOverallLevelInfo(BIRTH_DATE);
  console.log(
    `[BIRTH] ✅ birth_date set — expected overall Level ${level.level} ` +
      `(next ${level.nextLevelDate}, ${level.daysRemaining}d)`
  );
}

main().catch(e => {
  console.error('[BIRTH] Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
