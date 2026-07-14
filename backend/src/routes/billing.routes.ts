import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { getSupabaseAdmin } from '../lib/supabase';
import { getSubscription, getUserTier } from '../services/subscription.service';
import { TIER_FEATURES, tierLabel } from '../services/subscription.types';
import {
  createBillingPortalSession,
  createCheckoutSession,
  isStripeConfigured,
} from '../services/stripe.service';

const router = Router();

router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const [tier, sub] = await Promise.all([
      getUserTier(userId),
      getSubscription(userId),
    ]);
    return res.json({
      success: true,
      configured: isStripeConfigured(),
      tier,
      tierLabel: tierLabel(tier),
      features: TIER_FEATURES[tier],
      subscription: sub
        ? {
            status: sub.status,
            plan: sub.plan,
            currentPeriodEnd: sub.current_period_end,
            hasCustomer: !!sub.stripe_customer_id,
          }
        : null,
      prices: {
        paladin: process.env.STRIPE_PRICE_PALADIN ? 'configured' : null,
        shadow_monarch: process.env.STRIPE_PRICE_SHADOW_MONARCH ? 'configured' : null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/billing/checkout
 * Body: { plan: 'paladin' | 'shadow_monarch' }
 */
router.post('/checkout', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!isStripeConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_* on the server.',
      });
    }

    const plan = req.body?.plan;
    if (plan !== 'paladin' && plan !== 'shadow_monarch') {
      return res.status(400).json({
        success: false,
        error: "plan must be 'paladin' or 'shadow_monarch'",
      });
    }

    const userId = (req as any).userId as string;
    let email: string | undefined;
    try {
      const { data } = await getSupabaseAdmin().auth.admin.getUserById(userId);
      email = data.user?.email;
    } catch { /* optional */ }

    const session = await createCheckoutSession({ userId, email, plan });
    return res.json({ success: true, url: session.url, sessionId: session.sessionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Checkout failed';
    console.error(`[BILLING] checkout error: ${msg}`);
    return res.status(500).json({ success: false, error: msg });
  }
});

router.post('/portal', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!isStripeConfigured()) {
      return res.status(503).json({ success: false, error: 'Stripe is not configured' });
    }
    const userId = (req as any).userId as string;
    const session = await createBillingPortalSession(userId);
    return res.json({ success: true, url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Portal failed';
    return res.status(400).json({ success: false, error: msg });
  }
});

export default router;
