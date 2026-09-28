-- Sleep-extension streak: consecutive nights ≥ 9h, recomputed on every
-- syncSleepDebtFromJournal call (not a running accumulator). Used by the
-- XP consolidation sleep-extension modifier; 0 until 5 consecutive nights.

ALTER TABLE character_profile
  ADD COLUMN IF NOT EXISTS sleep_extension_streak INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN character_profile.sleep_extension_streak IS
  'Consecutive ≥9h nights ending on the last sync date. Recomputed from daily_journal_entries on every sleep-debt sync — not accumulated.';
