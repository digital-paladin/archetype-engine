import { Request, Response } from 'express';
import { requireTier } from '../middleware/requireTier.middleware';

jest.mock('../services/subscription.service', () => ({
  getUserTier: jest.fn(),
}));

import { getUserTier } from '../services/subscription.service';

const mockGetUserTier = getUserTier as jest.MockedFunction<typeof getUserTier>;

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('requireTier middleware', () => {
  beforeEach(() => {
    mockGetUserTier.mockReset();
    delete process.env.OWNER_USER_ID;
    delete process.env.BILLING_BYPASS;
  });

  it('returns 403 with upgrade payload when tier too low', async () => {
    mockGetUserTier.mockResolvedValue('free');
    const req = { userId: 'user-1' } as any;
    const res = mockRes();
    const next = jest.fn();

    await requireTier('paladin')(req as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'TIER_REQUIRED',
        requiredTier: 'paladin',
        currentTier: 'free',
        upgrade: expect.objectContaining({
          checkoutPath: '/api/billing/checkout',
        }),
      }),
    );
  });

  it('calls next when tier sufficient', async () => {
    mockGetUserTier.mockResolvedValue('paladin');
    const req = { userId: 'user-1' } as any;
    const res = mockRes();
    const next = jest.fn();

    await requireTier('paladin')(req as Request, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows shadow_monarch for AI gate', async () => {
    mockGetUserTier.mockResolvedValue('shadow_monarch');
    const req = { userId: 'user-1' } as any;
    const res = mockRes();
    const next = jest.fn();

    await requireTier('shadow_monarch')(req as Request, res, next);
    expect(next).toHaveBeenCalled();
  });
});
