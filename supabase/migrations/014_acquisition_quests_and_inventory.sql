-- Acquisition quests and database inventory.
--
-- Quest kind `acquisition` is a long-term goal. It is not expired by the
-- deadline sweeper. target_cost_cents and amount_saved_cents are USD cents
-- for display and planning. They are not XP inputs. Milestone XP lives on
-- objectives and is paid by the server when a step is completed. Clearing
-- the quest marks the linked inventory item stocked.
--
-- inventory_item_defaults preserves the catalog that used to be hardcoded in
-- frontend/src/app/inventory.service.ts. GET /api/inventory copies any slug
-- the user does not already have. Existing player edits are not overwritten.
--
-- Railway deploys the backend from main and does not run this SQL.
-- Apply before creating an acquisition quest or loading inventory from the API:
--
--   node backend/scripts/apply-migration.js supabase/migrations/014_acquisition_quests_and_inventory.sql

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'system_quests'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE system_quests DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE system_quests
  ADD CONSTRAINT system_quests_kind_check
  CHECK (kind IN ('daily', 'emergency', 'hidden', 'penalty', 'acquisition'));

ALTER TABLE system_quests
  ADD COLUMN IF NOT EXISTS target_cost_cents INTEGER,
  ADD COLUMN IF NOT EXISTS amount_saved_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inventory_item_id UUID;

ALTER TABLE system_quests DROP CONSTRAINT IF EXISTS system_quests_target_cost_cents_check;
ALTER TABLE system_quests
  ADD CONSTRAINT system_quests_target_cost_cents_check
  CHECK (target_cost_cents IS NULL OR (target_cost_cents >= 0 AND target_cost_cents <= 100000000));

ALTER TABLE system_quests DROP CONSTRAINT IF EXISTS system_quests_amount_saved_cents_check;
ALTER TABLE system_quests
  ADD CONSTRAINT system_quests_amount_saved_cents_check
  CHECK (amount_saved_cents >= 0 AND amount_saved_cents <= 100000000);

COMMENT ON COLUMN system_quests.target_cost_cents IS
  'Acquisition budget target in USD cents. Tracking only. Never an XP input.';
COMMENT ON COLUMN system_quests.amount_saved_cents IS
  'Acquisition amount saved so far in USD cents. Updating this does not award XP.';
COMMENT ON COLUMN system_quests.inventory_item_id IS
  'inventory_items.id marked stocked when this acquisition quest is cleared.';

CREATE TABLE IF NOT EXISTS inventory_item_defaults (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('consumable', 'equipment')),
  category          TEXT NOT NULL CHECK (category IN (
                      'steel-supplement', 'recovery-gear', 'armor', 'weapon',
                      'mount', 'tech-hardware', 'survivalist')),
  icon              TEXT NOT NULL,
  unit              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  equipped          BOOLEAN NOT NULL DEFAULT FALSE,
  level_requirement INTEGER,
  stock_status      TEXT CHECK (stock_status IS NULL OR stock_status IN ('stocked', 'low', 'needed')),
  monthly_cost      TEXT,
  priority          TEXT CHECK (priority IS NULL OR priority IN ('HIGH', 'MEDIUM', 'LOW'))
);

