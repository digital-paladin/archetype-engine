/**
 * patch_may17_character_stats.ts
 *
 * Upserts Owner character_stats + freeze 1RMs / sage streak / ACM metrics
 * from current-character-state-051726 / character-sheet.md.
 *
 * Does NOT wipe journal, xp_history, vitality, or sleep_debt (live data since May 17).
 * rpg_stats is merged — api_key / equipped_armor / identity keys are kept.
 *
 * Run from backend/:
 *   npx ts-node --transpile-only src/scripts/patch_may17_character_stats.ts
 *
 * Requires in backend/.env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   OWNER_USER_ID and/or OWNER_EMAIL
 * Optional: MAY17_SNAPSHOT_DIR
 */

import dotenv from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { CharacterParser } from '../parser/characterParser';

dotenv.config({ path: resolve(__dirname, '../../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OWNER_USER_ID = process.env.OWNER_USER_ID?.trim();
const OWNER_EMAIL = process.env.OWNER_EMAIL?.trim().toLowerCase();
const SNAPSHOT_DIR = process.env.MAY17_SNAPSHOT_DIR
  || 'C:/Users/wraith-admin/gitlab/solo-leveling-journey/character-progression/current-character-state-051726';
const CHAR_SHEET = resolve(SNAPSHOT_DIR, 'character-sheet.md');

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

async function resolveUserId(): Promise<string> {
  if (OWNER_USER_ID) {
    console.log(`[PATCH] user=${OWNER_USER_ID} (OWNER_USER_ID)`);
    return OWNER_USER_ID;
  }
  const { data, error } = await db.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const user = data.users.find(u => (u.email || '').toLowerCase() === OWNER_EMAIL);
  if (!user) throw new Error(`User ${OWNER_EMAIL} not found`);
  console.log(`[PATCH] user=${user.id} (${OWNER_EMAIL})`);
  return user.id;
}

async function patchClassStats(userId: string): Promise<void> {
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
}

async function patchProfileFromSheet(userId: string): Promise<void> {
  console.log(`[PATCH] Parsing freeze sheet: ${CHAR_SHEET}`);
  const parsed = await new CharacterParser(CHAR_SHEET).parse();
  const lifts = parsed.rpgStats;
  console.log(`[PATCH] sageStreak=${parsed.sageStreak ?? 0}`);
  console.log(`[PATCH] lifts squat=${lifts?.squat?.value ?? '(none)'} dl=${lifts?.deadlift?.value ?? '(none)'} bench=${lifts?.benchPress?.value ?? '(none)'} ohp=${lifts?.overheadPress?.value ?? '(none)'}`);

  const { data: existing, error: readErr } = await db
    .from('character_profile')
    .select('rpg_stats, vitality, sleep_debt')
    .eq('user_id', userId)
    .maybeSingle();
  if (readErr) throw new Error(`character_profile read: ${readErr.message}`);

  const prevRpg = (existing?.rpg_stats && typeof existing.rpg_stats === 'object')
    ? existing.rpg_stats as Record<string, unknown>
    : {};
  const rpg_stats = {
    ...prevRpg,
    ...(lifts?.squat && lifts.squat.value !== '[TBD]' ? { squat: lifts.squat } : {}),
    ...(lifts?.deadlift && lifts.deadlift.value !== '[TBD]' ? { deadlift: lifts.deadlift } : {}),
    ...(lifts?.benchPress && lifts.benchPress.value !== '[TBD]' ? { benchPress: lifts.benchPress } : {}),
    ...(lifts?.overheadPress && lifts.overheadPress.value !== '[TBD]' ? { overheadPress: lifts.overheadPress } : {}),
  };

  const row: Record<string, unknown> = {
    user_id: userId,
    rpg_stats,
    sage_streak: parsed.sageStreak ?? 0,
    acm_metrics: parsed.acmMetrics ?? {},
    updated_at: new Date().toISOString(),
  };
  // Keep live vitality / sleep_debt when the profile already has them.
  if (existing?.vitality == null) row.vitality = parsed.vitality?.current ?? 100;
  if (existing?.sleep_debt == null) row.sleep_debt = parsed.sleepDebt?.currentDebt ?? 0;

  const { error: upErr } = await db.from('character_profile').upsert(row, { onConflict: 'user_id' });
  if (upErr) throw new Error(`character_profile upsert: ${upErr.message}`);
  console.log('[PATCH] ✅ character_profile merged (lifts + sage_streak + acm_metrics; vitality/sleep_debt preserved if set)');
}

async function main(): Promise<void> {
  const userId = await resolveUserId();
  await patchClassStats(userId);
  await patchProfileFromSheet(userId);
  console.log('[PATCH] Done — redeploy not required; /api/character/stats reads DB live.');
}

main().catch(e => {
  console.error('[PATCH] Fatal:', e);
  process.exit(1);
});
