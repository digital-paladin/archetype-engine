import { fitbitTokensFromRow, fitbitTokensUpsertRow } from './fitbitTokenRow';

describe('fitbitTokenRow', () => {
  const tokens = {
    access_token: 'at',
    refresh_token: 'rt',
    expires_at: 1_700_000_000_000,
    fitbit_user_id: 'FITBITUSER',
  };

  it('omits fitbit_user_id from the upsert (column is not in schema)', () => {
    const row = fitbitTokensUpsertRow('11111111-1111-1111-1111-111111111111', tokens);
    expect(row).not.toHaveProperty('fitbit_user_id');
    expect(row.expires_at).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('reads expires_at as unix ms from an ISO timestamptz', () => {
    const iso = new Date(1_700_000_000_000).toISOString();
    const parsed = fitbitTokensFromRow({
      access_token_encrypted: 'at',
      refresh_token_encrypted: 'rt',
      expires_at: iso,
    });
    expect(parsed.expires_at).toBe(1_700_000_000_000);
  });
});
