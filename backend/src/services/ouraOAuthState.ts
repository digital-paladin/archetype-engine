import { createHmac, randomBytes, timingSafeEqual, createHash } from 'crypto';
import { OuraError } from './ouraErrors';

export const OURA_STATE_TTL_MS = 10 * 60 * 1000;

const usedNonces = new Map<string, number>();

export class OuraStateError extends Error {
  constructor(readonly reason: 'malformed' | 'signature' | 'expired' | 'replay' | 'user') {
    super('invalid oura oauth state');
    this.name = 'OuraStateError';
  }
}

export function resetOuraOAuthStateForTests(): void {
  usedNonces.clear();
}

function stateKey(): Buffer {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!raw) {
    throw new OuraError(
      'Set INTEGRATIONS_ENCRYPTION_KEY before connecting Oura.',
      503,
      'not_configured',
    );
  }
  return createHash('sha256').update(`oura-oauth-state:v1:${raw}`).digest();
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(value: string): Buffer {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function acceptableUserId(userId: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(userId);
}

export function signOuraState(userId: string, now = Date.now()): string {
  if (!acceptableUserId(userId)) {
    throw new OuraStateError('user');
  }
  const payload = b64url(Buffer.from(JSON.stringify({
    v: 1,
    u: userId,
    e: now + OURA_STATE_TTL_MS,
    n: randomBytes(16).toString('hex'),
  })));
  const sig = b64url(createHmac('sha256', stateKey()).update(payload).digest());
  return `v1.${payload}.${sig}`;
}

export function verifyOuraState(state: string, now = Date.now()): { userId: string } {
  const parts = state.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new OuraStateError('malformed');
  const [, payload, sig] = parts;
  const expected = b64url(createHmac('sha256', stateKey()).update(payload).digest());
  const got = Buffer.from(sig);
  const exp = Buffer.from(expected);
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) {
    throw new OuraStateError('signature');
  }
  let parsed: { v?: number; u?: unknown; e?: unknown; n?: unknown };
  try {
    parsed = JSON.parse(b64urlDecode(payload).toString('utf8'));
  } catch {
    throw new OuraStateError('malformed');
  }
  if (parsed.v !== 1 || typeof parsed.u !== 'string' || !acceptableUserId(parsed.u)) {
    throw new OuraStateError('user');
  }
  if (typeof parsed.e !== 'number' || parsed.e < now) throw new OuraStateError('expired');
  if (typeof parsed.n !== 'string' || parsed.n.length < 16) throw new OuraStateError('malformed');
  pruneNonces(now);
  if (usedNonces.has(parsed.n)) throw new OuraStateError('replay');
  usedNonces.set(parsed.n, parsed.e);
  return { userId: parsed.u };
}

function pruneNonces(now: number): void {
  for (const [nonce, exp] of usedNonces) {
    if (exp < now) usedNonces.delete(nonce);
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only an http(s) frontend origin is turned into a link. */
export function safeFrontendUrl(): string {
  const raw = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || '').trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(raw)) return '/';
  return raw.replace(/\/$/, '');
}
