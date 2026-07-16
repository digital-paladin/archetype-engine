/**
 * seed_demo.ts
 *
 * Seeds fake Hunter stats for DEMO_USER_ID (dedicated Auth user — never Owner).
 * Safe to re-run: wipe + reseed via demo.service.
 *
 * Run: npm run seed:demo
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_USER_ID
 */

import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

import {
  assertDemoUserSafe,
  getConfiguredDemoUserId,
  seedDemoHunter,
  wipeDemoMutableData,
} from '../services/demo.service';
import { getSupabaseAdmin } from '../lib/supabase';

async function main(): Promise<void> {
  const demoUserId = getConfiguredDemoUserId();
  if (!demoUserId) {
    console.error('[SEED:DEMO] ❌  DEMO_USER_ID is not set');
    process.exit(1);
  }

  try {
    assertDemoUserSafe(demoUserId);
  } catch (e) {
    console.error('[SEED:DEMO] ❌ ', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.getUserById(demoUserId);
  if (error || !data.user?.email) {
    console.error('[SEED:DEMO] ❌  Demo Auth user not found:', error?.message);
    process.exit(1);
  }

  console.log(`[SEED:DEMO] Wiping + seeding ${data.user.email} (${demoUserId})`);
  await wipeDemoMutableData(demoUserId);
  await seedDemoHunter(demoUserId, data.user.email);
  console.log('[SEED:DEMO] ✅  Fake Demo Hunter ready (not Owner sheet)');
}

main().catch((e) => {
  console.error('[SEED:DEMO] ❌ ', e);
  process.exit(1);
});
