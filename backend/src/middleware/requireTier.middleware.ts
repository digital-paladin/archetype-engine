import { Request, Response, NextFunction } from 'express';
import { getUserTier } from '../services/subscription.service';
import {
  SubscriptionTier,
  tierAtLeast,
  tierLabel,
} from '../services/subscription.types';

/**
 * Require minimum subscription tier. Returns 403 with upgrade prompt payload.
 * Use after authMiddleware so req.userId is set.
 */
export function requireTier(minimum: SubscriptionTier) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId as string | undefined;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const tier = await getUserTier(userId);
      if (tierAtLeast(tier, minimum)) {
        (req as any).tier = tier;
        return next();
      }

      return res.status(403).json({
        success: false,
        error: `Requires ${tierLabel(minimum)} tier or higher`,
        code: 'TIER_REQUIRED',
        currentTier: tier,
        requiredTier: minimum,
        upgrade: {
          message: `Upgrade to ${tierLabel(minimum)} to unlock this feature.`,
          checkoutPath: '/api/billing/checkout',
          plans: ['paladin', 'shadow_monarch'],
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tier check failed';
      console.error(`[BILLING] requireTier error: ${msg}`);
      return res.status(500).json({ success: false, error: msg });
    }
  };
}
