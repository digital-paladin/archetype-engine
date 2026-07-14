-- S3: Expand subscriptions for Stripe billing + ensure user_id uniqueness.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS plan TEXT
    CHECK (plan IS NULL OR plan IN ('paladin', 'shadow_monarch'));

-- One subscription row per user (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_user_id_key'
  ) THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON subscriptions (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub
  ON subscriptions (stripe_subscription_id);

-- Ensure users.tier check includes expected values (already in 001)
COMMENT ON COLUMN users.tier IS 'free | paladin | shadow_monarch — synced from Stripe webhooks';
COMMENT ON COLUMN subscriptions.status IS 'inactive | active | past_due | canceled | trialing';
