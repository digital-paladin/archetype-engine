import { FitbitTokens } from './IDataService';

/**
 * `fitbit_tokens` (001_initial_schema) has no `fitbit_user_id` column.
 * `expires_at` is TIMESTAMPTZ — unix ms numbers fail or store garbage.
 */
export function fitbitTokensUpsertRow(userId: string, tokens: FitbitTokens) {
  return {
    user_id: userId,
    access_token_encrypted: tokens.access_token,
    refresh_token_encrypted: tokens.refresh_token,
    expires_at: new Date(tokens.expires_at).toISOString(),
  };
}

export function fitbitTokensFromRow(data: {
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string | number | Date;
  fitbit_user_id?: string | null;
}): FitbitTokens {
  return {
    access_token: data.access_token_encrypted,
    refresh_token: data.refresh_token_encrypted,
    expires_at: new Date(data.expires_at).getTime(),
    fitbit_user_id: data.fitbit_user_id ?? undefined,
  };
}
