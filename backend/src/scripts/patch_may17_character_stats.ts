/**
 * patch_may17_character_stats.ts
 *
 * Upserts character_stats to the May 17, 2026 CURRENT-STATS freeze
 * (current-character-state-051726 / character-sheet.md).
 *
 * Run from backend/:
 *   npx ts-node src/scripts/patch_may17_character_stats.ts
 *
 * Requires in backend/.env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   OWNER_USER_ID and/or OWNER_EMAIL
 */

import dotenv from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

dotenv.config({ path: resolve(__dirname, '../../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OWNER_USER_ID = process.env.OWNER_USER_ID?.trim();
const OWNER_EMAIL = process.env.OWNER_EMAIL?.trim().toLowerCase();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[PATCH] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!OWNER_USER_ID && !OWNER_EMAIL) {
  console.error('[PATCH] Set OWNER_USER_ID or OWNER_EMAIL in backend/.env');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { fetch: fetch as any },
  realtime: { transport: WebSocket as any },
});

/** May 17, 2026 CURRENT-STATS block (character-sheet.md) */
const MAY17_STATS: Array<{
  class_name: string;
  level: number;
  current_xp: number;
  total_xp: number;
}> = [
  { class_name: 'Developer', level: 20, current_xp: 4197, total_xp: 132614 },
  { class_name: 'Sage', level: 26, current_xp: 5676, total_xp: 149379 },
  { class_name: 'Warrior', level: 9, current_xp: 1938, total_xp: 16663 },
  { class_name: 'Artist', level: 9, current_xp: 589, total_xp: 15568 },
  { class_name: 'Redteamer', level: 11, current_xp: 1986, total_xp: 21840 },
  { class_name: 'Financial Strategist', level: 1, current_xp: 45, total_xp: 45 },
  { class_name: 'Survivalist', level: 1, current_xp: 0, total_xp: 0 },
];

async function main(): Promise<void> {
  let userId: string;
  if (OWNER_USER_ID) {
    userId = OWNER_USER_ID;
    console.log(`[PATCH] user=${userId} (OWNER_USER_ID)`);
  } else {
    const { data, error } = await db.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const user = data.users.find(u => (u.email || '').toLowerCase() === OWNER_EMAIL);
    if (!user) throw new Error(`User ${OWNER_EMAIL} not found`);
    userId = user.id;
    console.log(`[PATCH] user=${userId} (${OWNER_EMAIL})`);
  }

  for (const s of MAY17_STATS) {
    const { error: upErr } = await db.from('character_stats').upsert(
      {
        user_id: userId,
        class_name: s.class_name,
        level: s.level,
        current_xp: s.current_xp,
        total_xp: s.total_xp,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,class_name' }
    );
    if (upErr) {
      console.error(`[PATCH] ❌ ${s.class_name}:`, upErr.message);
    } else {
      console.log(`[PATCH] ✅ ${s.class_name} L${s.level} (${s.current_xp} / total ${s.total_xp})`);
    }
  }
  console.log('[PATCH] Done — redeploy not required; /api/character/stats reads DB live.');
}

main().catch(e => {
  console.error('[PATCH] Fatal:', e);
  process.exit(1);
});
