import { OuraError } from './ouraErrors';
import { openOuraSecret, ouraTokenKeyConfigured, sealOuraSecret } from './ouraTokenCrypto';

describe('Oura token sealing', () => {
  const previousKey = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    restore('INTEGRATIONS_ENCRYPTION_KEY', previousKey);
    restore('SUPABASE_SERVICE_ROLE_KEY', previousService);
  });

  it('seals tokens so the plaintext is not what gets stored', () => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'oura-seal-test-key';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const sealed = sealOuraSecret('access-SHOULD-NOT-LEAK');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('access-SHOULD-NOT-LEAK');
    expect(openOuraSecret(sealed)).toBe('access-SHOULD-NOT-LEAK');
  });

  it('still reads a legacy plaintext row', () => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'oura-seal-test-key';
    expect(openOuraSecret('legacy-plain-token')).toBe('legacy-plain-token');
  });

  it('does not fall back to a hardcoded key', () => {
    delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(ouraTokenKeyConfigured()).toBe(false);
    expect(() => sealOuraSecret('access-SHOULD-NOT-LEAK')).toThrow(OuraError);
    try {
      sealOuraSecret('access-SHOULD-NOT-LEAK');
    } catch (err) {
      expect((err as OuraError).safeMessage).toMatch(/INTEGRATIONS_ENCRYPTION_KEY/);
      expect((err as OuraError).safeMessage).not.toContain('access-SHOULD-NOT-LEAK');
    }
  });

  it('does not echo ciphertext when the key does not match', () => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'key-a';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const sealed = sealOuraSecret('access-SHOULD-NOT-LEAK');
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'key-b';
    expect(() => openOuraSecret(sealed)).toThrow(/cannot be read/);
    try {
      openOuraSecret(sealed);
    } catch (err) {
      expect((err as Error).message).not.toContain(sealed);
      expect((err as Error).message).not.toContain('access-SHOULD-NOT-LEAK');
    }
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
