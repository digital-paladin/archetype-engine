-- Status effects and consumption idempotency.
--
-- 011_system_quest_edits.sql is the system-quest correction migration.
-- This file is 012 so the two apply independently, in either order.
--
-- Railway deploys the backend from main and does not run this SQL.
-- Apply it before auto effects or POST /api/system/consumption:
--
--   node backend/scripts/apply-migration.js supabase/migrations/012_status_effects.sql
--
-- A legacy status-effects.json next to the journal is imported once, for the
-- first user who reads effects, only when this table is still empty. If the
-- table already has rows, the file is left in place and ignored.

CREATE TABLE IF NOT EXISTS status_effects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('buff', 'debuff', 'mixed')),
  category      TEXT NOT NULL DEFAULT 'other',
  source        TEXT NOT NULL,
  icon          TEXT NOT NULL,
  effects       JSONB NOT NULL DEFAULT '[]'::jsonb,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration      INT NOT NULL,
  expires_at    TIMESTAMPTZ,
  notes         TEXT,
  effect_key    TEXT,
  dose          TEXT,
  auto_applied  BOOLEAN NOT NULL DEFAULT FALSE,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Postgres treats NULL effect_key values as distinct, so manual effects can repeat.
-- A keyed effect (alcohol, caffeine, hydration, …) has one row per user and is updated in place.
CREATE UNIQUE INDEX IF NOT EXISTS status_effects_user_key
  ON status_effects (user_id, effect_key);

CREATE INDEX IF NOT EXISTS status_effects_user_expires
  ON status_effects (user_id, expires_at);

ALTER TABLE status_effects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS status_effects_owner_all ON status_effects;
CREATE POLICY status_effects_owner_all ON status_effects
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS consumption_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  idempotency_key  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete')),
  result           JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS consumption_events_user_created
  ON consumption_events (user_id, created_at DESC);

ALTER TABLE consumption_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consumption_events_owner_all ON consumption_events;
CREATE POLICY consumption_events_owner_all ON consumption_events
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Columns the consume path already writes. They were missing from 001.
ALTER TABLE daily_journal_entries
  ADD COLUMN IF NOT EXISTS protein_grams_logged NUMERIC,
  ADD COLUMN IF NOT EXISTS meal_count INT,
  ADD COLUMN IF NOT EXISTS food_log JSONB;

COMMENT ON TABLE status_effects IS
  'Per-user buffs and debuffs. effect_key merges repeat doses. The service role bypasses RLS.';
COMMENT ON COLUMN status_effects.dose IS
  'Human-readable dose for auto effects, e.g. "0.84 standard drinks" or "95 mg caffeine".';
COMMENT ON COLUMN status_effects.auto_applied IS
  'True when consumption logging created or refreshed the row.';
COMMENT ON TABLE consumption_events IS
  'Idempotency for POST /api/system/consumption. A complete row is replayed. A pending row means the first attempt has not finished.';
