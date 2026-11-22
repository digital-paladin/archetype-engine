import { Request, Response } from 'express';
import { authMiddleware, resolveCredential } from './auth.middleware';
import {
  MemoryServiceCredentialStore,
  mintServiceToken,
  newCredentialId,
  setServiceCredentialStore,
} from '../services/serviceCredential.store';

const mockGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock('../lib/supabase', () => ({
  getSupabaseAuth: () => ({
    auth: { getUser: (token: string) => mockGetUser(token) },
  }),
  getSupabaseAdmin: () => ({
    from: (table: string) => mockFrom(table),
  }),
}));

const API_KEY = '11111111-2222-4333-8444-555555555555';

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function queueProfileResult(result: { data: { user_id: string }[] | null }) {
  const limit = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ limit });
  const select = jest.fn().mockReturnValue({ eq });
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'character_profile') {
      throw new Error(`unexpected table ${table}`);
    }
    return { select };
  });
  return { select, eq, limit };
}

describe('resolveCredential personal API key', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
    setServiceCredentialStore(new MemoryServiceCredentialStore());
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
  });

  afterEach(() => {
    setServiceCredentialStore(null);
  });

  it('queries character_profile with a server-side rpg_stats->>api_key filter', async () => {
    const { select, eq, limit } = queueProfileResult({ data: [{ user_id: 'user-42' }] });

    const auth = await resolveCredential(API_KEY);

    expect(auth).toEqual({ userId: 'user-42', authKind: 'user' });
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('character_profile');
    expect(select).toHaveBeenCalledWith('user_id');
    expect(eq).toHaveBeenCalledWith('rpg_stats->>api_key', API_KEY);
    expect(limit).toHaveBeenCalledWith(1);
  });

  it('returns null when the JSON filter matches no row', async () => {
    queueProfileResult({ data: [] });

    await expect(resolveCredential(API_KEY)).resolves.toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('character_profile');
  });

  it('returns null when the profile lookup throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('db down');
    });

    await expect(resolveCredential(API_KEY)).resolves.toBeNull();
  });

  it('does not scan character profiles for a Supabase session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'session-user' } }, error: null });

    const auth = await resolveCredential('supabase-access-token');

    expect(auth).toEqual({ userId: 'session-user', authKind: 'user' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('keeps sys_ credentials off the character_profile lookup', async () => {
    const store = new MemoryServiceCredentialStore();
    setServiceCredentialStore(store);
    const minted = mintServiceToken();
    const credentialId = newCredentialId();
    await store.insert({
      id: credentialId,
      userId: 'owner-1',
      name: 'bot',
      tokenHash: minted.tokenHash,
      tokenPrefix: minted.tokenPrefix,
      scopes: ['system'],
      createdAt: '2026-11-22T00:00:00.000Z',
      revokedAt: null,
      lastUsedAt: null,
    });

    const auth = await resolveCredential(minted.token);

    expect(auth).toEqual({
      userId: 'owner-1',
      authKind: 'service',
      serviceScopes: ['system'],
      credentialId,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('authMiddleware personal API key', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
    setServiceCredentialStore(new MemoryServiceCredentialStore());
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
  });

  afterEach(() => {
    setServiceCredentialStore(null);
  });

  it('attaches the profile user and leaves service scope empty', async () => {
    const { eq } = queueProfileResult({ data: [{ user_id: 'user-42' }] });
    const req = {
      path: '/api/character',
      originalUrl: '/api/character',
      headers: { authorization: `Bearer ${API_KEY}` },
    } as Request & { userId?: string; authKind?: string; serviceScopes?: string[] };
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.userId).toBe('user-42');
    expect(req.authKind).toBe('user');
    expect(req.serviceScopes).toEqual([]);
    expect(eq).toHaveBeenCalledWith('rpg_stats->>api_key', API_KEY);
  });
});
