import {
  API_KEY_MAX_LEN,
  assertConnectRateLimit,
  decryptSecret,
  encryptSecret,
  maskSecret,
  resetTodoistConnectRateLimitForTests,
  resolveTodoistToken,
  validateApiKey,
} from './todoistToken.service';

jest.mock('../lib/supabase', () => {
  const maybeSingle = jest.fn();
  const upsert = jest.fn();
  const del = jest.fn();
  const getUserById = jest.fn();
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle,
    upsert,
    delete: () => chain,
  };
  return {
    __mock: { maybeSingle, upsert, del, getUserById, chain },
    getSupabaseAdmin: () => ({
      from: () => chain,
      auth: { admin: { getUserById } },
    }),
  };
});

const supabaseMock = jest.requireMock('../lib/supabase') as {
  __mock: {
    maybeSingle: jest.Mock;
    upsert: jest.Mock;
    getUserById: jest.Mock;
  };
};

describe('todoistToken.service', () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    resetTodoistConnectRateLimitForTests();
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'test-integrations-key';
    delete process.env.TODOIST_API_TOKEN;
    delete process.env.OWNER_USER_ID;
    delete process.env.OWNER_EMAIL;
    supabaseMock.__mock.maybeSingle.mockReset();
    supabaseMock.__mock.upsert.mockReset();
    supabaseMock.__mock.getUserById.mockReset();
  });

  afterAll(() => {
    process.env = prevEnv;
  });

  it('round-trips AES-256-GCM secrets', () => {
    const packed = encryptSecret('todoist-token-abcdefghijklmnopqrstuvwxyz');
    expect(packed.startsWith('v1:')).toBe(true);
    expect(packed).not.toContain('todoist-token');
    expect(decryptSecret(packed)).toBe('todoist-token-abcdefghijklmnopqrstuvwxyz');
  });

  it('masks all but last 4 characters', () => {
    expect(maskSecret('abcdefghijklmnopqrstuvwxyz1234')).toBe('****1234');
  });

  it('rejects empty and oversized API keys', () => {
    expect(validateApiKey('')).toBeNull();
    expect(validateApiKey('   ')).toBeNull();
    expect(validateApiKey('short')).toBeNull();
    expect(validateApiKey('x'.repeat(API_KEY_MAX_LEN + 1))).toBeNull();
    expect(validateApiKey('a'.repeat(40))).toBe('a'.repeat(40));
  });

  it('rate-limits connect attempts per user', () => {
    for (let i = 0; i < 10; i++) {
      expect(assertConnectRateLimit('user-1')).toBe(true);
    }
    expect(assertConnectRateLimit('user-1')).toBe(false);
    expect(assertConnectRateLimit('user-2')).toBe(true);
  });

  it('resolveTodoistToken prefers the per-user row over env', async () => {
    const plain = 'user-token-abcdefghijklmnopqrstuv';
    supabaseMock.__mock.maybeSingle.mockResolvedValue({
      data: { encrypted_value: encryptSecret(plain), status: 'connected' },
      error: null,
    });
    process.env.TODOIST_API_TOKEN = 'env-token-abcdefghijklmnopqrstuvwx';
    process.env.OWNER_USER_ID = 'owner';
    expect(await resolveTodoistToken('someone')).toBe(plain);
  });

  it('falls back to env token only for the owner', async () => {
    supabaseMock.__mock.maybeSingle.mockResolvedValue({ data: null, error: null });
    process.env.TODOIST_API_TOKEN = 'env-token-abcdefghijklmnopqrstuvwx';
    process.env.OWNER_USER_ID = 'owner-id';
    expect(await resolveTodoistToken('owner-id')).toBe('env-token-abcdefghijklmnopqrstuvwx');
    expect(await resolveTodoistToken('other-user')).toBeNull();
  });
});
