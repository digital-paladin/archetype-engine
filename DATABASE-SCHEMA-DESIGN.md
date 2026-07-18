# Archetype Engine — Database Schema Design
**Phase 0 Deliverable** · Generated May 15, 2026

This document is the output of the Phase 0 foundation audit. It catalogs every file system
dependency in the current backend, maps all env variables to their multi-tenant fate, and
defines the target PostgreSQL schema for Phase 1.

---

## Part 1 — File System Audit

### 1.1 Primary Markdown Files (source of truth)

| File | Env Var | Read by | Written by |
|------|---------|---------|------------|
| `character-sheet.md` | `CHARACTER_FILE_PATH` | `archiveReader.service.ts`, `character.routes.ts` (×3), `characterProjection.routes.ts` | `githubSync.service.ts` (pull only) |
| `daily manual journal compendium.md` | `JOURNAL_PATH` | `journalWriter.service.ts` (×9), `quests.routes.ts` (×3), `actionLog.routes.ts` (×2), `acm.routes.ts`, `consume.routes.ts`, `dailyMetrics.routes.ts` (×3), `activity.routes.ts` | `journalWriter.service.ts` (×8), `quests.routes.ts` (×2), `consume.routes.ts`, `dailyMetrics.routes.ts`, `actionLog.routes.ts` |

### 1.2 JSON Sidecar Files (derived/operational data)

| File | Env Var | Service | Read | Written |
|------|---------|---------|------|---------|
| `vault.json` | `VAULT_PATH` | `vault.service.ts` | readFileSync | writeFileSync |
| `activity-log.json` | `ACTIVITY_LOG_PATH` | `activityLogStore.ts` | readFileSync | writeFileSync |
| `courage-data.json` | `COURAGE_PATH` | `courage.service.ts` | readFileSync | writeFileSync |
| `rewards-catalog.json` | `REWARDS_CATALOG_PATH` | `rewardsCatalog.service.ts` | readFileSync | writeFileSync |
| `status-effects.json` | `STATUS_EFFECTS_PATH` | `statusEffects.service.ts` | readFileSync | writeFileSync |
| `spending.json` | `SPENDING_PATH` | `treasury.routes.ts` | readFileSync | writeFileSync |
| `fitbit-tokens.json` | `FITBIT_TOKEN_PATH` | `fitbit.service.ts` | readFile | writeFile |

### 1.3 ⚠️ High-Risk Routes (bypass JournalWriterService)

These routes call `fs.writeFile(JOURNAL_PATH, ...)` directly, skipping the safe write path.
In the current single-user build they also require a manual `githubSync.scheduleSync()` call.
In the multi-tenant build they must be migrated to `IDataService.upsertJournalEntry()` first.

| Route | Lines | Risk |
|-------|-------|------|
| `quests.routes.ts` | 336, 392 | Direct overwrite of entire journal file |
| `consume.routes.ts` | 175 | Direct overwrite of entire journal file |
| `dailyMetrics.routes.ts` | 225 | Direct overwrite of entire journal file |

Routes using `JournalWriterService` (safe pattern, already call `scheduleSync`):
- `fitbit.routes.ts`, `fasting.routes.ts`, `activity.routes.ts`

---

## Part 2 — Environment Variable Fate

### 2.1 Env vars → DB columns (remove from .env in multi-tenant)

| Env Var | Current Use | Multi-Tenant Replacement |
|---------|-------------|--------------------------|
| `CHARACTER_FILE_PATH` | Path to character-sheet.md | `users.id` → `character_stats` table |
| `JOURNAL_PATH` | Path to journal compendium | `users.id` → `daily_journal_entries` table |
| `JOURNAL_PATH_BUNDLED` | Railway volume seed | Remove — no file seeding in multi-tenant |
| `AUTH_USERNAME` | Single-user login | `users.email` (Supabase Auth) |
| `AUTH_PASSWORD` | Single-user password | `users.password_hash` (Supabase Auth handles) |
| `AUTH_TOKEN` | JWT signing secret | Supabase JWT (managed) |
| `VAULT_PATH` | vault.json path | `vault_items` table |
| `ACTIVITY_LOG_PATH` | activity-log.json | `activity_log` table |
| `COURAGE_PATH` | courage-data.json | `courage_entries` table |
| `REWARDS_CATALOG_PATH` | rewards-catalog.json | `rewards_catalog` table |
| `STATUS_EFFECTS_PATH` | status-effects.json | `active_status_effects` table |
| `SPENDING_PATH` | spending.json | `spending_entries` table |
| `FITBIT_TOKEN_PATH` | fitbit-tokens.json | `fitbit_tokens` table |
| `FITBIT_ACCESS_TOKEN` | Token fallback (legacy) | `fitbit_tokens.access_token_encrypted` |
| `FITBIT_REFRESH_TOKEN` | Token fallback (legacy) | `fitbit_tokens.refresh_token_encrypted` |
| `PLAYER_BIRTH_DATE` | Age calculation in parser | `users.birth_date` column |
| `GITHUB_JOURNAL_PATH` | GitHub sync source path | Remove — no file sync in multi-tenant |
| `GITHUB_CHARACTER_SHEET_PATH` | GitHub sync source path | Remove — no file sync in multi-tenant |

