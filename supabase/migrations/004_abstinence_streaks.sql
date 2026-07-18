-- S5 / Phase 2.10: Abstinence streak counters (alcohol + sexual ACM items)

CREATE TABLE IF NOT EXISTS abstinence_streaks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_index          INT  NOT NULL CHECK (item_index BETWEEN 0 AND 14),
  current_streak      INT  NOT NULL DEFAULT 0,
  longest_streak      INT  NOT NULL DEFAULT 0,
  last_break_date     DATE,
  last_break_type     TEXT CHECK (last_break_type IS NULL OR last_break_type IN ('unscheduled', 'scheduled')),
  break_log           JSONB NOT NULL DEFAULT '[]'::jsonb,
  resistance_events   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_index)
);

CREATE UNIQUE INDEX IF NOT EXISTS abstinence_streaks_user_item
  ON abstinence_streaks (user_id, item_index);

CREATE INDEX IF NOT EXISTS idx_abstinence_streaks_user
  ON abstinence_streaks (user_id);

COMMENT ON TABLE abstinence_streaks IS
  'Phase 2.10 — day counters for is_abstinence_item ACM indices (0 alcohol, 10 sexual)';
COMMENT ON COLUMN abstinence_streaks.break_log IS
  'Append-only [{ date, type, streak_at_break, compound_break }]';
COMMENT ON COLUMN abstinence_streaks.resistance_events IS
  'Append-only [{ date, note }] — no XP/aMCC attached';
