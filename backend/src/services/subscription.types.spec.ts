import { normalizeTier, tierAtLeast } from './subscription.types';
import { tierFromPlanAndStatus } from './subscription.service';

describe('subscription tiers', () => {
  it('normalizeTier defaults unknown to free', () => {
    expect(normalizeTier(undefined)).toBe('free');
    expect(normalizeTier('paladin')).toBe('paladin');
    expect(normalizeTier('shadow_monarch')).toBe('shadow_monarch');
    expect(normalizeTier('gold')).toBe('free');
  });

  it('tierAtLeast ranks correctly', () => {
    expect(tierAtLeast('free', 'paladin')).toBe(false);
    expect(tierAtLeast('paladin', 'paladin')).toBe(true);
    expect(tierAtLeast('shadow_monarch', 'paladin')).toBe(true);
    expect(tierAtLeast('paladin', 'shadow_monarch')).toBe(false);
  });

  it('tierFromPlanAndStatus maps Stripe status', () => {
    expect(tierFromPlanAndStatus('paladin', 'active')).toBe('paladin');
    expect(tierFromPlanAndStatus('shadow_monarch', 'trialing')).toBe('shadow_monarch');
    expect(tierFromPlanAndStatus('paladin', 'canceled')).toBe('free');
    expect(tierFromPlanAndStatus(null, 'active')).toBe('free');
  });
});