### 2.2 Env vars that stay (global config, not per-user)

| Env Var | Stays Because |
|---------|--------------|
| `FITBIT_CLIENT_ID` | OAuth app credential — global, not per-user |
| `FITBIT_CLIENT_SECRET` | OAuth app credential — global |
| `FITBIT_REDIRECT_URI` | OAuth callback URL — global |
| `GITHUB_TOKEN` | Service account token — global |
| `GITHUB_OWNER` | Repo owner — global |
| `GITHUB_REPO` | Repo name — global |
| `GITHUB_BRANCH` | Branch — global |
| `PORT` | Server config |
| `CORS_ORIGIN` | Server config |
| `NODE_ENV` | Runtime environment |
| `DATABASE_URL` | NEW — Supabase PostgreSQL connection string |
| `SUPABASE_URL` | NEW — Supabase project URL |
| `SUPABASE_ANON_KEY` | NEW — Supabase public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | NEW — Supabase admin key (backend only) |

---

## Part 3 — Database Decision

**Chosen: Supabase (PostgreSQL)**

| Requirement | Supabase Answer |
|------------|----------------|
| PostgreSQL (standard SQL) | ✅ Yes |
| Built-in auth (email + OAuth) | ✅ Supabase Auth |
| Row Level Security | ✅ Native RLS policies |
| Free tier | ✅ 500MB, 50k MAU |
| Railway connectivity | ✅ Standard PostgreSQL connection string |
| Encryption at rest | ✅ AES-256 by default |
| Client SDK (TypeScript) | ✅ `@supabase/supabase-js` |
| Realtime subscriptions | ✅ (can replace some Socket.IO patterns later) |

**Spike test result:** Railway can connect to Supabase via `DATABASE_URL` as a standard
PostgreSQL connection. No special configuration needed — same as connecting to any Postgres.

---

## Part 4 — Target Schema (ERD)

### Core

```sql
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT UNIQUE NOT NULL,
  birth_date            DATE,
  tier                  TEXT NOT NULL DEFAULT 'free'
                        CHECK (tier IN ('free', 'paladin', 'shadow_monarch')),
  created_at            TIMESTAMPTZ DEFAULT now(),
  openclaw_gateway_url  TEXT  -- Phase 3.4 — OpenClaw push delivery target
);

CREATE TABLE subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id  TEXT UNIQUE,
  status              TEXT NOT NULL DEFAULT 'inactive',
  current_period_end  TIMESTAMPTZ
);
```

### Character Progression (replaces character-sheet.md)

```sql
CREATE TABLE character_stats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_name  TEXT NOT NULL,  -- 'warrior' | 'developer' | 'sage' | 'artist' | 'redteamer' | 'financial_strategist' | 'survivalist'
  level       INT NOT NULL DEFAULT 1,
  current_xp  NUMERIC NOT NULL DEFAULT 0,
  total_xp    NUMERIC NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, class_name)
);

CREATE TABLE skill_tree_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_name   TEXT NOT NULL,
  skill_name   TEXT NOT NULL,
  skill_level  INT NOT NULL DEFAULT 0,
  xp           NUMERIC NOT NULL DEFAULT 0,
  unlocked_at  TIMESTAMPTZ,
  UNIQUE (user_id, class_name, skill_name)
);

CREATE TABLE xp_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  earned_at    DATE NOT NULL,
  class_name   TEXT NOT NULL,
  xp_pending   NUMERIC NOT NULL DEFAULT 0,
  xp_confirmed NUMERIC NOT NULL DEFAULT 0,
  consolidation_pct  NUMERIC,  -- e.g. 107.5
  fitbit_score INT,
  streak_days  INT,
  notes        TEXT
);
```

