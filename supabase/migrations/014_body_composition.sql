-- Smart-scale body composition readings (Hume and any later source).
-- POST /api/system/body-composition inserts one reading.
-- GET /api/system/body-composition and GET /api/body-composition read them back.
--
-- Store the vendor's numbers and labels as reported. These columns are not
-- XP inputs, and nothing here encodes a healthy range — vendor bands disagree.
-- Numeric checks are unit bounds only (a percent is 0–100, a pound-mass is
-- positive). Weight is nullable: a scale export can omit it.
--
-- Railway deploys the backend from main and does not run this SQL.
-- Apply before posting readings:
--
--   node backend/scripts/apply-migration.js supabase/migrations/014_body_composition.sql

CREATE TABLE IF NOT EXISTS body_composition_readings (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                      UUID NOT NULL,
  idempotency_key              TEXT NOT NULL,
  source                       TEXT NOT NULL,
  measured_at                  TIMESTAMPTZ NOT NULL,
  fasted                       BOOLEAN,
  context                      TEXT,
  notes                        TEXT,
  health_score                 INT,
  health_score_label           TEXT,
  health_score_confidence_pct  NUMERIC,
  biological_age_years         NUMERIC,
  metabolic_age_years          NUMERIC,
  body_fat_pct                 NUMERIC,
  body_water_pct               NUMERIC,
  skeletal_muscle_mass_lb      NUMERIC,
  weight_lb                    NUMERIC,
  body_composition_grade       TEXT,
  activity_grade               TEXT,
  sleep_grade                  TEXT,
  body_fat_label               TEXT,
  body_water_label             TEXT,
  skeletal_muscle_mass_label   TEXT,
  weight_label                 TEXT,
  biological_age_label         TEXT,
  metabolic_age_label          TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CONSTRAINT body_composition_readings_idempotency_key_check
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 200 AND idempotency_key !~ E'[\n\r]'),
  CONSTRAINT body_composition_readings_source_check
    CHECK (char_length(source) BETWEEN 1 AND 40 AND source !~ E'[\n\r]'),
  CONSTRAINT body_composition_readings_context_check
    CHECK (context IS NULL OR (char_length(context) BETWEEN 1 AND 200 AND context !~ E'[\n\r]')),
  CONSTRAINT body_composition_readings_notes_check
    CHECK (notes IS NULL OR char_length(notes) BETWEEN 1 AND 2000),
  CONSTRAINT body_composition_readings_health_score_check
    CHECK (health_score IS NULL OR (health_score >= 0 AND health_score <= 100000)),
  CONSTRAINT body_composition_readings_health_score_label_check
    CHECK (health_score_label IS NULL OR (char_length(health_score_label) BETWEEN 1 AND 80 AND health_score_label !~ E'[\n\r]')),
  CONSTRAINT body_composition_readings_health_score_confidence_pct_check
    CHECK (health_score_confidence_pct IS NULL OR (health_score_confidence_pct >= 0 AND health_score_confidence_pct <= 100)),
  CONSTRAINT body_composition_readings_biological_age_years_check
    CHECK (biological_age_years IS NULL OR (biological_age_years >= 0 AND biological_age_years <= 200)),
  CONSTRAINT body_composition_readings_metabolic_age_years_check
    CHECK (metabolic_age_years IS NULL OR (metabolic_age_years >= 0 AND metabolic_age_years <= 200)),
  CONSTRAINT body_composition_readings_body_fat_pct_check
    CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 0 AND body_fat_pct <= 100)),
  CONSTRAINT body_composition_readings_body_water_pct_check
    CHECK (body_water_pct IS NULL OR (body_water_pct >= 0 AND body_water_pct <= 100)),
  CONSTRAINT body_composition_readings_skeletal_muscle_mass_lb_check
    CHECK (skeletal_muscle_mass_lb IS NULL OR (skeletal_muscle_mass_lb > 0 AND skeletal_muscle_mass_lb <= 2000)),
  CONSTRAINT body_composition_readings_weight_lb_check
    CHECK (weight_lb IS NULL OR (weight_lb > 0 AND weight_lb <= 2000)),
  CONSTRAINT body_composition_readings_body_composition_grade_check
    CHECK (body_composition_grade IS NULL OR (char_length(body_composition_grade) BETWEEN 1 AND 16 AND body_composition_grade !~ E'[\n\r]')),
  CONSTRAINT body_composition_readings_activity_grade_check
    CHECK (activity_grade IS NULL OR (char_length(activity_grade) BETWEEN 1 AND 16 AND activity_grade !~ E'[\n\r]')),
  CONSTRAINT body_composition_readings_sleep_grade_check
    CHECK (sleep_grade IS NULL OR (char_length(sleep_grade) BETWEEN 1 AND 16 AND sleep_grade !~ E'[\n\r]')),
  CONSTRAINT body_composition_readings_body_fat_label_check
    CHECK (body_fat_label IS NULL OR (char_length(body_fat_label) BETWEEN 1 AND 80 AND body_fat_label !~ E'[\n\r]')),
  CONSTRAINT body_composition_readings_body_water_label_check
    CHECK (body_water_label IS NULL OR (char_length(body_water_label) BETWEEN 1 AND 80 AND body_water_label !~ E'[\n\r]')),
  CONSTRAINT body_composition_readings_skeletal_muscle_mass_label_check
    CHECK (skeletal_muscle_mass_label IS NULL OR (char_length(skeletal_muscle_mass_label) BETWEEN 1 AND 80 AND skeletal_muscle_mass_label !~ E'[\n\r]')),
  CONSTRAINT body_composition_readings_weight_label_check
    CHECK (weight_label IS NULL OR (char_length(weight_label) BETWEEN 1 AND 80 AND weight_label !~ E'[\n\r]')),
  CONSTRAINT body_composition_readings_biological_age_label_check
    CHECK (biological_age_label IS NULL OR (char_length(biological_age_label) BETWEEN 1 AND 80 AND biological_age_label !~ E'[\n\r]')),
  CONSTRAINT body_composition_readings_metabolic_age_label_check
    CHECK (metabolic_age_label IS NULL OR (char_length(metabolic_age_label) BETWEEN 1 AND 80 AND metabolic_age_label !~ E'[\n\r]'))
);

