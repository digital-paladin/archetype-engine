-- Phase 3: Disciplined Indulgence scheduling — pre-declare an upcoming "scheduled" break
-- (estimated type/count) before it happens, then reconcile against what was actually logged.
--
-- Unblocks the `'scheduled breaks are not enabled yet (Phase 3)'` guard that has existed in
-- abstinence.service.ts (logBreak) since Sprint S5 — that guard stays in place for the
-- generic /api/abstinence/break route; scheduled breaks are now resolved exclusively through
-- the new /api/abstinence/:itemIndex/schedule/:scheduledId/resolve route, which both logs the
-- break AND records the estimate-vs-actual comparison in one atomic update.

ALTER TABLE abstinence_streaks
  ADD COLUMN IF NOT EXISTS scheduled_breaks JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN abstinence_streaks.scheduled_breaks IS
  'Append-only [{ id, scheduled_date, estimated_type, estimated_count, notes, created_at, '
  'resolved, actual_type, actual_count, resolved_at }] — pre-declared indulgence intents, '
  'reconciled against reality once the scheduled date passes.';
