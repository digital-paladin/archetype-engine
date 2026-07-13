import { getSupabaseAdmin } from '../lib/supabase';
import { getDataService } from './data/dataService';
import {
  ClassTemplate,
  normalizeDomains,
  suggestClassTemplate,
} from './classTemplates';

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
  const now = new Date();
  if (d.getUTCFullYear() < 1900) return false;
  if (d.getTime() > now.getTime()) return false;
  return true;
}

export interface ProvisionIdentity {
  lifeDomains: string[];
  classTemplate: ClassTemplate;
  classDisplayName: string;
}

/**
 * Validate optional identity scaffold from signup body.
 * domains: 3–5 life domains required when provided; empty = skip scaffold (thin signup only).
 */
export function resolveSignupIdentity(body: {
  domains?: unknown;
  classDisplayName?: unknown;
}): { ok: true; identity: ProvisionIdentity | null } | { ok: false; error: string } {
  const domains = normalizeDomains(body.domains);
  if (domains.length === 0) {
    return { ok: true, identity: null };
  }
  if (domains.length < 3 || domains.length > 5) {
    return { ok: false, error: 'select 3 to 5 life domains' };
  }

  const template = suggestClassTemplate(domains);
  let display =
    typeof body.classDisplayName === 'string' ? body.classDisplayName.trim() : '';
  if (!display) display = template.name;
  if (display.length > 48) {
    return { ok: false, error: 'classDisplayName max 48 characters' };
  }

  return {
    ok: true,
    identity: {
      lifeDomains: domains,
      classTemplate: template,
      classDisplayName: display,
    },
  };
}

/**
 * Ensure public.users row + starter character_stats + profile for a new auth user.
 * Idempotent: safe if partially applied.
 */
export async function provisionNewUser(params: {
  userId: string;
  email: string;
  birthDate: string;
  identity?: ProvisionIdentity | null;
}): Promise<void> {
  const { userId, email, birthDate, identity } = params;
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

  const rpg_stats: Record<string, unknown> = {};
  if (identity) {
    rpg_stats.lifeDomains = identity.lifeDomains;
    rpg_stats.classTemplateId = identity.classTemplate.id;
    rpg_stats.classTemplateName = identity.classTemplate.name;
    rpg_stats.classDisplayName = identity.classDisplayName;
  }

  await db.upsertCharacterProfile(userId, {
    vitality: 100,
    sleep_debt: 0,
    sage_streak: 0,
    phase: 'foundation',
    acm_metrics: {},
    rpg_stats,
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
