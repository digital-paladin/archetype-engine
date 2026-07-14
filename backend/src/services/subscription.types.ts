export type SubscriptionTier = 'free' | 'paladin' | 'shadow_monarch';

const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  paladin: 1,
  shadow_monarch: 2,
};

export function normalizeTier(raw: string | null | undefined): SubscriptionTier {
  if (raw === 'paladin' || raw === 'shadow_monarch') return raw;
  return 'free';
}

export function tierAtLeast(current: SubscriptionTier, required: SubscriptionTier): boolean {
  return TIER_RANK[current] >= TIER_RANK[required];
}

export function tierLabel(tier: SubscriptionTier): string {
  switch (tier) {
    case 'shadow_monarch': return 'Shadow Monarch';
    case 'paladin': return 'Paladin';
    default: return 'Free';
  }
}

export const TIER_FEATURES: Record<SubscriptionTier, string[]> = {
  free: [
    'Basic XP tracking',
    'Limited skill trees',
    'Daily quests',
    'Manual sleep entry',
  ],
  paladin: [
    'All skill trees',
    'Wearable sync (Oura / Garmin)',
    '3D character',
    'Full ACM + XP projections',
  ],
  shadow_monarch: [
    'Everything in Paladin',
    'AI narrative summaries',
    'Quest customization',
    'Data export & Chronicle tools',
  ],
};
