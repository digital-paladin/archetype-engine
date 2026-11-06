-- Oura daily sleep, readiness, and activity summaries, plus last-sync status.
-- Access and refresh tokens stay in wearable_tokens (encrypted by the backend).
-- This table is not an XP ledger. Readiness does not award XP or create workouts.
--
-- Railway deploys the backend from main and does not run this SQL.
-- Apply before the first Oura sync:
--
--   node backend/scripts/apply-migration.js supabase/migrations/015_oura_daily_summaries.sql

CREATE TABLE IF NOT EXISTS oura_daily_summaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary_date    DATE NOT NULL,
  timezone        TEXT,
  sleep           JSONB,
  readiness       JSONB,
  activity        JSONB,
  provenance      JSONB NOT NULL,
  partial         BOOLEAN NOT NULL DEFAULT FALSE,
  no_data         BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, summary_date)
);

CREATE TABLE IF NOT EXISTS oura_sync_status (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_sync_at       TIMESTAMPTZ,
  last_sync_status   TEXT CHECK (
    last_sync_status IS NULL OR last_sync_status IN (
      'ok', 'partial', 'no_data', 'error', 'revoked', 'rate_limited', 'forbidden'
    )
  ),
  last_sync_detail   TEXT,
  last_summary_date  DATE,
  timezone           TEXT
);

ALTER TABLE oura_daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE oura_sync_status ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'oura_daily_summaries' AND policyname = 'own_rows'
  ) THEN
    CREATE POLICY "own_rows" ON oura_daily_summaries
      FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'oura_sync_status' AND policyname = 'own_rows'
  ) THEN
    CREATE POLICY "own_rows" ON oura_sync_status
      FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_oura_daily_summaries_user_date
  ON oura_daily_summaries (user_id, summary_date DESC);

COMMENT ON TABLE oura_daily_summaries IS
  'Per-user Oura daily summaries. summary_date is the Oura day that was requested. timezone is the UTC offset on the source document, not an IANA zone. Not an XP input.';
COMMENT ON COLUMN oura_daily_summaries.readiness IS
  'Oura daily_readiness. hrvBalanceContributor is a 0–100 contributor, not HRV in milliseconds.';