### Journal (replaces daily manual journal compendium.md)

```sql
CREATE TABLE daily_journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date      DATE NOT NULL,
  sleep_hours     NUMERIC,
  sleep_start     TIME,
  sleep_end       TIME,
  fitbit_score    INT,
  fasting_hours   NUMERIC,
  hydration_oz    NUMERIC,
  protein_level   TEXT CHECK (protein_level IN ('low', 'medium', 'high')),
  food_quality    TEXT CHECK (food_quality IN ('poor', 'mixed', 'mixed/good', 'good', 'excellent')),
  calories_status TEXT CHECK (calories_status IN ('deficit', 'maintenance', 'surplus')),
  stress_level    TEXT CHECK (stress_level IN ('low', 'medium', 'high')),
  energy_score    INT CHECK (energy_score BETWEEN 1 AND 10),
  mental_state    TEXT,
  notes           TEXT,
  ai_summary      TEXT,  -- Shadow Monarch tier, encrypted at rest
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, entry_date)
);

CREATE TABLE acm_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id  UUID NOT NULL REFERENCES daily_journal_entries(id) ON DELETE CASCADE,
  item_index        INT NOT NULL CHECK (item_index BETWEEN 0 AND 14),  -- 15 ACM items (0-based)
  completed         BOOLEAN NOT NULL DEFAULT false,
  completed_at      TIMESTAMPTZ,
  UNIQUE (journal_entry_id, item_index)
);

CREATE TABLE quest_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date   DATE NOT NULL,
  class_name   TEXT NOT NULL,
  quest_label  TEXT NOT NULL,
  content      TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, entry_date, class_name, quest_label)
);
```

### Activity & Operations (replaces JSON sidecars)

```sql
CREATE TABLE activity_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_at      TIMESTAMPTZ DEFAULT now(),
  class_name     TEXT NOT NULL,
  activity_type  TEXT NOT NULL,
  duration_hours NUMERIC,
  xp_awarded     NUMERIC,
  notes          TEXT
);

CREATE TABLE vault_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_name    TEXT NOT NULL,
  quantity     INT NOT NULL DEFAULT 1,
  rarity       TEXT CHECK (rarity IN ('normal', 'fine', 'superior', 'epic', 'legendary')),
  acquired_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE courage_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date  DATE NOT NULL,
  score       INT,
  notes       TEXT,
  UNIQUE (user_id, entry_date)
);

CREATE TABLE active_status_effects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effect_name  TEXT NOT NULL,
  applied_at   TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  magnitude    NUMERIC
);

CREATE TABLE rewards_catalog (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name      TEXT UNIQUE NOT NULL,
  description    TEXT,
  rarity         TEXT,
  cost_xp        NUMERIC,
  tier_required  TEXT NOT NULL DEFAULT 'free'
);

CREATE TABLE spending_entries (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spent_at  DATE NOT NULL,
  category  TEXT,
  amount    NUMERIC,
  notes     TEXT
);
```

### OAuth Tokens (replaces JSON token files)

```sql
-- Fitbit (current) — will be merged into wearable_tokens in Phase 2.5
CREATE TABLE fitbit_tokens (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  access_token_encrypted   TEXT NOT NULL,
  refresh_token_encrypted  TEXT NOT NULL,
  expires_at               TIMESTAMPTZ,
  scope                    TEXT
);

-- Future wearables (Oura, WHOOP, Garmin — Phase 2.5)
CREATE TABLE wearable_tokens (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL CHECK (provider IN ('fitbit', 'oura', 'whoop', 'garmin')),
  access_token_encrypted   TEXT NOT NULL,
  refresh_token_encrypted  TEXT NOT NULL,
  expires_at               TIMESTAMPTZ,
  scope                    TEXT,
  UNIQUE (user_id, provider)
);
```

### Row Level Security (RLS) Policies

