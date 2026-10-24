-- Optional daily vitals (Hume Band screenshots, or a tagged Fitbit/Oura/manual reading).
-- POST /api/daily-metrics accepts metrics.hrvMs, metrics.restingHr, metrics.spo2Pct,
-- and metrics.source. XP does not read these columns.
--
-- Existing sleep / Fitbit / Oura / Google Health writes omit them, so those
-- upserts keep working before this file is applied.
--
-- Railway deploys the backend from main and does not run this SQL.
-- Apply before posting vitals:
--
--   node backend/scripts/apply-migration.js supabase/migrations/013_journal_vitals.sql

ALTER TABLE daily_journal_entries
  ADD COLUMN IF NOT EXISTS hrv_ms NUMERIC,
  ADD COLUMN IF NOT EXISTS resting_hr INT,
  ADD COLUMN IF NOT EXISTS spo2_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS vitals_source TEXT;

ALTER TABLE daily_journal_entries DROP CONSTRAINT IF EXISTS daily_journal_entries_hrv_ms_check;
ALTER TABLE daily_journal_entries
  ADD CONSTRAINT daily_journal_entries_hrv_ms_check
  CHECK (hrv_ms >= 1 AND hrv_ms <= 500);

ALTER TABLE daily_journal_entries DROP CONSTRAINT IF EXISTS daily_journal_entries_resting_hr_check;
ALTER TABLE daily_journal_entries
  ADD CONSTRAINT daily_journal_entries_resting_hr_check
  CHECK (resting_hr BETWEEN 20 AND 220);

ALTER TABLE daily_journal_entries DROP CONSTRAINT IF EXISTS daily_journal_entries_spo2_pct_check;
ALTER TABLE daily_journal_entries
  ADD CONSTRAINT daily_journal_entries_spo2_pct_check
  CHECK (spo2_pct >= 0 AND spo2_pct <= 100);

ALTER TABLE daily_journal_entries DROP CONSTRAINT IF EXISTS daily_journal_entries_vitals_source_check;
ALTER TABLE daily_journal_entries
  ADD CONSTRAINT daily_journal_entries_vitals_source_check
  CHECK (vitals_source IN ('hume', 'fitbit', 'oura', 'manual'));

COMMENT ON COLUMN daily_journal_entries.hrv_ms IS
  'Heart-rate variability in milliseconds. Optional. Not an XP input.';
COMMENT ON COLUMN daily_journal_entries.resting_hr IS
  'Resting heart rate in whole bpm. Optional. Not an XP input.';
COMMENT ON COLUMN daily_journal_entries.spo2_pct IS
  'Blood oxygen percentage, 0–100. Optional. Not an XP input.';
COMMENT ON COLUMN daily_journal_entries.vitals_source IS
  'Where hrv_ms / resting_hr / spo2_pct came from: hume, fitbit, oura, or manual.';
