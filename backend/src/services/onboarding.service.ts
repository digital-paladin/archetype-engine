import { getSupabaseAdmin } from '../lib/supabase';
import { getDataService } from './data/dataService';

/** Default skill trees for a new Hunter (thin onboarding slice). */
export const STARTER_CLASS_NAMES = [
  'Developer',
  'Sage',
  'Warrior',
  'Artist',
  'Redteamer',
  'Financial Strategist',
  'Survivalist',
] as const;

const BIRTH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidBirthDate(value: string): boolean {
  if (!BIRTH_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // Reject future dates and absurd antiquity
  const now = new Date();
  if (d.getUTCFullYear() < 1900) return false;
  if (d.getTime() > now.getTime()) return false;
  return true;
}

/**
 * Ensure public.users row + starter character_stats + profile for a new auth user.
 * Idempotent: safe if partially applied.
 */
export async function provisionNewUser(params: {
  userId: string;
  email: string;
  birthDate: string;
}): Promise<void> {
  const { userId, email, birthDate } = params;
  const admin = getSupabaseAdmin();
  const db = getDataService();

  const { error: userErr } = await admin.from('users').upsert(
    {
      id: userId,
      email,
      birth_date: birthDate,
      tier: 'free',
    },
    { onConflict: 'id' }
  );
  if (userErr) throw new Error(`users upsert failed: ${userErr.message}`);

  for (const className of STARTER_CLASS_NAMES) {
    await db.upsertCharacterStats(userId, {
      class_name: className,
      level: 1,
      current_xp: 0,
      total_xp: 0,
    });
  }

  await db.upsertCharacterProfile(userId, {
    vitality: 100,
    sleep_debt: 0,
    sage_streak: 0,
    phase: 'foundation',
    acm_metrics: {},
    rpg_stats: {},
  });
}

export async function getUserBirthDate(userId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('users')
    .select('birth_date')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.birth_date ?? null;
}
