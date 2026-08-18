import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getSupabaseAdmin } from '../lib/supabase';
import { TodoistService } from './todoist.service';

export const TODOIST_SERVICE = 'todoist';
export const API_KEY_MIN_LEN = 20;
export const API_KEY_MAX_LEN = 128;
export const CONNECT_WINDOW_MS = 15 * 60 * 1000;
export const CONNECT_MAX_PER_WINDOW = 10;

const connectHits = new Map<string, number[]>();

export function resetTodoistConnectRateLimitForTests(): void {
  connectHits.clear();
}

function encryptionKey(): Buffer {
  const raw =
    process.env.INTEGRATIONS_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'dev-integrations-key';
  return createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(packed: string): string {
  const parts = packed.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('unsupported secret version');
  }
  const [, ivH, tagH, dataH] = parts;
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataH, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskSecret(plain: string): string {
  if (!plain) return '****';
  const last = plain.slice(-4);
  return `****${last}`;
}

export function validateApiKey(apiKey: unknown): string | null {
  if (typeof apiKey !== 'string') return null;
  const trimmed = apiKey.trim();
  if (trimmed.length < API_KEY_MIN_LEN || trimmed.length > API_KEY_MAX_LEN) return null;
  return trimmed;
}

export function assertConnectRateLimit(userId: string): boolean {
  const now = Date.now();
  const recent = (connectHits.get(userId) ?? []).filter((t) => now - t < CONNECT_WINDOW_MS);
  if (recent.length >= CONNECT_MAX_PER_WINDOW) {
    connectHits.set(userId, recent);
    return false;
  }
  recent.push(now);
  connectHits.set(userId, recent);
  return true;
}

async function isOwnerUser(userId: string): Promise<boolean> {
  if (process.env.OWNER_USER_ID && process.env.OWNER_USER_ID === userId) return true;
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) return false;
  try {
    const { data } = await getSupabaseAdmin().auth.admin.getUserById(userId);
    return (data.user?.email ?? '').toLowerCase() === ownerEmail;
  } catch {
    return false;
  }
}

interface IntegrationRow {
  encrypted_value: string;
  status: string;
}

export async function getTodoistRow(userId: string): Promise<IntegrationRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('user_integrations')
    .select('encrypted_value, status')
    .eq('user_id', userId)
    .eq('service', TODOIST_SERVICE)
    .maybeSingle();
  if (error || !data) return null;
  return data as IntegrationRow;
}

export async function resolveTodoistToken(userId: string): Promise<string | null> {
  const row = await getTodoistRow(userId);
  if (row?.status === 'connected' && row.encrypted_value) {
    return decryptSecret(row.encrypted_value);
  }
  const envToken = process.env.TODOIST_API_TOKEN?.trim();
  if (envToken && (await isOwnerUser(userId))) {
    return envToken;
  }
  return null;
}

export async function getTodoistConnectionStatus(userId: string): Promise<{
  connected: boolean;
  source: 'user' | 'env' | null;
  masked: string | null;
}> {
  const row = await getTodoistRow(userId);
  if (row?.status === 'connected' && row.encrypted_value) {
    const plain = decryptSecret(row.encrypted_value);
    return { connected: true, source: 'user', masked: maskSecret(plain) };
  }
  const envToken = process.env.TODOIST_API_TOKEN?.trim();
  if (envToken && (await isOwnerUser(userId))) {
    return { connected: true, source: 'env', masked: maskSecret(envToken) };
  }
  return { connected: false, source: null, masked: null };
}

export async function saveTodoistApiKey(userId: string, apiKey: string): Promise<void> {
  const packed = encryptSecret(apiKey);
  const { error } = await getSupabaseAdmin().from('user_integrations').upsert(
    {
      user_id: userId,
      service: TODOIST_SERVICE,
      credential_type: 'api_key',
      encrypted_value: packed,
      connected_at: new Date().toISOString(),
      status: 'connected',
    },
    { onConflict: 'user_id,service' }
  );
  if (error) throw new Error(error.message);
}

export async function deleteTodoistApiKey(userId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('user_integrations')
    .delete()
    .eq('user_id', userId)
    .eq('service', TODOIST_SERVICE);
  if (error) throw new Error(error.message);
}

export async function getTodoistServiceForUser(userId: string): Promise<TodoistService | null> {
  const token = await resolveTodoistToken(userId);
  if (!token) return null;
  return new TodoistService(token);
}
