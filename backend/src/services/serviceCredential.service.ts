import { SystemQuestError } from '../domain/systemQuest';
import {
  getServiceCredentialStore,
  mintServiceToken,
  newCredentialId,
  ServiceCredentialRecord,
} from './serviceCredential.store';

export interface PublicServiceCredential {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

function present(row: ServiceCredentialRecord): PublicServiceCredential {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export async function createServiceCredential(
  userId: string,
  body: { name?: string; scopes?: string[] },
): Promise<{ credential: PublicServiceCredential; token: string }> {
  const scopes = body.scopes ?? ['system'];
  if (!Array.isArray(scopes) || scopes.length !== 1 || scopes[0] !== 'system') {
    throw new SystemQuestError('invalid_scope', 'The only supported scope is system', 400);
  }
  const name = (body.name ?? 'Grok Bot').trim().slice(0, 80);
  if (!name) throw new SystemQuestError('invalid_credential', 'name is required', 400);

  const minted = mintServiceToken();
  const row: ServiceCredentialRecord = {
    id: newCredentialId(),
    userId,
    name,
    tokenHash: minted.tokenHash,
    tokenPrefix: minted.tokenPrefix,
    scopes: ['system'],
    createdAt: new Date().toISOString(),
    revokedAt: null,
    lastUsedAt: null,
  };
  const saved = await getServiceCredentialStore().insert(row);
  return { credential: present(saved), token: minted.token };
}

export async function listServiceCredentials(userId: string): Promise<PublicServiceCredential[]> {
  const rows = await getServiceCredentialStore().listByUser(userId);
  return rows.map(present);
}

export async function revokeServiceCredential(userId: string, id: string): Promise<PublicServiceCredential> {
  const row = await getServiceCredentialStore().revoke(userId, id);
  if (!row) throw new SystemQuestError('not_found', 'Credential not found', 404);
  return present(row);
}