```sql
-- Enable RLS on all user-data tables
ALTER TABLE character_stats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_tree_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_history               ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_journal_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE acm_entries              ENABLE ROW LEVEL SECURITY;
ALTER TABLE quest_entries            ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE courage_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_status_effects    ENABLE ROW LEVEL SECURITY;
ALTER TABLE spending_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitbit_tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wearable_tokens          ENABLE ROW LEVEL SECURITY;

-- Pattern: users can only see their own rows
-- Replace 'character_stats' with each table name
CREATE POLICY "users_own_data" ON character_stats
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- rewards_catalog is public read (no RLS — shared catalog)
-- spending_entries: extra encryption recommended (financial data)
```

---

## Part 5 — IDataService Adapter

The adapter pattern decouples all routes/services from the storage backend. Phase 1 implements
`SupabaseDataService`. A `FileDataService` wrapper (reads current files) can run in parallel
during migration to allow incremental cutover.

```typescript
// backend/src/services/data/IDataService.ts

export interface IDataService {
  // Character
  getCharacterStats(userId: string): Promise<CharacterStats[]>;
  upsertCharacterStats(userId: string, stats: Partial<CharacterStats>): Promise<void>;
  getXPHistory(userId: string, limit?: number): Promise<XPHistoryEntry[]>;
  appendXPHistory(userId: string, entry: XPHistoryEntry): Promise<void>;

  // Journal
  getJournalEntry(userId: string, date: string): Promise<JournalEntry | null>;
  upsertJournalEntry(userId: string, entry: Partial<JournalEntry>): Promise<void>;

  // ACM
  getACMEntries(userId: string, date: string): Promise<ACMEntry[]>;
  updateACMEntries(userId: string, date: string, items: boolean[]): Promise<void>;

  // Quests
  getQuestEntries(userId: string, date: string): Promise<QuestEntry[]>;
  upsertQuestEntry(userId: string, date: string, className: string, label: string, content: string): Promise<void>;

  // Activity
  logActivity(userId: string, activity: Omit<ActivityEntry, 'id'>): Promise<void>;
  getActivityLog(userId: string, limit?: number): Promise<ActivityEntry[]>;

  // Vault
  getVaultItems(userId: string): Promise<VaultItem[]>;
  upsertVaultItem(userId: string, item: Partial<VaultItem>): Promise<void>;

  // Fitbit tokens
  getFitbitTokens(userId: string): Promise<FitbitTokens | null>;
  saveFitbitTokens(userId: string, tokens: FitbitTokens): Promise<void>;
}

// Current:  new FileDataService(process.env.JOURNAL_PATH, process.env.CHARACTER_FILE_PATH)
// Phase 1:  new SupabaseDataService(supabaseClient)
// Both implement IDataService — routes don't change
```

---

## Part 6 — Migration Path by Data Type

| Data Type | Current | Phase 1 Migration | Priority |
|-----------|---------|-------------------|----------|
| User auth | `.env` AUTH_USERNAME/PASSWORD | Supabase Auth (email + OAuth) | 🔴 P0 |
| Character stats | Parsed from `character-sheet.md` | `character_stats` table, seeded from parser | 🔴 P0 |
| Daily metrics | Parsed from journal markdown | `daily_journal_entries` table | 🔴 P0 |
| ACM checkboxes | Parsed from journal markdown | `acm_entries` table | 🔴 P0 |
| Quest log | Parsed from journal markdown | `quest_entries` table | 🔴 P0 |
| Activity log | `activity-log.json` | `activity_log` table | 🟡 P1 |
| Fitbit tokens | `fitbit-tokens.json` | `fitbit_tokens` table | 🟡 P1 |
| Vault / inventory | `vault.json` | `vault_items` table | 🟡 P1 |
| XP history | Parsed from character-sheet.md history section | `xp_history` table | 🟡 P1 |
| Courage entries | `courage-data.json` | `courage_entries` table | 🟠 P2 |
| Status effects | `status-effects.json` | `active_status_effects` table | 🟠 P2 |
| Spending | `spending.json` | `spending_entries` table | 🟠 P2 |
| Rewards catalog | `rewards-catalog.json` | `rewards_catalog` table (shared) | 🟠 P2 |
| Skill trees | Parsed from character-sheet.md | `skill_tree_entries` table | 🟠 P2 |
| AI narrative summaries | Not yet implemented | `daily_journal_entries.ai_summary` (encrypted) | 🔵 P3 |

---

## Part 7 — GitHub Sync Retirement Plan