INSERT INTO inventory_item_defaults (
  id, name, type, category, icon, unit, description, equipped,
  level_requirement, stock_status, monthly_cost, priority
) VALUES
  ('whey-protein', 'Whey Protein Powder', 'consumable', 'steel-supplement', '🥤', 'scoop', 'Post-workout recovery — ~30g protein per scoop.', FALSE, NULL, 'stocked', '$40–60', 'HIGH'),
  ('pre-workout', 'Pre-Workout Blend', 'consumable', 'steel-supplement', '⚡', 'scoop', 'Energy for early-morning training sessions.', FALSE, NULL, 'stocked', '$35–50', 'HIGH'),
  ('intra-workout', 'Intra-Workout Mix', 'consumable', 'steel-supplement', '💧', 'scoop', 'Peri-workout hydration and pump support.', FALSE, NULL, 'stocked', '$35–50', 'HIGH'),
  ('sleep-support', 'Sleep Support Blend', 'consumable', 'steel-supplement', '🌙', 'serving', 'Sleep quality support — aids XP consolidation recovery.', FALSE, NULL, 'stocked', '$35–50', 'HIGH'),
  ('daily-multi', 'Daily Multivitamin', 'consumable', 'steel-supplement', '💊', 'serving', 'Daily micronutrient baseline.', FALSE, NULL, 'stocked', '$25–40', 'MEDIUM'),
  ('creatine', 'Creatine Monohydrate', 'consumable', 'steel-supplement', '🔬', 'gram', 'Strength support — 5g daily.', FALSE, NULL, 'stocked', '$10–15', 'MEDIUM'),
  ('energy-drink', 'Energy Drink', 'consumable', 'steel-supplement', '🥤', 'can', 'Caffeinated on-the-go energy (~150mg).', FALSE, NULL, 'low', '$30–45', 'MEDIUM'),
  ('energy-backup', 'Backup Energy Drink', 'consumable', 'steel-supplement', '⚡', 'can', 'Secondary energy source. Use sparingly.', FALSE, NULL, 'needed', '$30–45', 'LOW'),
  ('knee-sleeve', 'Knee Sleeve', 'equipment', 'recovery-gear', '🦵', 'piece', 'Compression support for joint stability. 6–12 month cycle.', FALSE, NULL, 'stocked', '$20–40', 'HIGH'),
  ('massage-gun', 'Massage Gun', 'equipment', 'recovery-gear', '🔧', 'piece', 'Daily muscle recovery & trigger point release. Theragun / Hyperice.', FALSE, NULL, 'needed', '$150–300', 'HIGH'),
  ('foam-roller', 'Foam Roller', 'equipment', 'recovery-gear', '🟫', 'piece', 'Self-myofascial release. 2–3 year cycle.', FALSE, NULL, 'needed', '$20–40', 'MEDIUM'),
  ('ice-packs', 'Ice Packs', 'equipment', 'recovery-gear', '🧊', 'set', 'Reusable. Critical for RICE protocol — acute injury treatment.', FALSE, NULL, 'needed', '$10–20', 'HIGH'),
  ('kt-tape', 'KT Tape', 'equipment', 'recovery-gear', '🩹', 'roll', 'Preventive taping & injury support. Replenish as needed.', FALSE, NULL, 'low', '$10–15', 'MEDIUM'),
  ('ibuprofen', 'Ibuprofen', 'consumable', 'recovery-gear', '💊', 'tablet', 'Anti-inflammatory. Max 2–3x/week to avoid masking injury signals.', FALSE, NULL, 'stocked', '$10–15', 'HIGH'),
  ('biofreeze', 'Biofreeze', 'consumable', 'recovery-gear', '🧴', 'use', 'Topical pain relief. 2–3 month cycle.', FALSE, NULL, 'low', '$8–12', 'MEDIUM'),
  ('epsom-salt', 'Epsom Salt', 'consumable', 'recovery-gear', '🛁', 'cup', 'Recovery baths 2x/week during injury recovery.', FALSE, NULL, 'needed', '$5–10', 'LOW'),
  ('first-aid-kit', 'First Aid Kit', 'equipment', 'recovery-gear', '🏥', 'kit', 'Wilderness-grade. One-time purchase + refills. Priority Phase 3+.', FALSE, NULL, 'needed', '$30–60', 'HIGH'),
  ('belt-of-truth', 'Belt of Truth', 'equipment', 'armor', '🔗', 'piece', 'Ephesians 6:14 — Truth holds everything together', FALSE, 1, NULL, NULL, NULL),
  ('breastplate-righteousness', 'Breastplate of Righteousness', 'equipment', 'armor', '🛡️', 'piece', 'Ephesians 6:14 — Protects the heart', FALSE, 10, NULL, NULL, NULL),
  ('boots-of-peace', 'Boots of Peace', 'equipment', 'armor', '👢', 'piece', 'Ephesians 6:15 — Readiness from the gospel', FALSE, 1, NULL, NULL, NULL),
  ('shield-of-faith', 'Shield of Faith', 'equipment', 'armor', '🛡️', 'piece', 'Ephesians 6:16 — Extinguishes flaming arrows', FALSE, 20, NULL, NULL, NULL),
  ('helmet-of-salvation', 'Helmet of Salvation', 'equipment', 'armor', '⛑️', 'piece', 'Ephesians 6:17 — Protects the mind', FALSE, 15, NULL, NULL, NULL),
  ('sword-of-spirit', 'Sword of the Spirit', 'equipment', 'armor', '⚔️', 'piece', 'Ephesians 6:17 — The Word of God', FALSE, 25, NULL, NULL, NULL),
  ('hk-cc9', 'Compact 9mm Handgun', 'equipment', 'weapon', '🔫', 'piece', 'Primary conceal-carry sidearm. Semi-auto 9mm. Range + home defense training.', FALSE, NULL, 'needed', '$600–700', 'HIGH'),
  ('ammo-9mm-range', '9mm Ammo (Range)', 'consumable', 'weapon', '🎯', 'rounds', 'Range practice — target 200 rds/month (Phase 2). Hollow-point carry rounds separate.', FALSE, NULL, 'needed', '$60–80', 'HIGH'),
  ('personal-vehicle', 'Personal Vehicle', 'equipment', 'mount', '🚗', 'vehicle', 'Primary transportation. Maintain: oil changes every 5k mi, tire rotations, insurance current.', TRUE, NULL, 'stocked', NULL, 'HIGH'),
  ('dev-laptop', 'Development Laptop', 'equipment', 'tech-hardware', '💻', 'device', 'Primary workstation for software development and security practice. Keep OS & tools updated.', TRUE, NULL, 'stocked', NULL, 'HIGH'),
  ('kali-vm', 'Kali Linux VM', 'equipment', 'tech-hardware', '🐉', 'install', 'Attack OS for red team practice. VirtualBox/VMware. Core lab environment.', FALSE, NULL, 'stocked', NULL, 'HIGH'),
  ('burpsuite-pro', 'Burp Suite Pro', 'consumable', 'tech-hardware', '🕷️', 'license/yr', 'Web app pen testing — OWASP Top 10 scanning, proxy, intruder. OSCP prep essential.', FALSE, NULL, 'needed', '$449/yr', 'HIGH'),
  ('htb-vip', 'HackTheBox VIP+', 'consumable', 'tech-hardware', '🎯', 'subscription', 'Active machine access for red team skill building. OSCP practice lab.', FALSE, NULL, 'needed', '$14/mo', 'HIGH'),
  ('oscp-cert', 'OSCP Certification', 'consumable', 'tech-hardware', '🎓', 'course', 'OffSec Certified Professional — Phase 2/3 target. $1,499 exam + 90-day lab.', FALSE, NULL, 'needed', '$50/mo', 'HIGH'),
  ('bs-tent', 'MSR Hubba Hubba Tent', 'equipment', 'survivalist', '⛺', 'piece', '4-season 2-person tent. Core Phase 3 Dec 2026 purchase.', FALSE, NULL, 'needed', '$450–550', 'HIGH'),
  ('bs-sleep-bag', 'Marmot 20°F Sleeping Bag', 'equipment', 'survivalist', '🛏️', 'piece', '20°F rating. Cold-weather camping foundation. Dec 2026.', FALSE, NULL, 'needed', '$180–220', 'HIGH'),
  ('bs-sleep-pad', 'Therm-a-Rest NeoAir Pad', 'equipment', 'survivalist', '🏕️', 'piece', 'Insulated sleeping pad. Critical for cold ground insulation.', FALSE, NULL, 'needed', '$150–200', 'HIGH'),
  ('bs-pack', 'Osprey Atmos AG 65L', 'equipment', 'survivalist', '🎒', 'piece', '65L backpacking pack. Base layer for all wilderness trips.', FALSE, NULL, 'needed', '$250–300', 'HIGH'),
  ('bs-water-filter', 'Sawyer Squeeze Filter', 'equipment', 'survivalist', '💧', 'piece', 'Water filtration — removes 99.9999% bacteria/protozoa. No expiration.', FALSE, NULL, 'needed', '$30–50', 'HIGH'),
  ('bs-headlamp', 'Petzl Actik Core Headlamp', 'equipment', 'survivalist', '🔦', 'piece', 'Rechargeable headlamp 450 lm. Essential for camp navigation.', FALSE, NULL, 'needed', '$60–80', 'HIGH'),
  ('bs-fire-kit', 'Fire Starter Kit', 'equipment', 'survivalist', '🔥', 'kit', 'Ferro rod + tinder. Redundant fire source — do not rely on lighter only.', FALSE, NULL, 'needed', '$20–30', 'HIGH'),
  ('bs-multitool', 'Leatherman Wave+', 'equipment', 'survivalist', '🔧', 'piece', '18-tool multi-tool. EDC + camp utility.', FALSE, NULL, 'needed', '$100–120', 'MEDIUM'),
  ('bs-stove', 'MSR PocketRocket 2 Stove', 'equipment', 'survivalist', '🍳', 'piece', 'Ultralight camp stove + fuel canister. Boils 1L in 3.5 min.', FALSE, NULL, 'needed', '$45–60', 'MEDIUM'),
  ('bs-cookset', 'MSR Trail Lite Cookset', 'equipment', 'survivalist', '🥘', 'set', '2-pot cook set. 1L + 1.5L anodized aluminum. Packs inside pack.', FALSE, NULL, 'needed', '$60–80', 'MEDIUM'),
  ('bs-sat-comm', 'Garmin inReach Mini', 'equipment', 'survivalist', '📡', 'piece', 'Two-way satellite communicator + SOS. Phase 4 purchase Jun 2027.', FALSE, NULL, 'needed', '$350–400', 'HIGH'),
  ('bs-trekpoles', 'Trekking Poles', 'equipment', 'survivalist', '🥍', 'pair', 'Stability on rough terrain. Reduces knee impact ~25%. Phase 4.', FALSE, NULL, 'needed', '$80–150', 'MEDIUM')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE inventory_item_defaults IS
  'Catalog previously hardcoded in the frontend. Copied per user on GET /api/inventory. Not an XP source.';

