-- ============================================================
-- Archetype Engine — Initial Schema
-- Migration: 001_initial_schema.sql
-- Run this in Supabase SQL Editor (Project → SQL Editor → New query)
-- ============================================================

-- ────────────────────────────────────────
-- CORE: Users & Subscriptions
-- ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT UNIQUE NOT NULL,
  birth_date            DATE,
  tier                  TEXT NOT NULL DEFAULT 'free'
                        CHECK (tier IN ('free', 'paladin', 'shadow_monarch')),
  openclaw_gateway_url  TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id  TEXT UNIQUE,
  status              TEXT NOT NULL DEFAULT 'inactive',
  current_period_end  TIMESTAMPTZ
);

-- ────────────────────────────────────────
-- CHARACTER PROGRESSION (replaces character-sheet.md)
-- ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS character_stats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_name  TEXT NOT NULL,
  -- 'warrior' | 'developer' | 'sage' | 'artist' | 'redteamer' | 'financial_strategist' | 'survivalist'
  level       INT NOT NULL DEFAULT 1,
  current_xp  NUMERIC NOT NULL DEFAULT 0,
  total_xp    NUMERIC NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, class_name)
);

CREATE TABLE IF NOT EXISTS skill_tree_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_name   TEXT NOT NULL,
  skill_name   TEXT NOT NULL,
  skill_level  INT NOT NULL DEFAULT 0,
  xp           NUMERIC NOT NULL DEFAULT 0,
  unlocked_at  TIMESTAMPTZ,
  UNIQUE (user_id, class_name, skill_name)
);

CREATE TABLE IF NOT EXISTS xp_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  earned_at           DATE NOT NULL,
  class_name          TEXT NOT NULL,
  xp_pending          NUMERIC NOT NULL DEFAULT 0,
  xp_confirmed        NUMERIC NOT NULL DEFAULT 0,
  consolidation_pct   NUMERIC,
  fitbit_score        INT,
  streak_days         INT,
  notes               TEXT
);

-- ────────────────────────────────────────
-- JOURNAL (replaces daily manual journal compendium.md)
-- ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date      DATE NOT NULL,
  sleep_hours     NUMERIC,
  sleep_start     TIME,
  sleep_end       TIME,
  fitbit_score    INT,
  fasting_hours   NUMERIC,
  hydration_oz    NUMERIC,
  protein_level   TEXT CHECK (protein_level IN ('low', 'medium', 'high')),
  food_quality    TEXT CHECK (food_quality IN ('poor', 'mixed', 'mixed/good', 'good', 'excellent')),
  calories_status TEXT CHECK (calories_status IN ('deficit', 'maintenance', 'surplus')),
  stress_level    TEXT CHECK (stress_level IN ('low', 'medium', 'high')),
  energy_score    INT CHECK (energy_score BETWEEN 1 AND 10),
  mental_state    TEXT,
  notes           TEXT,
  ai_summary      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, entry_date)
);

CREATE TABLE IF NOT EXISTS acm_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id  UUID NOT NULL REFERENCES daily_journal_entries(id) ON DELETE CASCADE,
  item_index        INT NOT NULL CHECK (item_index BETWEEN 0 AND 14),
  completed         BOOLEAN NOT NULL DEFAULT false,
  completed_at      TIMESTAMPTZ,
  UNIQUE (journal_entry_id, item_index)
);

CREATE TABLE IF NOT EXISTS quest_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date   DATE NOT NULL,
  class_name   TEXT NOT NULL,
  quest_label  TEXT NOT NULL,
  content      TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, entry_date, class_name, quest_label)
);

-- ────────────────────────────────────────
-- ACTIVITY & OPERATIONS (replaces JSON sidecar files)
-- ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_at      TIMESTAMPTZ DEFAULT now(),
  class_name     TEXT NOT NULL,
  activity_type  TEXT NOT NULL,
  duration_hours NUMERIC,
  xp_awarded     NUMERIC,
  notes          TEXT
);

CREATE TABLE IF NOT EXISTS vault_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_name    TEXT NOT NULL,
  quantity     INT NOT NULL DEFAULT 1,
  rarity       TEXT CHECK (rarity IN ('normal', 'fine', 'superior', 'epic', 'legendary')),
  acquired_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courage_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date  DATE NOT NULL,
  score       INT,
  notes       TEXT,
  UNIQUE (user_id, entry_date)
);

CREATE TABLE IF NOT EXISTS active_status_effects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effect_name  TEXT NOT NULL,
  applied_at   TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  magnitude    NUMERIC
);

CREATE TABLE IF NOT EXISTS rewards_catalog (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name      TEXT UNIQUE NOT NULL,
  description    TEXT,
  rarity         TEXT,
  cost_xp        NUMERIC,
  tier_required  TEXT NOT NULL DEFAULT 'free'
);

CREATE TABLE IF NOT EXISTS spending_entries (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spent_at  DATE NOT NULL,
  category  TEXT,
  amount    NUMERIC,
  notes     TEXT
);

-- ────────────────────────────────────────
-- OAUTH TOKENS (replaces fitbit-tokens.json)
-- ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fitbit_tokens (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  access_token_encrypted   TEXT NOT NULL,
  refresh_token_encrypted  TEXT NOT NULL,
  expires_at               TIMESTAMPTZ,
  scope                    TEXT
);

-- Future wearables (Oura, WHOOP, Garmin — Phase 2.5)
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

-- ────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────

ALTER TABLE character_stats          ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_tree_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_history                ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_journal_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE acm_entries               ENABLE ROW LEVEL SECURITY;
ALTER TABLE quest_entries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE courage_entries           ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_status_effects     ENABLE ROW LEVEL SECURITY;
ALTER TABLE spending_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitbit_tokens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE wearable_tokens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions             ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users can only access their own rows
-- Pattern applied to every user-scoped table:

CREATE POLICY "own_rows" ON character_stats
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON skill_tree_entries
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON xp_history
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON daily_journal_entries
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON acm_entries
  FOR ALL USING (
    journal_entry_id IN (
      SELECT id FROM daily_journal_entries WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "own_rows" ON quest_entries
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON activity_log
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON vault_items
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON courage_entries
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON active_status_effects
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON spending_entries
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON fitbit_tokens
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON wearable_tokens
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_rows" ON subscriptions
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- rewards_catalog: public read (shared catalog, no RLS needed)
-- No ALTER TABLE ... ENABLE ROW LEVEL SECURITY on rewards_catalog

-- ────────────────────────────────────────
-- INDEXES (performance)
-- ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_daily_journal_user_date ON daily_journal_entries (user_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_acm_journal_entry ON acm_entries (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_quest_user_date ON quest_entries (user_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user_date ON activity_log (user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_xp_user_date ON xp_history (user_id, earned_at DESC);
CREATE INDEX IF NOT EXISTS idx_char_stats_user ON character_stats (user_id);
