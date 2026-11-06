import { OuraError } from './ouraErrors';
import {
  OURA_STATE_TTL_MS,
  OuraStateError,
  resetOuraOAuthStateForTests,
  signOuraState,
  verifyOuraState,
  escapeHtml,
  safeFrontendUrl,
} from './ouraOAuthState';

describe('Oura OAuth state', () => {
  const previousKey = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousFrontend = process.env.FRONTEND_URL;

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'oura-state-test-key';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetOuraOAuthStateForTests();
  });

  afterAll(() => {
    restore('INTEGRATIONS_ENCRYPTION_KEY', previousKey);
    restore('SUPABASE_SERVICE_ROLE_KEY', previousService);
    restore('FRONTEND_URL', previousFrontend);
  });

  it('round-trips the signed-in user and is not the raw user id', () => {
    const state = signOuraState('user-1');
    expect(state.startsWith('v1.')).toBe(true);
    expect(state).not.toBe('user-1');
    expect(verifyOuraState(state).userId).toBe('user-1');
  });

  it('rejects a raw user id, a tampered payload, and a replay', () => {
    expect(() => verifyOuraState('user-1')).toThrow(OuraStateError);
    const state = signOuraState('user-1');
    const [prefix, payload, sig] = state.split('.');
    expect(() => verifyOuraState(`${prefix}.${payload}.${sig.slice(0, -2)}aa`)).toThrow(OuraStateError);
    expect(verifyOuraState(state).userId).toBe('user-1');
    expect(() => verifyOuraState(state)).toThrow(OuraStateError);
    try {
      verifyOuraState(state);
    } catch (err) {
      expect(err).toBeInstanceOf(OuraStateError);
      expect((err as OuraStateError).reason).toBe('replay');
    }
  });

  it('rejects an expired state', () => {
    const state = signOuraState('user-1', 1_000);
    expect(() => verifyOuraState(state, 1_000 + OURA_STATE_TTL_MS + 1)).toThrow(OuraStateError);
  });

  it('refuses to sign when no encryption key is configured', () => {
    delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => signOuraState('user-1')).toThrow(OuraError);
    try {
      signOuraState('user-1');
    } catch (err) {
      expect((err as OuraError).safeMessage).toMatch(/INTEGRATIONS_ENCRYPTION_KEY/);
      expect((err as OuraError).safeMessage).not.toContain('oura-state-test-key');
    }
  });

  it('escapes callback text and only links an http(s) frontend', () => {
    expect(escapeHtml(`<script>alert(1)</script>`)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    process.env.FRONTEND_URL = 'https://app.example.test/dashboard';
    expect(safeFrontendUrl()).toBe('https://app.example.test/dashboard');
    process.env.FRONTEND_URL = 'javascript:alert(1)';
    expect(safeFrontendUrl()).toBe('/');
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
