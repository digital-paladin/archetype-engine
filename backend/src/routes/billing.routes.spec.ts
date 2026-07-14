import express from 'express';
import request from 'supertest';

jest.mock('../middleware/auth.middleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 'test-user';
    next();
  },
}));

jest.mock('../services/stripe.service', () => ({
  isStripeConfigured: jest.fn(() => true),
  createCheckoutSession: jest.fn(async () => ({
    url: 'https://checkout.stripe.com/test',
    sessionId: 'cs_test_123',
  })),
  createBillingPortalSession: jest.fn(async () => ({
    url: 'https://billing.stripe.com/test',
  })),
}));

jest.mock('../services/subscription.service', () => ({
  getUserTier: jest.fn(async () => 'free'),
  getSubscription: jest.fn(async () => null),
}));

jest.mock('../lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 't@example.com' } } }) } },
  }),
}));

import billingRouter from './billing.routes';
import { createCheckoutSession } from '../services/stripe.service';

describe('billing routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/billing', billingRouter);

  it('POST /checkout rejects invalid plan', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .send({ plan: 'gold' });
    expect(res.status).toBe(400);
  });

  it('POST /checkout returns Stripe URL for paladin', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .send({ plan: 'paladin' });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('checkout.stripe.com');
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'test-user', plan: 'paladin' }),
    );
  });

  it('GET /status returns tier payload', async () => {
    const res = await request(app).get('/api/billing/status');
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('free');
    expect(res.body.configured).toBe(true);
  });
});
