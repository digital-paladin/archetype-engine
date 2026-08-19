-- S6f: per-user integration credentials (Todoist API key first).
-- Encrypted values are written by the backend (AES-256-GCM); GET APIs never return raw keys.

CREATE TABLE IF NOT EXISTS user_integrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service           TEXT NOT NULL CHECK (service IN ('todoist')),
  credential_type   TEXT NOT NULL DEFAULT 'api_key',
  encrypted_value   TEXT NOT NULL,
  connected_at      TIMESTAMPTZ DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'connected'
                    CHECK (status IN ('connected', 'disconnected')),
  UNIQUE (user_id, service)
);

ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_integrations' AND policyname = 'own_rows'
  ) THEN
    CREATE POLICY "own_rows" ON user_integrations
      FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_integrations_user_service
  ON user_integrations (user_id, service);
