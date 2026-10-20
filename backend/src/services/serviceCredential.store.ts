import { createHash, randomBytes, randomUUID } from 'crypto';
import { getSupabaseAdmin } from '../lib/supabase';

export interface ServiceCredentialRecord {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface ServiceCredentialStore {
  insert(row: ServiceCredentialRecord): Promise<ServiceCredentialRecord>;
  listByUser(userId: string): Promise<ServiceCredentialRecord[]>;
  revoke(userId: string, id: string): Promise<ServiceCredentialRecord | null>;
  findActiveByHash(tokenHash: string): Promise<ServiceCredentialRecord | null>;
  touchLastUsed(id: string, whenIso: string): Promise<void>;
}

export function hashServiceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function mintServiceToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `sys_${randomBytes(32).toString('hex')}`;
  return { token, tokenHash: hashServiceToken(token), tokenPrefix: token.slice(0, 12) };
}

export class MemoryServiceCredentialStore implements ServiceCredentialStore {
  private rows: ServiceCredentialRecord[] = [];

  async insert(row: ServiceCredentialRecord): Promise<ServiceCredentialRecord> {
    this.rows.push({ ...row, scopes: [...row.scopes] });
    return { ...row, scopes: [...row.scopes] };
  }

  async listByUser(userId: string): Promise<ServiceCredentialRecord[]> {
    return this.rows.filter(r => r.userId === userId).map(r => ({ ...r, scopes: [...r.scopes] }));
  }

  async revoke(userId: string, id: string): Promise<ServiceCredentialRecord | null> {
    const row = this.rows.find(r => r.userId === userId && r.id === id);
    if (!row) return null;
    if (!row.revokedAt) row.revokedAt = new Date().toISOString();
    return { ...row, scopes: [...row.scopes] };
  }

  async findActiveByHash(tokenHash: string): Promise<ServiceCredentialRecord | null> {
    const row = this.rows.find(r => r.tokenHash === tokenHash && !r.revokedAt);
    return row ? { ...row, scopes: [...row.scopes] } : null;
  }

  async touchLastUsed(id: string, whenIso: string): Promise<void> {
    const row = this.rows.find(r => r.id === id);
    if (row) row.lastUsedAt = whenIso;
  }
}

function fromRow(row: Record<string, unknown>): ServiceCredentialRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    tokenHash: String(row.token_hash),
    tokenPrefix: String(row.token_prefix),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    createdAt: new Date(String(row.created_at)).toISOString(),
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : null,
  };
}

export class SupabaseServiceCredentialStore implements ServiceCredentialStore {
  async insert(row: ServiceCredentialRecord): Promise<ServiceCredentialRecord> {
    const { data, error } = await getSupabaseAdmin()
      .from('service_credentials')
      .insert({
        id: row.id,
        user_id: row.userId,
        name: row.name,
        token_hash: row.tokenHash,
        token_prefix: row.tokenPrefix,
        scopes: row.scopes,
        created_at: row.createdAt,
        revoked_at: row.revokedAt,
        last_used_at: row.lastUsedAt,
      })
      .select('*')
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async listByUser(userId: string): Promise<ServiceCredentialRecord[]> {
    const { data, error } = await getSupabaseAdmin()
      .from('service_credentials')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(row => fromRow(row));
  }

  async revoke(userId: string, id: string): Promise<ServiceCredentialRecord | null> {
    const existing = await getSupabaseAdmin()
      .from('service_credentials')
      .select('*')
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return null;
    if (existing.data.revoked_at) return fromRow(existing.data);
    const { data, error } = await getSupabaseAdmin()
      .from('service_credentials')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async findActiveByHash(tokenHash: string): Promise<ServiceCredentialRecord | null> {
    const { data, error } = await getSupabaseAdmin()
      .from('service_credentials')
      .select('*')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) throw error;
    return data ? fromRow(data) : null;
  }

  async touchLastUsed(id: string, whenIso: string): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from('service_credentials')
      .update({ last_used_at: whenIso })
      .eq('id', id);
    if (error) throw error;
  }
}

let store: ServiceCredentialStore | null = null;

export function getServiceCredentialStore(): ServiceCredentialStore {
  if (!store) store = new SupabaseServiceCredentialStore();
  return store;
}

export function setServiceCredentialStore(next: ServiceCredentialStore | null): void {
  store = next;
}

export function newCredentialId(): string {
  return randomUUID();
}
