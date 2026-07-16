import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAuth, getSupabaseAdmin } from '../lib/supabase';
import { authMiddleware } from '../middleware/auth.middleware';
import { getDataService } from '../services/data/dataService';
import { isValidBirthDate, provisionNewUser, resolveSignupIdentity } from '../services/onboarding.service';
import {
  CLASS_TEMPLATES,
  LIFE_DOMAINS,
  normalizeDomains,
  suggestClassTemplate,
} from '../services/classTemplates';
import {
  checkDemoRateLimit,
  getConfiguredDemoUserId,
  issueDemoSession,
} from '../services/demo.service';

const router = Router();

/** Frontend URL used in Supabase email redirect links (must match Supabase URL Configuration). */
function getAuthCallbackUrl(): string {
  const base = (
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN?.split(',')[0]?.trim() ||
    'http://localhost:4200'
  ).replace(/\/$/, '');
  return `${base}/auth/callback`;
}

function getSupabaseClientForToken(accessToken: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY not set in environment');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * GET /api/auth/onboarding-options
 * Public catalog for signup step 2 (domains + class templates).
 */
router.get('/onboarding-options', (_req: Request, res: Response) => {
  res.json({
    success: true,
    domains: [...LIFE_DOMAINS],
    templates: CLASS_TEMPLATES,
    rules: { minDomains: 3, maxDomains: 5 },
  });
});

/**
 * POST /api/auth/suggest-class
 * Body: { domains: string[] } → suggested template (deterministic).
 */
router.post('/suggest-class', (req: Request, res: Response) => {
  const domains = normalizeDomains(req.body?.domains);
  if (domains.length < 3 || domains.length > 5) {
    return res.status(400).json({ success: false, error: 'select 3 to 5 life domains' });
  }
  const template = suggestClassTemplate(domains);
  return res.json({ success: true, template, domains });
});

/**
 * POST /api/auth/signup
 * Thin SaaS onboarding + optional identity scaffold (domains → class template).
 * Body: { email, password, birthDate, domains?: string[], classDisplayName?: string }
 */
router.post('/signup', async (req: Request, res: Response) => {
  const { email, password, birthDate } = req.body ?? {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, error: 'email required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ success: false, error: 'password must be at least 8 characters' });
  }
  if (!birthDate || typeof birthDate !== 'string' || !isValidBirthDate(birthDate)) {
    return res.status(400).json({
      success: false,
      error: 'birthDate required as YYYY-MM-DD (not in the future)',
    });
  }

  const identityResult = resolveSignupIdentity(req.body ?? {});
  if (!identityResult.ok) {
    return res.status(400).json({ success: false, error: identityResult.error });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        birth_date: birthDate,
        ...(identityResult.identity
          ? {
              life_domains: identityResult.identity.lifeDomains,
              class_template: identityResult.identity.classTemplate.id,
              class_display_name: identityResult.identity.classDisplayName,
            }
          : {}),
      },
    });

    if (createErr || !created.user) {
      const msg = createErr?.message || 'Could not create account';
      const status = /already|registered|exists/i.test(msg) ? 409 : 400;
      return res.status(status).json({ success: false, error: msg });
    }

    await provisionNewUser({
      userId: created.user.id,
      email: created.user.email || email.trim().toLowerCase(),
      birthDate,
      identity: identityResult.identity,
    });

    const { data: sessionData, error: signInErr } = await getSupabaseAuth().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInErr || !sessionData.session) {
      return res.status(201).json({
        success: true,
        needsLogin: true,
        message: 'Account created — please log in.',
        identity: identityResult.identity,
      });
    }

    return res.status(201).json({
      success: true,
      token: sessionData.session.access_token,
      refreshToken: sessionData.session.refresh_token,
      message: 'Account created',
      identity: identityResult.identity,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Signup failed',
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticates via Supabase Auth (email + password).
 * The 'username' field is treated as the Supabase email.
 * Returns the Supabase access token (JWT) on success.
 */
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'username and password required' });
  }

  const { data, error } = await getSupabaseAuth().auth.signInWithPassword({
    email: username,
    password,
  });

  if (error || !data.session) {
    // Intentional delay on failure (prevent brute force)
    return setTimeout(() => {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
    }, 1000);
  }

  return res.json({
    success: true,
    token:        data.session.access_token,
    refreshToken: data.session.refresh_token,
    message: 'Login successful',
  });
});

