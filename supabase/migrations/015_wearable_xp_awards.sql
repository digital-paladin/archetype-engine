-- Wearable XP dedupe keys. One row per user and key, for example
-- wearable:sleep:YYYY-MM-DD. A repeated sync hits the unique constraint and
-- pays nothing again.
--
-- Passive metrics (sleep, readiness-adherence, steps) share a civil award_date
-- so the 40 XP daily cap can be summed. Workouts stay on activity_log.
-- Hume scan keys are wearable:hume-scan:YYYY-Www. Trend keys are
-- wearable:hume-trend:YYYY-MM.
--
-- vitals_proof_ref stores a screenshot or app-record reference for a manual
-- Hume Band vital. Resting heart rate and HRV never pay XP. A row with no
-- reference is still stored.
--
-- Railway deploys the backend from main and does not run this SQL.
-- Do not apply this file to production until the owner has typed approval.
-- After that approval:
--
--   node backend/scripts/apply-migration.js supabase/migrations/015_wearable_xp_awards.sql

CREATE TABLE IF NOT EXISTS wearable_xp_awards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key     TEXT NOT NULL,
  metric         TEXT NOT NULL,
  award_date     DATE NOT NULL,
  source         TEXT NOT NULL,
  activity_type  TEXT NOT NULL,
  class_name     TEXT NOT NULL,
  xp_awarded     NUMERIC NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key),
  CONSTRAINT wearable_xp_awards_dedupe_key_check
    CHECK (char_length(dedupe_key) BETWEEN 1 AND 200 AND dedupe_key !~ E'[\n\r]'),
  CONSTRAINT wearable_xp_awards_metric_check
    CHECK (metric IN ('sleep', 'readiness-adherence', 'steps', 'hume-scan', 'hume-trend')),
  CONSTRAINT wearable_xp_awards_xp_check
    CHECK (xp_awarded >= 0)
);

CREATE INDEX IF NOT EXISTS wearable_xp_awards_user_date
  ON wearable_xp_awards (user_id, award_date);

ALTER TABLE wearable_xp_awards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wearable_xp_awards_owner_all ON wearable_xp_awards;
CREATE POLICY wearable_xp_awards_owner_all ON wearable_xp_awards
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE wearable_xp_awards IS
  'Idempotent wearable XP awards. Unique on (user_id, dedupe_key). Not applied until the owner approves this migration.';

ALTER TABLE daily_journal_entries
  ADD COLUMN IF NOT EXISTS vitals_proof_ref TEXT;

ALTER TABLE daily_journal_entries DROP CONSTRAINT IF EXISTS daily_journal_entries_vitals_proof_ref_check;
ALTER TABLE daily_journal_entries
  ADD CONSTRAINT daily_journal_entries_vitals_proof_ref_check
  CHECK (vitals_proof_ref IS NULL OR (char_length(vitals_proof_ref) BETWEEN 1 AND 200 AND vitals_proof_ref !~ E'[\n\r]'));

COMMENT ON COLUMN daily_journal_entries.vitals_proof_ref IS
  'Screenshot or app-record reference for a manual Hume Band vital. Absent rows are stored and pay no XP. Resting HR and HRV never pay XP.';
