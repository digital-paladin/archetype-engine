/**
 * Public Try Demo — session + fake seed for a dedicated Supabase Auth user.
 * Never use OWNER_USER_ID. Mutable rows are wiped/reseeded on each demo login.
 */

import { getSupabaseAdmin, getSupabaseAuth } from '../lib/supabase';
import { getDataService } from './data/dataService';
import { STARTER_CLASS_NAMES } from './onboarding.service';

/** Synthetic DOB → Overall Level ≈ age (not Owner sheet). */
export const DEMO_BIRTH_DATE = '1998-06-15';

/** Distinctive mid-tier fake stats — never May 17 Owner freeze. */
export const DEMO_CLASS_STATS: Array<{
  class_name: (typeof STARTER_CLASS_NAMES)[number];
  level: number;
  current_xp: number;
  total_xp: number;
}> = [
  { class_name: 'Developer', level: 5, current_xp: 420, total_xp: 2400 },
  { class_name: 'Sage', level: 7, current_xp: 180, total_xp: 4100 },
  { class_name: 'Warrior', level: 4, current_xp: 90, total_xp: 1600 },
  { class_name: 'Artist', level: 3, current_xp: 210, total_xp: 900 },
  { class_name: 'Redteamer', level: 4, current_xp: 55, total_xp: 1500 },
  { class_name: 'Financial Strategist', level: 2, current_xp: 120, total_xp: 400 },
  { class_name: 'Survivalist', level: 2, current_xp: 80, total_xp: 350 },
];

const MUTABLE_TABLES = [
  'xp_history',
  'daily_journal_entries',
  'acm_entries',
  'quest_entries',
  'quest_lines',
  'activity_log',
  'vault_items',
  'courage_entries',
  'active_status_effects',
  'spending_entries',
  'skill_tree_entries',
  'fitbit_tokens',
  'wearable_tokens',
] as const;

export function getConfiguredDemoUserId(): string | null {
  const id = process.env.DEMO_USER_ID?.trim();
  return id || null;
}

export function assertDemoUserSafe(demoUserId: string): void {
  const ownerId = process.env.OWNER_USER_ID?.trim();
  if (ownerId && demoUserId === ownerId) {
    throw new Error('DEMO_USER_ID must not equal OWNER_USER_ID');
  }
}

/** In-memory IP rate limit for demo-login (no extra dependency). */
const demoHits = new Map<string, number[]>();

export function checkDemoRateLimit(
  ip: string,
  maxPerHour = 20,
  windowMs = 60 * 60 * 1000,
): boolean {
  const now = Date.now();
  const prior = (demoHits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (prior.length >= maxPerHour) {
    demoHits.set(ip, prior);
    return false;
  }
  prior.push(now);
  demoHits.set(ip, prior);
  return true;
}

/** Test helper — clear rate-limit bucket. */
export function _resetDemoRateLimitForTests(): void {
  demoHits.clear();
}

export async function wipeDemoMutableData(userId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  for (const table of MUTABLE_TABLES) {
    const { error } = await admin.from(table).delete().eq('user_id', userId);
    if (error && !/does not exist|relation/i.test(error.message)) {
      // Best-effort wipe — missing optional tables should not block demo
      console.warn(`[demo] wipe ${table}: ${error.message}`);
    }
  }
}

export async function seedDemoHunter(userId: string, email: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const db = getDataService();

  const { error: userErr } = await admin.from('users').upsert(
    {
      id: userId,
      email,
      birth_date: DEMO_BIRTH_DATE,
      tier: 'free',
    },
    { onConflict: 'id' }
  );
  if (userErr) throw new Error(`demo users upsert failed: ${userErr.message}`);

  for (const row of DEMO_CLASS_STATS) {
    await db.upsertCharacterStats(userId, { ...row });
  }

  await db.upsertCharacterProfile(userId, {
    vitality: 88,
    sleep_debt: 1.5,
    sage_streak: 12,
    phase: 'foundation',
    acm_metrics: { pleasure: 7, clarity: 8, vitality: 8 },
    rpg_stats: {
      isDemo: true,
      classDisplayName: 'Demo Hunter',
      classTemplateName: 'Paladin',
      lifeDomains: ['Physical Training', 'Software Engineering', 'Spiritual Growth'],
    },
  });

  await db.upsertQuestLines(userId, [
    {
      name: 'First Week as a Hunter',
      icon: '⚔️',
      class_name: 'Sage',
      status_text: 'In progress',
      status_emoji: '🔥',
      tagline: 'Seeded demo quest line — safe to explore.',
      sort_order: 0,
    },
  ]);
}

/**
 * Issue a real Supabase session for the demo user without a shared password.
 * Uses admin generateLink + verifyOtp (magiclink).
 */
export async function issueDemoSession(demoUserId: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  assertDemoUserSafe(demoUserId);

  const admin = getSupabaseAdmin();
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(demoUserId);
  if (userErr || !userData.user?.email) {
    throw new Error(userErr?.message || 'Demo user not found — set DEMO_USER_ID to a valid Auth user');
  }

  const email = userData.user.email;

  await wipeDemoMutableData(demoUserId);
  await seedDemoHunter(demoUserId, email);

  // Optional password path (server env only — never README)
  const demoPassword = process.env.DEMO_USER_PASSWORD?.trim();
  if (demoPassword) {
    const { data, error } = await getSupabaseAuth().auth.signInWithPassword({
      email,
      password: demoPassword,
    });
    if (error || !data.session) {
      throw new Error(error?.message || 'Demo password sign-in failed');
    }
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(
      linkErr?.message ||
        'Could not generate demo session — set DEMO_USER_PASSWORD or check Auth admin API'
    );
  }

  const { data: otpData, error: otpErr } = await getSupabaseAuth().auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });
  if (otpErr || !otpData.session) {
    throw new Error(otpErr?.message || 'Demo OTP verify failed');
  }

  return {
    accessToken: otpData.session.access_token,
    refreshToken: otpData.session.refresh_token,
  };
}
