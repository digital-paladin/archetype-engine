import { decryptSecret, encryptSecret } from './todoistToken.service';
import { OuraError } from './ouraErrors';

/**
 * Oura tokens use the same AES-256-GCM helper as Todoist keys.
 * The hardcoded dev fallback inside that helper is refused here:
 * tokens are not sealed unless a real key is configured.
 */
export function ouraTokenKeyConfigured(): boolean {
  return !!(
    process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

export function sealOuraSecret(plain: string): string {
  if (!ouraTokenKeyConfigured()) {
    throw new OuraError(
      'Set INTEGRATIONS_ENCRYPTION_KEY before storing Oura tokens.',
      503,
      'not_configured',
    );
  }
  return encryptSecret(plain);
}

export function openOuraSecret(stored: string): string {
  if (!stored.startsWith('v1:')) return stored;
  if (!ouraTokenKeyConfigured()) {
    throw new OuraError(
      'Set INTEGRATIONS_ENCRYPTION_KEY before reading Oura tokens.',
      503,
      'not_configured',
    );
  }
  try {
    return decryptSecret(stored);
  } catch {
    throw new OuraError(
      'Stored Oura tokens cannot be read. Restore INTEGRATIONS_ENCRYPTION_KEY or connect Oura again.',
      503,
      'not_configured',
    );
  }
}