`githubSync.service.ts` currently syncs markdown files to/from a GitHub repo as a persistence
backup (since Railway's filesystem is ephemeral). Once Phase 1 is complete:

| Component | Fate |
|-----------|------|
| `githubSync.service.ts` | **Retire** — Supabase is the persistence layer |
| `volumeSeed.service.ts` | **Retire** — no more file seeding |
| `archiveReader.service.ts` | **Retire** — no more archive directory needed |
| `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` | **Remove from .env** |
| `GITHUB_JOURNAL_PATH`, `GITHUB_CHARACTER_SHEET_PATH` | **Remove from .env** |
| Character sheet markdown | **Becomes read-only historical reference** — not deleted, just no longer the source of truth |

---

## Part 8 — Phase 1 Work Breakdown (from this audit)

### Sprint 1 — Infrastructure (est. 8 hrs)
- [ ] Create Supabase project, get `DATABASE_URL` + anon key
- [ ] Install `@supabase/supabase-js` in backend
- [ ] Run all CREATE TABLE statements above (in order — respect foreign keys)
- [ ] Enable RLS on all user-data tables
- [ ] Apply RLS policy pattern to each table
- [ ] Add `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` to `.env`
- [ ] Verify Railway can connect (test `SELECT 1`)

### Sprint 2 — Auth Migration (est. 6 hrs)
- [ ] Replace `AUTH_USERNAME`/`AUTH_PASSWORD`/`AUTH_TOKEN` with Supabase Auth
- [ ] Update `auth.routes.ts` — POST `/api/auth/login` → Supabase `signInWithPassword()`
- [ ] Update `auth.middleware.ts` — verify Supabase JWT instead of custom token
- [ ] Seed single user (yourself) via Supabase dashboard
- [ ] Test: login → JWT → protected route works

### Sprint 3 — IDataService Scaffold (est. 8 hrs)
- [ ] Create `backend/src/services/data/IDataService.ts` with full interface
- [ ] Create `backend/src/services/data/SupabaseDataService.ts` (stub all methods)
- [ ] Create `backend/src/services/data/FileDataService.ts` (wrap existing fs reads)
- [ ] Wire `FileDataService` as default — zero behavior change, confirms interface compiles
- [ ] Add `userId` extraction from JWT to all routes (from Supabase session)

### Sprint 4 — Journal Migration (est. 12 hrs) — highest impact
- [ ] Implement `SupabaseDataService.getJournalEntry()` + `upsertJournalEntry()`
- [ ] Implement `getACMEntries()` + `updateACMEntries()`
- [ ] Implement `getQuestEntries()` + `upsertQuestEntry()`
- [ ] Migrate `journalWriter.service.ts` → call `IDataService` methods
- [ ] Migrate the 3 high-risk routes (`quests`, `consume`, `dailyMetrics`) → `IDataService`
- [ ] Migrate `acm.routes.ts`, `actionLog.routes.ts`, `activity.routes.ts`
- [ ] Seed current journal data via a one-time migration script
- [ ] **Remove `githubSync.scheduleSync()` calls** (Supabase handles persistence)
- [ ] Test all journal-touching routes end-to-end

### Sprint 5 — Character Sheet Migration (est. 10 hrs)
- [ ] Implement `SupabaseDataService.getCharacterStats()` + `upsertCharacterStats()`
- [ ] Write one-time `seedCharacterSheet.ts` script — runs `characterParser.ts` → inserts into DB
- [ ] Migrate `character.routes.ts` → call `IDataService`
- [ ] Migrate `characterProjection.routes.ts`
- [ ] Retire `archiveReader.service.ts`, `githubSync.service.ts`, `volumeSeed.service.ts`
- [ ] Remove all `CHARACTER_FILE_PATH` references

### Sprint 6 — JSON Sidecars Migration (est. 8 hrs)
- [ ] Migrate `vault.service.ts` → `vault_items` table
- [ ] Migrate `activityLogStore.ts` → `activity_log` table
- [ ] Migrate `fitbit.service.ts` token handling → `fitbit_tokens` table (encrypted)
- [ ] Migrate `courage.service.ts` → `courage_entries` table
- [ ] Migrate `rewardsCatalog.service.ts` → `rewards_catalog` table
- [ ] Migrate `statusEffects.service.ts` → `active_status_effects` table
- [ ] Migrate `treasury.routes.ts` → `spending_entries` table

**Total Phase 1 estimate: ~52 hrs (6–7 weeks at 1 session/week)**
