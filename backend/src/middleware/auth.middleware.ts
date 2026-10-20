import { Request, Response, NextFunction } from 'express';
import { getSupabaseAuth, getSupabaseAdmin } from '../lib/supabase';
import { getServiceCredentialStore, hashServiceToken } from '../services/serviceCredential.store';

export type AuthKind = 'user' | 'service';

export interface ResolvedAuth {
  userId: string;
  authKind: AuthKind;
  serviceScopes?: string[];
  credentialId?: string;
}

/**
 * Resolve a bearer credential:
 *   1. Supabase access token (short-lived login)
 *   2. System service credential (`sys_…`) — scope `system` only
 *   3. Personal API key stored on character_profile.rpg_stats.api_key
 */
export async function resolveCredential(token: string): Promise<ResolvedAuth | null> {
  const { data, error } = await getSupabaseAuth().auth.getUser(token);
  if (!error && data.user) {
    return { userId: data.user.id, authKind: 'user' };
  }

  if (token.startsWith('sys_')) {
    try {
      const hit = await getServiceCredentialStore().findActiveByHash(hashServiceToken(token));
      if (!hit || !hit.scopes.includes('system')) return null;
      void getServiceCredentialStore().touchLastUsed(hit.id, new Date().toISOString()).catch(() => undefined);
      return {
        userId: hit.userId,
        authKind: 'service',
        serviceScopes: hit.scopes,
        credentialId: hit.id,
      };
    } catch {
      return null;
    }
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: profiles } = await sb
      .from('character_profiles')
      .select('user_id, rpg_stats')
      .neq('rpg_stats', null);

    if (profiles) {
      const match = profiles.find((p: { user_id: string; rpg_stats?: { api_key?: string } }) => p.rpg_stats?.api_key === token);
      if (match) return { userId: match.user_id, authKind: 'user' };
    }
  } catch {
    // DB lookup failed — fall through to reject
  }

  return null;
}

/** Service credentials may only call /api/system. Player sessions are unrestricted. */
export function isServicePathAllowed(req: Request): boolean {
  const authKind = (req as Request & { authKind?: AuthKind }).authKind;
  if (authKind !== 'service') return true;
  const path = (req.originalUrl || req.url || '').split('?')[0];
  return path === '/api/system' || path.startsWith('/api/system/');
}

/**
 * JWT authentication middleware backed by Supabase Auth.
 * Accepts three credential types:
 *   1. Supabase access token (JWT) — standard short-lived login token
 *   2. System service credential (`sys_…`) — scoped to /api/system, revocable
 *   3. Static API key (UUID) — long-lived key stored in character_profile.rpg_stats.api_key
 *      Use GET /api/auth/api-key to generate. Intended for OpenClaw / Telegram / scripts.
 * Validates the credential and attaches req.userId on success.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth for login endpoint
  if (req.path === '/api/auth/login' || req.originalUrl.split('?')[0] === '/api/auth/login') {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'Authorization header missing' });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const auth = await resolveCredential(token);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }

  (req as Request & { userId?: string; authKind?: AuthKind; serviceScopes?: string[] }).userId = auth.userId;
  (req as Request & { authKind?: AuthKind }).authKind = auth.authKind;
  (req as Request & { serviceScopes?: string[] }).serviceScopes = auth.serviceScopes ?? [];

  if (!isServicePathAllowed(req)) {
    return res.status(403).json({
      success: false,
      error: 'service_key_scope',
      message: 'This credential can only access System endpoints',
    });
  }

  return next();
}
