-- System quests: persistent per-user quests issued by an external client
-- (Grok Bot) or the player. The backend service role bypasses RLS; these
-- policies keep the anon key from reading another hunter's quests.
--
-- Apply in the Supabase SQL editor, or:
--   node backend/scripts/apply-migration.js supabase/migrations/010_system_quests.sql

CREATE TABLE IF NOT EXISTS system_quests (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL,
  idempotency_key          TEXT NOT NULL,
  kind                     TEXT NOT NULL CHECK (kind IN ('daily', 'emergency', 'hidden', 'penalty')),
  title                    TEXT NOT NULL,
  description              TEXT NOT NULL DEFAULT '',
  objectives               JSONB NOT NULL DEFAULT '[]'::jsonb,
  deadline                 TIMESTAMPTZ,
  scheduled_for            DATE,
  xp_reward                JSONB NOT NULL DEFAULT '{}'::jsonb,
  reward_note              TEXT,
  reward_costs_money       BOOLEAN NOT NULL DEFAULT FALSE,
  reward_approval          TEXT NOT NULL DEFAULT 'not_required'
                             CHECK (reward_approval IN ('not_required', 'pending', 'approved', 'declined')),
  penalty                  JSONB,
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'cleared', 'failed', 'expired')),
  hidden_until_revealed    BOOLEAN NOT NULL DEFAULT FALSE,
  revealed_at              TIMESTAMPTZ,
  source                   TEXT NOT NULL CHECK (source IN ('grokbot', 'user', 'system')),
  training                 BOOLEAN NOT NULL DEFAULT FALSE,
  thursday_training_flag   BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_type            TEXT,
  parent_quest_id          UUID,
  resolution               JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at              TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_system_quests_user_status
  ON system_quests (user_id, status);

CREATE INDEX IF NOT EXISTS idx_system_quests_due
  ON system_quests (status, deadline);

CREATE TABLE IF NOT EXISTS system_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  idempotency_key  TEXT,
  body             TEXT NOT NULL,
  quest_id         UUID,
  source           TEXT NOT NULL DEFAULT 'grokbot'
                     CHECK (source IN ('grokbot', 'user', 'system')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_system_messages_user_created
  ON system_messages (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS service_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  token_prefix  TEXT NOT NULL,
  scopes        TEXT[] NOT NULL DEFAULT '{system}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_service_credentials_user
  ON service_credentials (user_id);

ALTER TABLE system_quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY system_quests_owner_all ON system_quests
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY system_messages_owner_all ON system_messages
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY service_credentials_owner_all ON service_credentials
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE system_quests IS
  'Persistent System quests (daily, emergency, hidden, penalty) issued to one user. XP is stored on the row and awarded only by the server on clear.';
COMMENT ON TABLE system_messages IS
  'System window messages from Grok Bot or the player.';
COMMENT ON TABLE service_credentials IS
  'Revocable scoped credentials. token_hash is SHA-256; the raw sys_ token is shown once. Scope system can only call /api/system.';
