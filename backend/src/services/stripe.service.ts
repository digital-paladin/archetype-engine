import Stripe from 'stripe';
import {
  getSubscription,
  planFromPriceId,
  setUserTier,
  tierFromPlanAndStatus,
  upsertSubscription,
} from './subscription.service';

let _stripe: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PALADIN);
}

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not set');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

export function priceIdForPlan(plan: 'paladin' | 'shadow_monarch'): string {
  const id = plan === 'paladin'
    ? process.env.STRIPE_PRICE_PALADIN
    : process.env.STRIPE_PRICE_SHADOW_MONARCH;
  if (!id) throw new Error(`Stripe price not configured for plan=${plan}`);
  return id;
}

export async function createCheckoutSession(opts: {
  userId: string;
  email?: string;
  plan: 'paladin' | 'shadow_monarch';
}): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe();
  const existing = await getSubscription(opts.userId);
  let customerId = existing?.stripe_customer_id || undefined;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: opts.email,
      metadata: { user_id: opts.userId },
    });
    customerId = customer.id;
    await upsertSubscription(opts.userId, {
      stripe_customer_id: customerId,
      status: 'inactive',
    });
  }

  const success = (process.env.STRIPE_SUCCESS_URL
    || `${process.env.FRONTEND_URL || 'http://localhost:4200'}/dashboard?billing=success`)
    .replace(/\/$/, '');
  const cancel = (process.env.STRIPE_CANCEL_URL
    || `${process.env.FRONTEND_URL || 'http://localhost:4200'}/dashboard?billing=cancel`)
    .replace(/\/$/, '');

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceIdForPlan(opts.plan), quantity: 1 }],
    success_url: success.includes('?') ? `${success}&session_id={CHECKOUT_SESSION_ID}` : `${success}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancel,
    client_reference_id: opts.userId,
    metadata: { user_id: opts.userId, plan: opts.plan },
    subscription_data: {
      metadata: { user_id: opts.userId, plan: opts.plan },
    },
  });

  if (!session.url) throw new Error('Stripe checkout session missing URL');
  return { url: session.url, sessionId: session.id };
}

export async function createBillingPortalSession(userId: string): Promise<{ url: string }> {
  const stripe = getStripe();
  const existing = await getSubscription(userId);
  if (!existing?.stripe_customer_id) {
    throw new Error('No Stripe customer on file — start a checkout first');
  }
  const returnUrl = (process.env.FRONTEND_URL || 'http://localhost:4200').replace(/\/$/, '') + '/dashboard';
  const session = await stripe.billingPortal.sessions.create({
    customer: existing.stripe_customer_id,
    return_url: returnUrl,
  });
  return { url: session.url };
}

export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set');
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}

export async function applySubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  const userId = sub.metadata?.user_id;
  if (!userId) {
    console.warn('[STRIPE] subscription missing metadata.user_id — skip');
    return;
  }

  const priceId = sub.items.data[0]?.price?.id;
  const plan = planFromPriceId(priceId) || (sub.metadata?.plan as 'paladin' | 'shadow_monarch' | undefined) || null;
  const status = sub.status;
  const periodEnd = (sub as any).current_period_end
    ? new Date((sub as any).current_period_end * 1000).toISOString()
    : null;

  await upsertSubscription(userId, {
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    status,
    plan,
    current_period_end: periodEnd,
  });

  const tier = tierFromPlanAndStatus(plan, status);
  await setUserTier(userId, tier);
  console.log(`[STRIPE] user=${userId.slice(0, 8)}… status=${status} plan=${plan} tier=${tier}`);
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await applySubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'subscription' && session.subscription) {
        const stripe = getStripe();
        const subId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription.id;
        const sub = await stripe.subscriptions.retrieve(subId);
        // Ensure user_id metadata
        if (!sub.metadata?.user_id && session.metadata?.user_id) {
          await stripe.subscriptions.update(subId, {
            metadata: {
              ...sub.metadata,
              user_id: session.metadata.user_id,
              plan: session.metadata.plan || '',
            },
          });
          const refreshed = await stripe.subscriptions.retrieve(subId);
          await applySubscriptionUpdated(refreshed);
        } else {
          await applySubscriptionUpdated(sub);
        }
      }
      break;
    }
    default:
      // ignore other events
      break;
  }
}