CREATE INDEX IF NOT EXISTS body_composition_readings_user_measured
  ON body_composition_readings (user_id, measured_at DESC);

ALTER TABLE body_composition_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS body_composition_readings_owner_all ON body_composition_readings;
CREATE POLICY body_composition_readings_owner_all ON body_composition_readings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE body_composition_readings IS
  'Time series of smart-scale readings. Raw vendor values only. Not an XP input. Idempotent on (user_id, idempotency_key).';
COMMENT ON COLUMN body_composition_readings.measured_at IS
  'When the scale took the reading (timestamptz).';
COMMENT ON COLUMN body_composition_readings.source IS
  'Vendor or entry source, stored as sent, e.g. hume.';
COMMENT ON COLUMN body_composition_readings.fasted IS
  'Nullable fasted flag. Null when the export did not say.';
COMMENT ON COLUMN body_composition_readings.context IS
  'Nullable free-text context, e.g. morning. Not a derived judgment.';
COMMENT ON COLUMN body_composition_readings.health_score IS
  'Vendor health score integer. Stored raw. No healthy-range check.';
COMMENT ON COLUMN body_composition_readings.health_score_label IS
  'Vendor label for the health score, stored verbatim.';
COMMENT ON COLUMN body_composition_readings.health_score_confidence_pct IS
  'Vendor confidence percent for the health score, 0–100.';
COMMENT ON COLUMN body_composition_readings.skeletal_muscle_mass_lb IS
  'Skeletal muscle mass in pounds, as reported. Not converted.';
COMMENT ON COLUMN body_composition_readings.weight_lb IS
  'Body weight in pounds. Null when the scale omitted weight.';
COMMENT ON COLUMN body_composition_readings.body_composition_grade IS
  'Vendor letter grade for body composition, stored verbatim.';
COMMENT ON COLUMN body_composition_readings.activity_grade IS
  'Vendor letter grade for activity, stored verbatim.';
COMMENT ON COLUMN body_composition_readings.sleep_grade IS
  'Vendor letter grade for sleep, stored verbatim.';
COMMENT ON COLUMN body_composition_readings.body_fat_label IS
  'Vendor category label for body fat, stored verbatim.';
