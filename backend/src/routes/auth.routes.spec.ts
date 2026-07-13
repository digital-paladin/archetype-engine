/**
 * auth.routes.ts — Unit & Integration Tests
 *
 * POST /api/auth/login   — signInWithPassword via Supabase Auth
 * POST /api/auth/refresh — refreshSession via Supabase Auth
 * GET  /api/auth/verify  — returns success (authMiddleware handles JWT validation)
 *
 * Note: The login failure path intentionally delays 1 s to resist brute force.
 * Tests that hit the failure path allow up to 3 s per the per-test timeout below.
 */

import request from 'supertest';
import express, { Express } from 'express';

// ── Mock getSupabaseAuth BEFORE importing the route ────────────────────────
const mockSignIn  = jest.fn<Promise<any>, any[]>();
const mockRefresh = jest.fn<Promise<any>, any[]>();
const mockGetUser = jest.fn<Promise<any>, any[]>();
const mockResetPasswordForEmail = jest.fn<Promise<any>, any[]>();
const mockSignInWithOtp = jest.fn<Promise<any>, any[]>();
const mockUpdateUser = jest.fn<Promise<any>, any[]>();
const mockCreateUser = jest.fn<Promise<any>, any[]>();
const mockProvision = jest.fn<Promise<any>, any[]>();

jest.mock('../lib/supabase', () => ({
  getSupabaseAuth: () => ({
    auth: {
      signInWithPassword:      (...args: any[]) => mockSignIn(...args),
      refreshSession:          (...args: any[]) => mockRefresh(...args),
      getUser:                 (...args: any[]) => mockGetUser(...args),
      resetPasswordForEmail:   (...args: any[]) => mockResetPasswordForEmail(...args),
      signInWithOtp:           (...args: any[]) => mockSignInWithOtp(...args),
      updateUser:              (...args: any[]) => mockUpdateUser(...args),
    },
  }),
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        createUser: (...args: any[]) => mockCreateUser(...args),
      },
    },
    from: () => ({
      upsert: jest.fn().mockResolvedValue({ error: null }),
    }),
  }),
}));

jest.mock('../services/onboarding.service', () => ({
  isValidBirthDate: jest.requireActual('../services/onboarding.service').isValidBirthDate,
  provisionNewUser: (...args: any[]) => mockProvision(...args),
}));

// ── Import AFTER mock ──────────────────────────────────────────────────────
import router from './auth.routes';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', router);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockRefresh.mockReset();
  });

  it('returns 400 when username is missing', async () => {
    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ password: 'secret' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/username/i);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ username: 'user@test.com' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 200 with token and refreshToken on valid credentials', async () => {
    mockSignIn.mockResolvedValue({
      data: {
        session: {
          access_token:  'mock-access-token-abc123',
          refresh_token: 'mock-refresh-token-xyz789',
        },
      },
      error: null,
    });

    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ username: 'user@test.com', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBe('mock-access-token-abc123');
    expect(res.body.refreshToken).toBe('mock-refresh-token-xyz789');
  });

  it('passes email (username field) and password to Supabase signInWithPassword', async () => {
    mockSignIn.mockResolvedValue({
      data: {
        session: { access_token: 'tok', refresh_token: 'rtok' },
      },
      error: null,
    });

    await request(makeApp())
      .post('/api/auth/login')
      .send({ username: 'test@example.com', password: 'myPass' });

    expect(mockSignIn).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'myPass',
    });
  });

  // NOTE: The login route delays the 401 response by 1 s (brute-force protection).
  // This test allows up to 3 s.
  it('returns 401 for invalid credentials (with intentional 1-s delay)', async () => {
    mockSignIn.mockResolvedValue({ data: { session: null }, error: new Error('Invalid login') });

    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ username: 'user@test.com', password: 'wrong' })
      .timeout(3000);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid credentials');
  }, 4000);

  it('returns 401 when Supabase returns null session without error', async () => {
    mockSignIn.mockResolvedValue({ data: { session: null }, error: null });

    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ username: 'user@test.com', password: 'pass' })
      .timeout(3000);

    expect(res.status).toBe(401);
  }, 4000);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/refresh', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockRefresh.mockReset();
  });

  it('returns 400 when refreshToken is missing', async () => {
    const res = await request(makeApp())
      .post('/api/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/refreshToken/i);
  });

  it('returns 200 with new token pair on valid refreshToken', async () => {
    mockRefresh.mockResolvedValue({
      data: {
        session: {
          access_token:  'new-access-token',
          refresh_token: 'new-refresh-token',
        },
      },
      error: null,
    });

    const res = await request(makeApp())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBe('new-access-token');
    expect(res.body.refreshToken).toBe('new-refresh-token');
  });

  it('passes refresh_token to Supabase refreshSession', async () => {
    mockRefresh.mockResolvedValue({
      data: { session: { access_token: 'tok', refresh_token: 'rtok' } },
      error: null,
    });

    await request(makeApp())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'my-rt' });

    expect(mockRefresh).toHaveBeenCalledWith({ refresh_token: 'my-rt' });
  });

  it('returns 401 when refreshToken is expired or invalid', async () => {
    mockRefresh.mockResolvedValue({ data: { session: null }, error: new Error('Token expired') });

    const res = await request(makeApp())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'expired-token' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when Supabase returns null session without error', async () => {
    mockRefresh.mockResolvedValue({ data: { session: null }, error: null });

    const res = await request(makeApp())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'stale-token' });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/verify
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/auth/verify', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(makeApp()).get('/api/auth/verify');
    expect(res.status).toBe(401);
  });

  it('returns 200 when token is valid', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const res = await request(makeApp())
      .get('/api/auth/verify')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/valid/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/signup
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    mockCreateUser.mockReset();
    mockProvision.mockReset();
    mockSignIn.mockReset();
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(makeApp())
      .post('/api/auth/signup')
      .send({ password: 'password1', birthDate: '1995-03-01' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for short password', async () => {
    const res = await request(makeApp())
      .post('/api/auth/signup')
      .send({ email: 'a@b.com', password: 'short', birthDate: '1995-03-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('returns 400 for invalid birthDate', async () => {
    const res = await request(makeApp())
      .post('/api/auth/signup')
      .send({ email: 'a@b.com', password: 'password1', birthDate: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/birthDate/i);
  });

  it('returns 201 with tokens on success', async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: { id: 'uid-1', email: 'hunter@test.com' } },
      error: null,
    });
    mockProvision.mockResolvedValue(undefined);
    mockSignIn.mockResolvedValue({
      data: {
        session: { access_token: 'access', refresh_token: 'refresh' },
      },
      error: null,
    });

    const res = await request(makeApp())
      .post('/api/auth/signup')
      .send({
        email: 'Hunter@Test.com',
        password: 'password1',
        birthDate: '1995-03-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBe('access');
    expect(mockProvision).toHaveBeenCalledWith({
      userId: 'uid-1',
      email: 'hunter@test.com',
      birthDate: '1995-03-01',
    });
  });
});
