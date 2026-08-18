-- S-GoogleHealth: allow provider='google' on wearable_tokens.
-- Drops the table CHECK (name varies) and recreates with google included.

ALTER TABLE wearable_tokens DROP CONSTRAINT IF EXISTS wearable_tokens_provider_check;

DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'wearable_tokens'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%provider%'
  LIMIT 1;
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE wearable_tokens DROP CONSTRAINT %I', conname);
  END IF;
END $$;

ALTER TABLE wearable_tokens
  ADD CONSTRAINT wearable_tokens_provider_check
  CHECK (provider IN ('fitbit', 'oura', 'whoop', 'garmin', 'google'));
