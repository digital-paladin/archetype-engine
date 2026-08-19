import { Router, Request, Response } from 'express';
import { GoogleHealthService } from '../services/googleHealth.service';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
const googleHealth = new GoogleHealthService();

/**
 * GET /api/google-health/connect-url — PROTECTED
 * Returns Google OAuth authorize URL with state=userId for SPA redirect.
 */
router.get('/connect-url', authMiddleware, (req: Request, res: Response) => {
  try {
    if (!googleHealth.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Google Health not configured. Set GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET.',
      });
    }
    const userId = (req as any).userId as string;
    const url = googleHealth.getAuthUrl(userId);
    return res.json({ success: true, url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Auth setup failed';
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/google-health/callback — UNPROTECTED OAuth redirect from Google.
 * state must be the connecting user's UUID (from connect-url).
 * Never add authMiddleware here — OAuth redirects cannot send a JWT.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, error, state } = req.query;

  if (error) {
    return res.status(400).send(`<h1>❌ Google Health Auth Denied</h1><p>${error}</p>`);
  }
  if (!code || typeof code !== 'string') {
    return res.status(400).send('<h1>❌ No authorization code received</h1>');
  }
  const userId = typeof state === 'string' && state.length > 0
    ? state
    : (process.env.OWNER_USER_ID || '');
  if (!userId) {
    return res.status(400).send('<h1>❌ Missing OAuth state (user id)</h1>');
  }

  try {
    await googleHealth.exchangeCode(code, userId);
    const frontend = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || '/')
      .replace(/\/$/, '');
    res.send(`
      <h1>✅ Fitbit / Pixel Watch connected (Google Health)</h1>
      <p>Sleep will sync to your journal. Legacy Fitbit Web API tokens are no longer used for this account.</p>
      <p><a href="${frontend}">Return to dashboard</a></p>
      <style>body { font-family: sans-serif; padding: 2rem; background: #1a1a2e; color: #e0d5f5; }
      a { color: #c9a84c; }</style>
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[GOOGLE-HEALTH] Code exchange failed: ${msg}`);
    res.status(500).send(`<h1>❌ Auth Failed</h1><p>${msg}</p>`);
  }
});

router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const connected = await googleHealth.hasTokens(userId);
  res.json({
    success: true,
    provider: 'google',
    configured: googleHealth.isConfigured(),
    connected,
  });
});

export default router;
