import { Router, Request, Response } from 'express';
import {
  constructWebhookEvent,
  handleStripeEvent,
} from '../services/stripe.service';

const router = Router();

/**
 * POST /api/stripe/webhook
 * Must receive raw body (mounted with express.raw in server.ts).
 * No authMiddleware — Stripe signature is the credential.
 */
router.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing stripe-signature header' });
  }

  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

    const event = constructWebhookEvent(rawBody, signature);
    await handleStripeEvent(event);
    return res.json({ received: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Webhook error';
    console.error(`[STRIPE] webhook failed: ${msg}`);
    return res.status(400).json({ success: false, error: msg });
  }
});

export default router;
