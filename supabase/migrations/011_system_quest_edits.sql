-- Quest corrections. Append-only history so a System caller can fix an
-- active quest and a later retry of the same idempotencyKey is a no-op.
--
-- The API omits this column on writes until a quest actually has edits, so
-- create, progress, clear, and fail keep working before this file is applied.
-- PATCH /api/system/quests/:id requires it. Apply before that route is used:
--
--   node backend/scripts/apply-migration.js supabase/migrations/011_system_quest_edits.sql
--
-- Railway deploys the backend from main and does not run this SQL.

ALTER TABLE system_quests
  ADD COLUMN IF NOT EXISTS edits JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN system_quests.edits IS
  'Corrections applied to the quest. Each entry has idempotencyKey, reason, changes, at, and source.';