/**
 * POST /api/auth/demo-login
 * Public Try Demo — issues a session for DEMO_USER_ID (dedicated Auth user).
 * Resets/reseeds fake Hunter data on each call. No shared password in the client.
 */
router.post('/demo-login', async (req: Request, res: Response) => {
  const demoUserId = getConfiguredDemoUserId();
  if (!demoUserId) {
    return res.status(503).json({
      success: false,
      error: 'Demo is not configured (DEMO_USER_ID unset)',
    });
  }

  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : null) ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown';

  if (!checkDemoRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      error: 'Too many demo logins from this network — try again later',
    });
  }

  try {
    const session = await issueDemoSession(demoUserId);
    return res.json({
      success: true,
      token: session.accessToken,
      refreshToken: session.refreshToken,
      message: 'Demo session ready',
      demo: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Demo login failed';
    const status = /not found|not equal OWNER/i.test(msg) ? 503 : 500;
    return res.status(status).json({ success: false, error: msg });
  }
});

/**
 * POST /api/auth/refresh
 * Exchanges a Supabase refresh_token for a new access_token + refresh_token pair.
 * No authMiddleware required — the refresh_token IS the credential here.
 */
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ success: false, error: 'refreshToken required' });
  }

  const { data, error } = await getSupabaseAuth().auth.refreshSession({ refresh_token: refreshToken });

  if (error || !data.session) {
    return res.status(401).json({ success: false, error: 'Token refresh failed' });
  }

  return res.json({
    success: true,
    token:        data.session.access_token,
    refreshToken: data.session.refresh_token,
  });
});

/**
 * POST /api/auth/forgot-password
 * Sends a Supabase password-recovery email. Redirect lands on /auth/callback.
 */
router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'email required' });
  }

  const { error } = await getSupabaseAuth().auth.resetPasswordForEmail(email, {
    redirectTo: getAuthCallbackUrl(),
  });

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  // Generic success — do not reveal whether the email exists
  return res.json({
    success: true,
    message: 'If an account exists for that email, a reset link has been sent.',
  });
});

/**
 * POST /api/auth/magic-link
 * Sends a passwordless sign-in link via Supabase OTP email.
 */
router.post('/magic-link', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'email required' });
  }

  const { error } = await getSupabaseAuth().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: getAuthCallbackUrl() },
  });

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  return res.json({
    success: true,
    message: 'If an account exists for that email, a sign-in link has been sent.',
  });
});

/**
 * POST /api/auth/update-password
 * Sets a new password using the recovery (or active) session access token.
 */
router.post('/update-password', async (req: Request, res: Response) => {
  const { password } = req.body;
  const authHeader = req.headers.authorization;

  if (!password || password.length < 8) {
    return res.status(400).json({ success: false, error: 'password must be at least 8 characters' });
  }
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'Authorization header missing' });
  }

  const accessToken = authHeader.replace('Bearer ', '').trim();
  const client = getSupabaseClientForToken(accessToken);
  const { error } = await client.auth.updateUser({ password });

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  return res.json({ success: true, message: 'Password updated successfully' });
});

/**
 * GET /api/auth/verify
 * Token already validated by authMiddleware before reaching here.
 */
router.get('/verify', authMiddleware, (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Token valid' });
});

/**
 * GET /api/auth/api-key
 * Returns the user's static API key for use with OpenClaw / Telegram / scripts.
 * Generates and stores a new UUID key if one does not yet exist.
 * The key is stored in character_profile.rpg_stats.api_key (never expires).
 * Use: Authorization: Bearer <api-key> on any protected endpoint.
 */
router.get('/api-key', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const db = getDataService();

    const profile = await db.getCharacterProfile(userId);
    const existingKey = (profile?.rpg_stats as any)?.api_key as string | undefined;

    if (existingKey) {
      return res.json({ success: true, apiKey: existingKey, generated: false });
    }

    const newKey = randomUUID();
    const updatedStats = { ...(profile?.rpg_stats ?? {}), api_key: newKey };
    await db.upsertCharacterProfile(userId, { rpg_stats: updatedStats });

    return res.json({ success: true, apiKey: newKey, generated: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
