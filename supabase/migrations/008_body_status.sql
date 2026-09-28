-- Body status (injuries/illness/disease per body part), previously tracked
-- only in browser localStorage with a stubbed GET /api/character/injuries
-- (always returned []). This table makes it real, queryable, cross-device
-- data, matching the shape of frontend/src/app/body-status.interface.ts.
--
-- "Active" filtering (recovered vs still active) is computed in the service
-- layer from start_date + estimated_recovery_days, not stored as a column —
-- mirrors how status_effects computes expiry from duration rather than
-- storing an is_active flag.

CREATE TABLE IF NOT EXISTS body_status (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL,
  body_part                TEXT NOT NULL,
  type                     TEXT NOT NULL CHECK (type IN ('injury', 'illness', 'disease')),
  severity                 TEXT NOT NULL CHECK (severity IN ('minor', 'moderate', 'severe', 'critical')),
  name                     TEXT NOT NULL,
  description              TEXT,
  start_date               TIMESTAMPTZ NOT NULL DEFAULT now(),
  estimated_recovery_days  INT,
  notes                    TEXT,
  impacts_actions          TEXT[] NOT NULL DEFAULT '{}',
  xp_penalty               INT NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_body_status_user_id ON body_status (user_id);

ALTER TABLE body_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY body_status_owner_all ON body_status
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE body_status IS
  'Per-body-part injury/illness/disease tracking. Replaces the GET /api/character/injuries stub and browser-localStorage-only frontend storage.';
COMMENT ON COLUMN body_status.impacts_actions IS
  'Activity types this status reduces XP for (e.g. ["workout","running"]). Matches BodyStatus.impactsActions on the frontend.';
COMMENT ON COLUMN body_status.xp_penalty IS
  'Percent XP reduction (e.g. 20 = -20%) applied to matching impacts_actions. Highest active value wins — not cumulative.';
