# Archetype Engine

> *The life you want to live is a character build. This is the system that tracks whether you're actually building it.*

![Angular](https://img.shields.io/badge/Angular-21-red?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-black?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square)

---

## What Is This?

**Archetype Engine** is a self-hosted gamification system for people who want to design and track their own personal development — not follow someone else's.

Most productivity apps make you a **player** following rules someone else wrote.

This system makes you the **game designer and main character simultaneously.**

You define the archetype. The engine holds you accountable to it.

---

## The Core Idea

Strip away any specific skill set or aesthetic skin and what remains is:

> A system that takes **who you want to become**, breaks it into **measurable disciplines**, tracks **daily execution against those disciplines**, compounds progress through **streaks and consolidation mechanics**, and makes the gap between current self and target self **visible in real time.**

That's the engine. The archetype — your specific combination of skill trees, daily commitments, and identity target — is the configuration file you write.

The included **Paladin build** (Developer · Sage · Warrior · Artist · Redteamer · Financial Strategist · Bushcrafter · AI Architect) is one instance. You can configure it for any archetype:

| Example Archetype | Skill Trees |
|---|---|
| The Athlete | Fitness · Nutrition · Recovery · Mental Endurance |
| The Creator | Writing · Design · Content Production · Distribution |
| The Entrepreneur | Business Dev · Finance · Networking · Execution |
| The Technologist | Software Engineering · Security · AI/ML · System Design |
| The Renaissance Person | Any multi-discipline combination |

---

## Why This Exists

Most gamification apps fail in one of two ways:

**Too generic** — infinite flexibility, no identity anchor. Blank pages and abandoned systems within 30 days.

**Too prescriptive** — someone else's system. You're executing their vision of what a good life looks like.

This system occupies the gap: *you define the archetype, the system holds you accountable to it.*

**Five differentiators nothing else has:**

1. **Identity-first, not habit-first** — starts with "who do you want to *be*?", not "what do you want to *do*?" The skill trees and daily commitment matrix are identity anchors, not task lists.

2. **The decay mechanic is honest** — almost no productivity system models regression. Rust decay tracks skill degradation without practice at the exact rate it occurs. The system tells the truth where most apps are afraid to.

3. **Sleep as a performance multiplier** — sleep debt directly reduces XP consolidation percentage. Poor sleep following a disciplined day means less of that effort compounds. No mainstream app models this.

4. **Compounding math rewards long-term players** — consolidation tiers (Novice → Adept → Expert → Grandmaster) mean the system *accelerates* the longer you stay committed. This is the mechanic that makes RPGs addictive, applied to real skill mastery.

5. **23 months of live testing on one human being** — this was not designed in theory. It was built iteratively by the person running it: a full-time software engineer tracking discipline across training, deep work, and creative output simultaneously. The system sustains where habit apps don't because it was debugged from inside the constraint it was designed for.

---

## Features

### Core System
- **Skill trees with XP, leveling, and rust decay** — configurable class definitions, level thresholds, and XP formulas
- **Sleep consolidation multiplier** — Fitbit sleep score → consolidation % → XP applied to character
- **Action Consequence Matrix (ACM)** — 15 daily discipline checkboxes, weighted by resistance intensity
- **Streak tracking** — per-discipline streak counters with compound break warnings
- **XP projections** — analytics and forward-looking level projection graphs

### Dashboard
- **3D character model** — Three.js + Mixamo GLB with panel-triggered animations
- **Real-time updates** — edit your character sheet markdown → browser updates instantly via WebSocket
- **Quest log** — daily and long-arc quest tracking with autosave
- **Inventory + crafting system** — consumables that apply temporary buffs
- **Vault** — loot and reward catalog
- **Treasury** — financial discipline tracking
- **Analytics** — XP history, class breakdown, consolidation trends

### Integrations (optional)
- **Fitbit** — automatic sleep, nutrition, and vitality sync via OAuth 2.0
- **Todoist** — AI agent task creation and management
- **GitHub sync** — journal and character sheet backup via GitHub API

---

## Architecture

```
archetype-engine/
├── backend/                    Node.js · Express · TypeScript
│   ├── src/
│   │   ├── parser/             Reads character-sheet.md → CharacterData
│   │   ├── routes/             REST API (25+ endpoints)
│   │   │   ├── character       XP, levels, stats
│   │   │   ├── quests          Daily quest log
│   │   │   ├── action-log      ACM submission
│   │   │   ├── daily-metrics   Sleep, nutrition, fasting
│   │   │   ├── fitbit          OAuth + sync
│   │   │   ├── inventory       Consumables + vault
│   │   │   ├── treasury        Financial tracking
│   │   │   └── analytics       XP projection, history
│   │   ├── services/
│   │   │   ├── xpCalculator    Consolidation math + rust decay
│   │   │   ├── xpProjection    Forward XP simulation
│   │   │   ├── fitbit          Sleep/vitality OAuth service
│   │   │   ├── journalWriter   Safe field-level journal writes
│   │   │   └── fileWatcher     Chokidar → Socket.IO push
│   │   ├── middleware/         JWT auth
│   │   └── lib/supabase.ts     Supabase client
│   └── .env.example
│
└── frontend/                   Angular 21 · standalone components · signals
    └── src/app/
        ├── dashboard/          Root host, panel navigation, hotbar
        ├── character-panel/    Skill trees, level display, XP bars
        ├── acm-panel/          Action Consequence Matrix
        ├── quests-panel/       Daily quest log
        ├── sleep-panel/        Fitbit vitality + sleep debt
        ├── analytics/          XP history, projection charts
        ├── inventory/          Consumables, crafting, vault
        ├── three-character/    Three.js GLB + animation service
        └── ...                 20+ additional panels
```

**Data layer:** PostgreSQL via Supabase. Character stats, XP history, journal entries, ACM logs, and all sidecar data (vault, courage, spending, status effects) live in structured tables. Local markdown files remain the human-readable source of truth during the single-user phase.

---

## Authentication

Login uses **Supabase Auth** (email + password). The login screen also supports:

- **Try demo** — one-click session for a dedicated demo Hunter (no shared passwords; requires `DEMO_USER_ID` on the backend)
- **Abstinence counters** — ACM alcohol/sexual items as day streaks (`/api/abstinence/*`; apply migration `004_abstinence_streaks.sql`)
- **Forgot password** — sends a recovery email; link lands on `/auth/callback` → `/reset-password`
- **Magic link** — passwordless one-time sign-in email
- **Create account** — thin signup with birth date (Overall Level = chronological age)

**Live app:** use **Try demo** on the login page, or **Create account**. Do not publish demo credentials in this README.

### Supabase URL configuration (required)

In **Supabase Dashboard → Authentication → URL Configuration**:

| Field | Value |
|---|---|
| **Site URL** | Your frontend URL (e.g. `https://your-app.vercel.app`) |
| **Redirect URLs** | `https://your-app.vercel.app/auth/callback` |
| | `http://localhost:4200/auth/callback` (local dev) |

Set `FRONTEND_URL` in `backend/.env` to match your deployed frontend — this is embedded in reset/magic-link emails.

---

### Prerequisites
- Node.js 18+
- A Supabase project (free tier sufficient)
- Your `character-sheet.md` structured for this system

### 1. Clone and configure

```bash
git clone https://github.com/digital-paladin/archetype-engine
cd archetype-engine

cp backend/.env.example backend/.env
# Edit backend/.env — set your Supabase keys, file paths, and auth credentials
```

### 2. Backend

```bash
cd backend
npm install
npm run dev
```

Backend starts at `http://localhost:3000`

### 3. Frontend

```bash
cd frontend
npm install
npm start
```

Dashboard opens at `http://localhost:4200`

> **CORS note:** Set `CORS_ORIGIN=http://localhost:4200` in `backend/.env` for local development.

---

## Environment Variables

See [`backend/.env.example`](./backend/.env.example) for the full reference with descriptions.

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (backend only) | Service role key — never expose to frontend |
| `DEMO_USER_ID` | No (needed for Try demo) | UUID of dedicated demo Auth user — never the Owner |
| `CHARACTER_FILE_PATH` | Yes | Absolute path to your `character-sheet.md` |
| `JOURNAL_PATH` | Yes | Absolute path to your daily journal markdown |
| `AUTH_USERNAME` | Legacy | Unused when Supabase Auth is configured |
| `AUTH_PASSWORD` | Legacy | Unused when Supabase Auth is configured |
| `OWNER_EMAIL` | Yes (scripts) | Your Supabase auth email — used by seed/migrate scripts |
| `PLAYER_BIRTH_DATE` | No* | `YYYY-MM-DD` — Overall Character Level = chronological age. *Set on Railway; do not commit a real DOB. |
| `FITBIT_CLIENT_ID` | No | Enables automatic sleep/nutrition sync |
| `FITBIT_CLIENT_SECRET` | No | From [dev.fitbit.com](https://dev.fitbit.com) |
| `TODOIST_API_TOKEN` | No | Enables AI task creation via Todoist |

---

## Defining Your Archetype

Your archetype lives in two places:

**1. `character-sheet.md`** — the source of truth for your skill trees, XP, and history log. The backend parser reads section markers:

```markdown
[CURRENT-STATS-BEGIN]
### Developer (Level 20)
**Current XP:** 4,200 / 6,000
**Total Career XP:** 124,500
...
[CURRENT-STATS-END]

[HISTORY-LOG-BEGIN]
### Jan 1 -> Jan 2, 2026
- **Developer:** +54 XP (deep work session): 4,146 → **4,200**
...
[HISTORY-LOG-END]
```

**2. `backend/src/config/acm.config.ts`** — defines your 15 ACM items, their labels, and resistance weights.

**3. `backend/src/parser/characterParser.ts`** — defines which skill tree names to parse and their XP formulas.

See the parser source for the full list of supported markers.

---

## 3D Character

The character panel uses a Mixamo GLB model with animation blending via Three.js.

- Drop your `.glb` into `frontend/src/assets/`
- Register animations in `three-character.service.ts` → `loadExternalAnimations()`
- Use `playAnimation('idle', true)` — the service resolves registered aliases

**Adding an animation from Blender:** `File → Export → glTF 2.0` (select mesh + armature, apply modifiers) → copy to `frontend/src/assets/animations/` → register in the service.

---

## Fitbit Integration

1. Register at [dev.fitbit.com](https://dev.fitbit.com) — Personal App, OAuth 2.0
2. Set `FITBIT_CLIENT_ID`, `FITBIT_CLIENT_SECRET`, `FITBIT_REDIRECT_URI=http://localhost:3000/api/fitbit/callback`
3. Visit `http://localhost:3000/api/fitbit/auth` to authorize

The `/auth` and `/callback` routes are intentionally unprotected — OAuth redirects cannot carry a JWT.

---

## Database Setup

Run the migration script once after configuring your `.env`:

```bash
cd backend
npx ts-node --transpile-only src/scripts/migrate_to_supabase.ts
```

To re-seed character stats from your current character sheet:

```bash
npx ts-node --transpile-only src/scripts/seed_character_stats.ts
```

Both scripts require `OWNER_EMAIL` set in `.env`.

---

## Deployment

**Backend:** Designed for Railway. Set all `.env` variables as Railway environment variables. The filesystem is ephemeral — all persistent data must live in Supabase.

**Frontend:** Designed for Vercel.

- Runtime config: `frontend/public/env.js` sets `window.__ENV__.API_URL` (loaded from `index.html`).
- Build: `scripts/write-frontend-env.mjs` regenerates `env.js` from the Vercel env var `API_URL` (falls back to the Railway production URL if unset).
- `environment.prod.ts` also falls back to Railway — never to `localhost` — so a missing `__ENV__` cannot break login again.
- Optional Vercel env: `API_URL=https://digital-paladin-gamification-system-production.up.railway.app`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21 (standalone components, signals) |
| 3D rendering | Three.js + Mixamo GLB |
| Backend | Node.js 18 · Express · TypeScript |
| Database | PostgreSQL via Supabase |
| Real-time | Socket.IO WebSocket |
| File watching | Chokidar |
| Auth | Supabase Auth + JWT middleware |
| Testing | Jest (backend) · Karma/Jasmine (frontend) · Playwright (e2e) |
| CI | GitHub Actions |

---

## Forking for Your Own Archetype

This repo is designed to be forked and reconfigured:

1. Fork `digital-paladin/archetype-engine`
2. Define your skill trees in `characterParser.ts`
3. Define your ACM items in `acm.config.ts`
4. Write your `character-sheet.md` following the marker format
5. Swap the GLB model for your character
6. Deploy backend to Railway, frontend to Vercel

The Paladin build is the default configuration. The engine is yours.

---

## License

MIT — fork, adapt, and build your own archetype.

---

*Built and battle-tested over 23+ months of continuous operation. The system works because it was built from inside the constraint it was designed for.*

<!-- vercel-redeploy: 2026-07-13T18:54Z -->
