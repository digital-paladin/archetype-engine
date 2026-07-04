import { Request, Response, NextFunction } from 'express';
import { getSupabaseAuth, getSupabaseAdmin } from '../lib/supabase';

/**
 * JWT authentication middleware backed by Supabase Auth.
 * Accepts two credential types:
 *   1. Supabase access token (JWT) — standard short-lived login token
 *   2. Static API key (UUID) — long-lived key stored in character_profile.rpg_stats.api_key
 *      Use GET /api/auth/api-key to generate. Intended for OpenClaw / Telegram / scripts.
 * Validates the credential and attaches req.userId on success.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth for login endpoint
  if (req.path === '/api/auth/login') {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'Authorization header missing' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  // 1. Try Supabase JWT first (most common path)
  const { data, error } = await getSupabaseAuth().auth.getUser(token);

  if (!error && data.user) {
    (req as any).userId = data.user.id;
    return next();
  }

  // 2. Fallback: check static API key stored in character_profile.rpg_stats
  try {
    const sb = getSupabaseAdmin();
    const { data: profiles } = await sb
      .from('character_profiles')
      .select('user_id, rpg_stats')
      .neq('rpg_stats', null);

    if (profiles) {
      const match = profiles.find((p: any) => p.rpg_stats?.api_key === token);
      if (match) {
        (req as any).userId = match.user_id;
        return next();
      }
    }
  } catch (_err) {
    // DB lookup failed — fall through to reject
  }

  return res.status(401).json({ success: false, error: 'Invalid or expired token' });
}
