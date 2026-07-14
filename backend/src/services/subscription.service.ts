import { getSupabaseAdmin } from '../lib/supabase';
import { normalizeTier, SubscriptionTier } from './subscription.types';

export interface SubscriptionRecord {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  plan: 'paladin' | 'shadow_monarch' | null;
  current_period_end: string | null;
}

export async function getUserTier(userId: string): Promise<SubscriptionTier> {
  // Owner / local bypass — never block personal ops on missing Stripe
  if (process.env.OWNER_USER_ID && userId === process.env.OWNER_USER_ID) {
    return 'shadow_monarch';
  }
  if (process.env.BILLING_BYPASS === '1' || process.env.BILLING_BYPASS === 'true') {
    return normalizeTier(process.env.BILLING_BYPASS_TIER || 'shadow_monarch');
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('users')
    .select('tier')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn(`[BILLING] getUserTier failed: ${error.message}`);
    return 'free';
  }
  return normalizeTier(data?.tier);
}

export async function getSubscription(userId: string): Promise<SubscriptionRecord | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    user_id: data.user_id,
    stripe_customer_id: data.stripe_customer_id ?? null,
    stripe_subscription_id: data.stripe_subscription_id ?? null,
    status: data.status ?? 'inactive',
    plan: data.plan ?? null,
    current_period_end: data.current_period_end ?? null,
  };
}

export async function upsertSubscription(
  userId: string,
  patch: Partial<Omit<SubscriptionRecord, 'user_id'>>,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      ...patch,
    },
    { onConflict: 'user_id' },
  );
  if (error) throw error;
}

export async function setUserTier(userId: string, tier: SubscriptionTier): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('users')
    .update({ tier })
    .eq('id', userId);
  if (error) throw error;
}

export function planFromPriceId(priceId: string | null | undefined): 'paladin' | 'shadow_monarch' | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_PALADIN) return 'paladin';
  if (priceId === process.env.STRIPE_PRICE_SHADOW_MONARCH) return 'shadow_monarch';
  // Allow yearly aliases
  if (priceId === process.env.STRIPE_PRICE_PALADIN_YEARLY) return 'paladin';
  if (priceId === process.env.STRIPE_PRICE_SHADOW_MONARCH_YEARLY) return 'shadow_monarch';
  return null;
}

export function tierFromPlanAndStatus(
  plan: 'paladin' | 'shadow_monarch' | null,
  status: string,
): SubscriptionTier {
  const active = ['active', 'trialing'].includes(status);
  if (!active || !plan) return 'free';
  return plan;
}
