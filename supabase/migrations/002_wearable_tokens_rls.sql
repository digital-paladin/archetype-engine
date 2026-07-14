-- S2: Ensure wearable_tokens exists for multi-provider OAuth (Oura / Garmin / …).
-- Table already defined in 001_initial_schema.sql — this migration is idempotent
-- for environments that applied 001 without wearable_tokens.

CREATE TABLE IF NOT EXISTS wearable_tokens (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL CHECK (provider IN ('fitbit', 'oura', 'whoop', 'garmin')),
  access_token_encrypted   TEXT NOT NULL,
  refresh_token_encrypted  TEXT NOT NULL,
  expires_at               TIMESTAMPTZ,
  scope                    TEXT,
  UNIQUE (user_id, provider)
);

ALTER TABLE wearable_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'wearable_tokens' AND policyname = 'own_rows'
  ) THEN
    CREATE POLICY "own_rows" ON wearable_tokens
      FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wearable_tokens_user_provider
  ON wearable_tokens (user_id, provider);
