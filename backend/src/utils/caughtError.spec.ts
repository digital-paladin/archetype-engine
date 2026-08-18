import { caughtErrorMessage } from './caughtError';

describe('caughtErrorMessage', () => {
  it('uses Error.message', () => {
    expect(caughtErrorMessage(new Error('Fitbit token exchange failed'))).toBe(
      'Fitbit token exchange failed',
    );
  });

  it('uses PostgREST-style plain objects (not instanceof Error)', () => {
    expect(caughtErrorMessage({
      message: "Could not find the 'fitbit_user_id' column of 'fitbit_tokens' in the schema cache",
      code: 'PGRST204',
    })).toContain('fitbit_user_id');
  });

  it('falls back when the throw is neither', () => {
    expect(caughtErrorMessage(null)).toBe('Unknown error');
    expect(caughtErrorMessage({ code: 'PGRST204' })).toBe('Unknown error');
  });
});