CREATE TABLE IF NOT EXISTS inventory_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  slug                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('consumable', 'equipment')),
  category              TEXT NOT NULL CHECK (category IN (
                          'steel-supplement', 'recovery-gear', 'armor', 'weapon',
                          'mount', 'tech-hardware', 'survivalist')),
  icon                  TEXT NOT NULL,
  unit                  TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  equipped              BOOLEAN NOT NULL DEFAULT FALSE,
  level_requirement     INTEGER,
  stock_status          TEXT CHECK (stock_status IS NULL OR stock_status IN ('stocked', 'low', 'needed')),
  monthly_cost          TEXT,
  priority              TEXT CHECK (priority IS NULL OR priority IN ('HIGH', 'MEDIUM', 'LOW')),
  acquisition_quest_id  UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_user
  ON inventory_items (user_id);

ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_acquisition_quest_fk;
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_acquisition_quest_fk
  FOREIGN KEY (acquisition_quest_id) REFERENCES system_quests (id) ON DELETE SET NULL;

ALTER TABLE system_quests DROP CONSTRAINT IF EXISTS system_quests_inventory_item_fk;
ALTER TABLE system_quests
  ADD CONSTRAINT system_quests_inventory_item_fk
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_system_quests_inventory_item
  ON system_quests (inventory_item_id);

ALTER TABLE inventory_item_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_item_defaults_read ON inventory_item_defaults;
CREATE POLICY inventory_item_defaults_read ON inventory_item_defaults
  FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS inventory_items_owner_all ON inventory_items;
CREATE POLICY inventory_items_owner_all ON inventory_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE inventory_items IS
  'Per-user inventory. slug matches the old frontend ids and equipped_armor. acquisition_quest_id is the latest acquisition quest for this item. Clearing that quest sets stock_status to stocked. Costs and stock never grant XP.';
COMMENT ON COLUMN inventory_items.acquisition_quest_id IS
  'Back-pointer to the acquisition quest that stocks this item when cleared.';
COMMENT ON TABLE system_quests IS
  'Persistent System quests (daily, emergency, hidden, penalty, acquisition) issued to one user. XP is stored on the row or on acquisition milestones and awarded only by the server. Money columns never award XP.';
