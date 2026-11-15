# System quests

The System window is the player-facing half of a Solo Leveling style quest channel. Grok Bot (or any client holding a **service credential**) creates quests and messages. The app stores them per user, shows them in the `[SYSTEM]` window, and pays the XP that was stored on the quest. The request body cannot choose the XP.

Player sessions (login token or the personal API key from `GET /api/auth/api-key`) can call every endpoint. A service credential can call **only** `/api/system/*`, and it still cannot mint credentials or approve money rewards.

A draft roadmap for a Grok Bot event-ingestion contract is at the end of this file ([Grok Bot System bridge](#roadmap-grok-bot-system-bridge-draft)). It is not implemented. The routes in the tables below are the live System API.

## What Paul runs once

No new Railway environment variables. The API uses the Supabase keys already set on the backend (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`).

Apply the migration to that same Supabase project before the bot calls the API. The file is `010_system_quests.sql` because open PR #19 already uses `009_scheduled_indulgences.sql`. PRs #20–#25 do not add a migration.

1. Open the Supabase SQL editor for the project Railway uses.
2. Paste and run [`supabase/migrations/010_system_quests.sql`](../supabase/migrations/010_system_quests.sql).

That creates `system_quests`, `system_messages`, and `service_credentials` (RLS on, service role bypasses it).

Quest corrections (`PATCH /api/system/quests/:id`) need a second migration, [`011_system_quest_edits.sql`](../supabase/migrations/011_system_quest_edits.sql). It adds `system_quests.edits`. Railway auto-deploys the backend from `main` and does **not** run SQL, so apply `011` in the Supabase SQL editor (or with `apply-migration.js`) before the bot calls the correction route. Create, progress, clear, and fail keep working if `011` is not applied yet; the correction route will fail until the column exists.

Acquisition quests and database inventory need [`014_acquisition_quests_and_inventory.sql`](../supabase/migrations/014_acquisition_quests_and_inventory.sql). It adds the `acquisition` kind, the cents columns, `inventory_items`, and the seeded catalog. Apply it before those routes are used. The frontend inventory panel reads `GET /api/inventory` and is empty until this migration has been applied.

Alternatively, from a machine that has `DATABASE_URL` in `backend/.env`:

```bash
node backend/scripts/apply-migration.js supabase/migrations/010_system_quests.sql
```

Deploy this branch (Paul merges; do not push to `main`). The process then sweeps deadlines every minute.

## Generate and revoke the Grok Bot key

Log in to the app, open the **System** tab, and use **Grok Bot credential → Generate**. The raw token is shown once. It looks like `sys_` plus 64 hex characters. Store it as the bot's secret (for example `ARCHETYPE_SYSTEM_KEY`). The list afterwards shows only a prefix.

Revoke it from the same panel, or:

```bash
curl -X DELETE "$API/api/system/credentials/CREDENTIAL_ID" \
  -H "Authorization: Bearer $PLAYER_TOKEN"
```

A revoked key returns `401`. Creating another key does not revive the old one.

Player token for that call is the normal login access token. A service key that tries to generate or revoke a credential gets `403 service_key_scope` (credential routes) or `403 approval_required` (money rewards).

```bash
curl -X POST "$API/api/system/credentials" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Grok Bot","scopes":["system"]}'
```

`scopes` must be `["system"]`. The response is the only place `token` appears:

```json
{
  "success": true,
  "token": "sys_…",
  "credential": { "id": "…", "name": "Grok Bot", "tokenPrefix": "sys_ab12cd34", "scopes": ["system"], "revokedAt": null }
}
```

## API

Base URL is the backend origin. Send `Authorization: Bearer <token>` on every call.

| Method | Path | Who | Effect |
|---|---|---|---|
| `POST` | `/api/system/quests` | player or service | Create. `201` the first time, `200` with `idempotentReplay: true` when `idempotencyKey` repeats. |
| `GET` | `/api/system/quests?status=active` | player or service | List. Runs expiry first. Hidden quests are masked unless `includeHidden=true`. |
| `GET` | `/api/system/quests/:id` | player or service | One quest. Same masking. |
| `PATCH` | `/api/system/quests/:id/progress` | player or service | `{ objectiveId, progress?, done? }` on an **active** quest. Acquisition milestones pay their stored XP once here. |
| `PATCH` | `/api/system/quests/:id/budget` | player or service | Acquisition only. `{ targetCostCents?, amountSavedCents?, inventoryItemId? }` updates the money tracker. Response `xpApplied` is always `[]`. |
| `PATCH` | `/api/system/quests/:id` | player or service | Correct an **active** quest. See below. |
| `POST` | `/api/system/quests/:id/clear` | player or service | Status `cleared`. XP comes from the stored `xpReward` only. Second call does not pay again. |
| `POST` | `/api/system/quests/:id/fail` | player or service | Status `failed`. Subtracts `penalty.xpPenalty` once and creates `penalty.penaltyQuest` if present. |
| `POST` | `/api/system/quests/:id/reveal` | player or service | Unseals a hidden quest. |
| `POST` | `/api/system/quests/:id/reward-approval` | **player only** | `{ decision: "approved" \| "declined" }` for a money suggestion. |
| `POST` | `/api/system/messages` | player or service | `{ body, idempotencyKey?, questId? }` |
| `GET` | `/api/system/messages` | player or service | Latest messages. |
| `POST` | `/api/system/credentials` | **player only** | Mint a service key. |
| `GET` | `/api/system/credentials` | **player only** | List keys (no secret). |
| `DELETE` | `/api/system/credentials/:id` | **player only** | Revoke. |

Deadlines in the past expire during create, list, read, and the minute cron. Expiry uses the penalty, not the clear reward. Clearing, failing, or expiring a hidden quest reveals it so the result can be shown.

XP is applied with the same `character_stats` path as `POST /api/activities` (`XpCalculatorService.applyXPGain`, then `upsertCharacterStats`). Penalties floor the current level's XP at 0 and do not raise the level. Level-up and `system:notice` events go to the Socket.IO room `user:<userId>` only. The browser sends its login token in the socket `auth.token` handshake.

### Create body

```json
{
  "idempotencyKey": "daily:2026-10-20:mobility",
  "kind": "daily",
  "title": "Mobility walk",
  "description": "Twenty easy minutes outside.",
  "objectives": [{ "id": "walk", "label": "Walk 20 minutes", "target": 20 }],
  "deadline": "2026-10-21T04:00:00.000Z",
  "scheduledFor": "2026-10-20",
  "xpReward": { "Warrior": 40, "Sage": 10 },
  "rewardNote": "New running shoes — suggestion only",
  "rewardCostsMoney": true,
  "training": false,
  "penalty": {
    "recoveryType": "earlier_lights_out",
    "xpPenalty": { "Warrior": 15 },
    "penaltyQuest": {
      "title": "Lights out at 21:30",
      "recoveryType": "earlier_lights_out",
      "objectives": [{ "label": "In bed by 21:30" }]
    }
  }
}
```

`kind` is `daily`, `emergency`, `hidden`, `penalty`, or `acquisition`.

### Acquisition quests

`acquisition` is a long-term real-world goal (buying gear, a certification, a camping kit). It stays active until it is cleared or failed. A `deadline`, if you send one, is only a target date: the minute sweeper does **not** expire acquisition quests.

Money is bookkeeping, in integer USD cents:

- `targetCostCents` — what the goal costs
- `amountSavedCents` — how much is set aside so far

`PATCH /api/system/quests/:id/budget` changes those fields. It never awards XP. `budgetGrantsXp` on an acquisition quest is always `false`. Sending `xp` or `xpReward` on that route is `400`.

XP is paid for milestone progress. Put a class map on the objective (`objectives[].xpReward`). The server pays it **once**, when that objective first becomes done, through `PATCH …/progress`. The amount is the map you stored. It is not `progress`, not `target`, and not the cents saved. Quest-level `xpReward` is an optional completion bonus paid once on clear (the same rule as other kinds). An acquisition quest must have milestone XP, a completion bonus, or both. Dollars alone are rejected.

`inventoryItemId` (the row uuid) or `inventoryItemSlug` links the quest to a row in `inventory_items`. A System caller can instead send `inventoryItem` (the same body as `POST /api/inventory`) and the quest route creates the row, or reuses it when that slug already exists. Service credentials cannot call `/api/inventory`; inline `inventoryItem` keeps the create inside `/api/system`. Clearing the quest sets that item's `stockStatus` to `stocked`. Failing does not. The item link can be any category; tech-hardware is the usual one for a PC build.

Inventory itself is no longer hardcoded in the frontend. Migration `014_acquisition_quests_and_inventory.sql` seeds `inventory_item_defaults` with the previous catalog (Burp Suite Pro, OSCP, the survivalist camping pieces, armor, and the rest). `GET /api/inventory` copies any slug the player does not already have. `POST /api/inventory` creates a new item; the response `rowId` is what `inventoryItemId` stores. `id` on the item stays the slug so equip toggles keep working.

Apply [`014_acquisition_quests_and_inventory.sql`](../supabase/migrations/014_acquisition_quests_and_inventory.sql) before the bot creates an acquisition quest or the inventory panel loads from the API. Daily quests still insert if `014` is not applied yet, because those writes omit the new columns. The acquisition route will fail until the columns and `inventory_items` exist.

RTX 3090 rig, local AI build. The target is $1,800 (`180000` cents). Saving toward it does not pay XP. Each milestone has its own flat reward. There is no completion bonus in this example, so clear stocks the item and pays nothing more:

```json
{
  "idempotencyKey": "acquisition:rtx-3090-rig",
  "kind": "acquisition",
  "title": "RTX 3090 PC rig",
  "description": "Local AI build. Money tracked on this quest is not experience.",
  "targetCostCents": 180000,
  "amountSavedCents": 0,
  "inventoryItem": {
    "id": "rtx-3090-rig",
    "name": "RTX 3090 PC rig",
    "type": "equipment",
    "category": "tech-hardware",
    "icon": "🖥️",
    "unit": "rig",
    "description": "Local AI build.",
    "stockStatus": "needed",
    "priority": "HIGH"
  },
  "objectives": [
    { "id": "save-target", "label": "Savings goal reached", "target": 1, "xpReward": { "Financial Strategist": 25 } },
    { "id": "purchase-gpu", "label": "Purchase the RTX 3090", "target": 1, "xpReward": { "Developer": 40 } },
    { "id": "build", "label": "Assemble the rig", "target": 1, "xpReward": { "Developer": 60 } },
    { "id": "software", "label": "Bring up the local AI software", "target": 1, "xpReward": { "Developer": 80, "Sage": 20 } }
  ],
  "xpReward": {}
}
```

Mark "Savings goal reached" done only when the save is real — updating `amountSavedCents` to `180000` does not complete that objective and does not pay the 25 XP. Clear, after the milestones you actually finished, sets the rig to `stocked`. A player session can also create the item ahead of time with `POST /api/inventory` and pass `inventoryItemSlug` or `inventoryItemId` instead of `inventoryItem`.

```bash
curl -X PATCH "$API/api/system/quests/$QUEST_ID/budget" \
  -H "Authorization: Bearer $ARCHETYPE_SYSTEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amountSavedCents":45000}'
```

The service credential may update the budget. It still cannot approve a money reward (`reward-approval` stays player-only). A budget update is not a purchase approval.

`xpReward` and `xpPenalty` values are non-negative integers. The server decides the sign. A clear body like `{ "xp": 99999 }` is ignored.

`rewardCostsMoney: true` stores the note as a **suggestion** (`rewardApproval: "pending"`). Clearing still pays the class XP. The purchase happens only after the player presses Approve in the System window (or calls reward-approval with a player token).

### Rules the bot must follow

**Thursday rest day.** `scheduledFor` (or the deadline's America/Chicago calendar date, otherwise today in Chicago) must not be a Thursday when `training` is true. The API responds `422` `thursday_rest_day` with `flagged: true`. A service key cannot override this. If the title or description merely *looks* like training (`gym`, `workout`, `lifting`, `sparring`, `hiit`) the quest is still created and `thursdayTrainingFlag` is true so the window can show it.

**Penalties are recovery, not more training.** `penalty.recoveryType` and any penalty quest's `recoveryType` must be one of:

`earlier_lights_out`, `mobility`, `rest`, `walk`, `stretch`, `hydration`, `nutrition`, `sleep`, `meditation`, `sunlight`.

`training: true` on a penalty is `422` `penalty_must_be_recovery`.

### Examples

Create (bot):

```bash
curl -X POST "$API/api/system/quests" \
  -H "Authorization: Bearer $ARCHETYPE_SYSTEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"idempotencyKey":"daily:2026-10-20:mobility","kind":"daily","title":"Mobility walk","description":"Twenty easy minutes outside.","objectives":[{"id":"walk","label":"Walk 20 minutes","target":20}],"scheduledFor":"2026-10-20","xpReward":{"Warrior":40},"penalty":{"recoveryType":"mobility","xpPenalty":{"Warrior":10}}}'
```

Progress, then clear:

```bash
curl -X PATCH "$API/api/system/quests/$QUEST_ID/progress" \
  -H "Authorization: Bearer $ARCHETYPE_SYSTEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"objectiveId":"walk","progress":20}'

curl -X POST "$API/api/system/quests/$QUEST_ID/clear" \
  -H "Authorization: Bearer $ARCHETYPE_SYSTEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Fail (applies the penalty once):

```bash
curl -X POST "$API/api/system/quests/$QUEST_ID/fail" \
  -H "Authorization: Bearer $ARCHETYPE_SYSTEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Message:

```bash
curl -X POST "$API/api/system/messages" \
  -H "Authorization: Bearer $ARCHETYPE_SYSTEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"idempotencyKey":"msg:2026-10-20:wake","body":"The System is watching."}'
```

### Correct an active quest

`PATCH /api/system/quests/:id` changes an **active** quest in place. Cleared, failed, and expired quests return `409` `not_active`. The body is a partial correction. `idempotencyKey` is required and is unique per quest: sending it again returns `200` with `idempotentReplay: true`, the quest as it is now, and the original `changes`. The second body is ignored, and a second audit message is not posted.

```json
{
  "idempotencyKey": "edit:daily:2026-10-20:parkour",
  "reason": "Tuesday schedule changed: parkour 7:30-8:30 PM",
  "deadline": "2026-10-21T03:15:00.000Z",
  "objectives": {
    "update": [
      { "id": "last-bite", "label": "Last bite before 9:45 PM" },
      { "id": "lights-out", "label": "Lights out by 10:15 PM" }
    ],
    "add": [{ "id": "parkour", "label": "Parkour technique only", "target": 1 }],
    "remove": ["stretch"]
  },
  "penalty": {
    "penaltyQuest": {
      "title": "Lights out at 22:15",
      "objectives": [{ "id": "bed", "label": "In bed by 22:15" }]
    }
  }
}
```

Accepted fields: `title`, `description`, `deadline` (ISO timestamp, or `null` to clear; must be in the future), `objectives`, `xpReward`, `penalty`, `reason` (optional, up to 500 characters), `acknowledgeXpIncrease`.

`objectives.update` changes `label` and/or `target` on an existing id. Progress stays. A target below current progress is `409` `target_below_progress`. `objectives.add` starts at progress 0. `objectives.remove` only succeeds when that objective has no progress (`409` `objective_has_progress` otherwise). The quest must keep at least one objective and cannot exceed 20. Progress itself still goes through `PATCH …/progress`.

`penalty` adjusts an existing penalty: `recoveryType`, `xpPenalty`, and `penaltyQuest` title, description, or objectives. A quest with no penalty returns `409` `no_penalty`. Penalty quests stay recovery-type.

`xpReward` may be replaced. Lowering it is applied and written into the history. Raising it, or raising `penalty.xpPenalty`, without `acknowledgeXpIncrease: true` returns `422` `xp_increase_not_acknowledged` and changes nothing. With the flag, the history line says the increase was acknowledged. Clearing still pays whatever `xpReward` is stored after the correction. The request cannot change `kind`, `status`, `training`, rewards that cost money, or approval.

The response includes `changes` (human-readable lines) and the quest. `editedAt` is set, `editCount` increments, and `lastEditReason` is the latest `reason`. The System window shows an **EDITED** marker and the reason. A System message is stored on the quest with the same lines, so `GET /api/system/messages` is the audit trail. A sealed hidden quest still gets `editedAt`, but the message and the listed quest do not include the corrected text or the reason.

```bash
curl -X PATCH "$API/api/system/quests/$QUEST_ID" \
  -H "Authorization: Bearer $ARCHETYPE_SYSTEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"idempotencyKey":"edit:daily:2026-10-20:parkour","reason":"Tuesday schedule changed: parkour 7:30-8:30 PM","objectives":{"update":[{"id":"last-bite","label":"Last bite before 9:45 PM"},{"id":"lights-out","label":"Lights out by 10:15 PM"}],"add":[{"id":"parkour","label":"Parkour technique only","target":1}]}}'
```

Hidden quest (list masks `title`, `description`, objectives, rewards, and penalty until `POST …/reveal` or the quest is resolved):

```bash
curl -X POST "$API/api/system/quests" \
  -H "Authorization: Bearer $ARCHETYPE_SYSTEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"idempotencyKey":"hidden:door","kind":"hidden","title":"Secret Door Protocol","description":"Sealed.","objectives":[{"label":"Wait"}],"xpReward":{"Sage":15}}'
```

## Realtime

Connect Socket.IO to the backend origin with `auth: { token: "<login access token>" }`. Listen for `system:notice`:

```json
{ "type": "issued", "title": "Mobility walk", "detail": "Twenty easy minutes outside.", "questId": "…", "at": "…" }
```

`type` is `issued`, `progress`, `cleared`, `failed`, `expired`, `revealed`, `message`, or `edited`. The window pops a notice for everything except `progress`, and the nav badge counts active quests (including sealed ones). Anonymous sockets are not in a user room and do not receive these events.

Activity and consume log events are also sent to `user:<id>` rather than every connected client. The local character-sheet file watcher still broadcasts `character:updated` in dev, because that feed is not tied to a user id.

## Roadmap: Grok Bot System bridge (draft)

**Status:** Draft. Documentation only. Nothing in this section is implemented. It adds no route, migration, environment variable, or client.

**Phase:** Unnumbered. This repository has no roadmap file and no single phase sequence to continue. `backend/src/services/classTemplates.ts` mentions a file named `GAMIFICATION-UI-PUBLIC-ROADMAP` at Phase 3.2; that file is not in the tree. Other "Phase N" labels belong to one feature each (the Supabase migration, wearables, abstinence streaks, disciplined indulgence, OpenClaw). Which number this item should use, if any, is an open question.

### Goal

A documented, stable contract so Grok Bot can submit events and archetype-engine can award XP from those events without archetype-engine talking to Plaid, Toggl, Google Calendar, or Todoist for this bridge.

Grok Bot is the integration layer. It already acts as the System: it holds a service credential and calls `/api/system/*`. It already has read access to Plaid-linked finances, Toggl, Google Calendar, and Todoist. Those reads stay in Grok Bot. This repo does not grow a second copy of them.

### What exists today

There is no System event endpoint. A service credential that calls anything outside `/api/system` receives `403` `service_key_scope` (`isServicePathAllowed` in `backend/src/middleware/auth.middleware.ts`). `POST /api/activities` is one of those rejected paths, so the bot cannot log an activity with the System key.

The live authenticated System surface, all under `/api/system`, is:

| Method | Path | Relevant behavior |
|---|---|---|
| `POST` | `/api/system/quests` | Create. `201` the first time. `200` and `idempotentReplay: true` when the same `idempotencyKey` repeats. The second body is ignored. |
| `POST` | `/api/system/quests/:id/clear` | Pays the stored `xpReward` once. A clear body cannot change the XP. |
| `PATCH` | `/api/system/quests/:id` | Corrects an active quest. `idempotencyKey` is required. A replay does not post a second audit message. |
| `POST` | `/api/system/messages` | Stores a message. Same idempotency replay as create. |
| `GET` | `/api/system/messages` | The audit trail for quest corrections. |
| `POST` | `/api/system/consumption` | Requires `idempotencyKey` (1–200 characters, no newlines). |

`system_quests` and `system_messages` both have `UNIQUE (user_id, idempotency_key)` (`supabase/migrations/010_system_quests.sql`). Quest and message `source` is only `grokbot`, `user`, or `system`. That enum is who wrote the row. It is not the event source tag below (`plaid/finance`, `toggl`, `calendar`, `todoist`, `manual`). Do not reuse it for that.

The credential is a `sys_` token with `scopes: ["system"]`, minted from the System tab and stored by the bot as `ARCHETYPE_SYSTEM_KEY`. The raw token is shown once and is not committed. See [Generate and revoke the Grok Bot key](#generate-and-revoke-the-grok-bot-key).

XP from a cleared quest is applied with `persistClassXpAwards` onto `character_stats`. That function does not append `xp_history`. `xp_history` is a table the analytics routes read; this doc does not claim the live award path writes it.

Wearable workouts are a separate, already-shipped path. `backend/src/services/wearableActivityXp.service.ts` treats a wearable-logged physical activity as verified and awards Warrior XP from existing `XpCalculatorService` rates, once per dedupe tag. That path is not this contract.

`POST /api/activities` still accepts a player session and can persist client-supplied XP. It does not require a verification level. The rule for **this** contract is stricter: XP is awarded only for verified work. Changing `POST /api/activities` is not part of this item.

### Contract

The bridge needs one authenticated ingest endpoint on the System surface, so the existing service credential can call it. No such route exists. The working name is `POST /api/system/events`. The name is not final (see open questions). Auth stays `Authorization: Bearer` with the service credential or a player session. The user id comes from the credential, not from the body, same as quests.

Every accepted event has these fields:

| Field | Required | Rule |
|---|---|---|
| `source` | yes | One of `plaid/finance`, `toggl`, `calendar`, `todoist`, `manual`. |
| `idempotencyKey` | yes | Same limits as quests: 1–200 characters, no newlines. Unique per user. A repeat returns the original result and does not award XP again. A different body on the same key is ignored, matching quest create. |
| `verification` | yes | `verified-by-source` or `self-reported`. Only `verified-by-source` may award XP. `self-reported` may be stored and must not award XP. |
| `kind` | yes | One of the kinds listed for that source. Unknown kinds are rejected, not stored as a guess. |
| `occurredOn` | yes | The civil date the fact applies to (`YYYY-MM-DD`). Which timezone defines that date is an open question. Several existing rules use `America/Chicago`. |

`source: manual` is self-reported. If `verification` is `verified-by-source` on a `manual` event, reject it. A bot must not upgrade its own note into verified XP by setting the field.

The event body does not choose the XP amount. Quest **clear** already works that way (the stored `xpReward` is what gets paid). Quest **create** still accepts `xpReward` from the caller. This contract follows the clear rule, not the create rule. Who computes the number, and which class receives it, is an open question. Do not add new XP constants in order to fill that gap.

Illustrative only. These bodies are not an API. Field names other than `source`, `idempotencyKey`, and `verification` can still change.

```json
{
  "idempotencyKey": "finance:2026-10-27:no-spend-day",
  "source": "plaid/finance",
  "verification": "verified-by-source",
  "kind": "no-spend-day",
  "occurredOn": "2026-10-27"
}
```

```json
{
  "idempotencyKey": "calendar:2026-10-27:example-meeting",
  "source": "calendar",
  "verification": "verified-by-source",
  "kind": "meeting",
  "occurredOn": "2026-10-27",
  "ttiWork": true
}
```

`ttiWork` is a placeholder name. See open questions.

### Audit trail

Each accept, idempotent replay, and reject writes an audit record. The record includes the user id, the idempotency key, `source`, `verification`, `kind`, the outcome, and the time. If XP was awarded, it includes the class and the amount the server decided. It includes which credential was used, by credential id or prefix, never the token.

It does not include secrets, Plaid tokens, raw transactions, merchant names, balances, or account numbers. A rejected finance payload is recorded as a rejection, not stored in full.

The closest trail today is `system_messages` (`GET /api/system/messages`), which quest corrections already write. Credential rows also update `last_used_at`. Neither is an event audit log. Whether events append `system_messages`, a new table, or both is an open question.

### Finance scope

`source` is `plaid/finance`. Grok Bot reduces its own finance read to one of these facts. The engine stores the fact, not the books.

| `kind` | Fact |
|---|---|
| `no-spend-day` | That civil day was a no-spend day. |
| `weekly-budget-adherence` | That week met the budget. |
| `debt-payment-made` | A debt payment was made. |
| `savings-transfer-made` | A savings transfer was made. |

A finance event is rejected, and not stored, when the body contains any of:

- a raw transaction, or a list of transactions
- a merchant name
- a balance
- an account number, mask, or account id

Institution names, statement descriptors, and Plaid item or access tokens are the same class of data and are rejected too. Dollar amounts are omitted from the contract until the open question on amounts is answered. A payload that includes an amount is not a valid event under this draft.

This repo has no Plaid client and no Plaid environment variable. Do not add one. Do not add a Plaid fixture, sample export, or token placeholder.

The existing treasury (`/api/treasury`, manual entry and CSV import) stores `merchant` and `amount` on `spending_entries`. That path is player-entered. It is not this bridge, and this item does not change it. Whether those rows conflict with "never store raw financial data" is an open question.

### Other sources

**Toggl (`source: toggl`).** A verified session the bot already read. `kind` is `session`. The engine already calls Toggl during Fitbit Sport sync (`POST /api/fitbit/activities/sync`) when `TOGGL_API_TOKEN` is set, and uses the overlapping entry's project name or tag only to type that Sport row (`workout-mma`, `workout-strength`, `workout-mobility`, otherwise `workout-cardio`). That typing path stays as it is. A bridge event must not award XP a second time for a session the wearable sync already credited. How the two paths share a dedupe key is an open question. This item does not add Toggl calls.

**Calendar (`source: calendar`).** A verified calendar event. `kind` is `meeting`. There is no Google Calendar client in this repo. Meetings pay Developer XP only when they are explicitly tagged TTI work. The tag is not inferred from the title, description, or attendees. An untagged meeting does not pay Developer XP.

On `main` that gate is not enforced. `meetings-active` and `meetings-passive` are developer activity types and `frontend/src/app/activity-type-map.ts` maps both to `personal-project`. The Web App Developer quest label `Job (TTI)` (`backend/src/routes/quests.routes.ts`) is the in-repo name for that work. It is not a tag check on activities.

**Todoist (`source: todoist`).** A verified completion. `kind` is `completion`. The existing Todoist routes (`/api/todoist/*`, token `TODOIST_API_TOKEN`) create and close tasks. Closing a task there does not award XP. The bridge is the path that would. The idempotency key must distinguish one completion from a later re-completion so a reopen/close cycle cannot double-pay. This item does not add Todoist calls.

### Privacy and security

This repository is public.

- No secrets, tokens, Plaid keys, account numbers, real email addresses, street addresses, or raw financial exports in the repo, in docs, in fixtures, or in logs.
- Refer to the bot secret only by the name `ARCHETYPE_SYSTEM_KEY`. Refer to engine tokens only by names already in `backend/.env.example` (`TOGGL_API_TOKEN`, `TODOIST_API_TOKEN`, and the Supabase key names). Do not add a Plaid variable.
- The service credential stays a hash at rest (`service_credentials.token_hash`). The audit trail stores a prefix or id, not the secret.
- Examples in this section use a calendar date and generic labels. Do not replace them with a real meeting title, task title, merchant, or amount.

### Out of scope

- A direct Plaid integration, Plaid Link, or storing Plaid tokens. Plaid production approval is not pursued from this repo.
- Grok Bot's own clients for Plaid, Toggl, Google Calendar, and Todoist. They are not implemented here.
- Letting the event body set an XP amount.
- New XP rates. If a kind has no existing server rate, the amount stays an open question rather than a number invented in this doc.
- Rewriting the manual treasury, Fitbit Sport typing, wearable XP, Todoist task routes, or `POST /api/activities`.
- Shipping the endpoint, a migration, or tests in the pull request that adds this section.

### Open questions

- Which phase number, if any, this item should have. The referenced public roadmap file is not in the repo.
- Final path: `POST /api/system/events`, or another name under `/api/system`. Extending `isServicePathAllowed` beyond `/api/system` would widen the service credential. That is not assumed.
- Whether `plaid/finance` stays one tag (the slash is awkward in some enums) or becomes `finance`.
- Whether `verified-by-source` and `self-reported` are the full set. Wearable workouts are already described as verified on a different path. This draft does not map them onto this field.
- Which class each `kind` credits, and the server-side amount. Quest create lets the caller send `xpReward`. Wearable workouts use existing calculator rates. This draft picks neither, and it does not publish a number.
- Whether a finance fact may include a numeric aggregate (a ratio, a count) that is not a balance, a merchant, or an account number. Until that is decided, amounts are invalid.
- Timezone for `occurredOn`. `America/Chicago` is the candidate because Thursday rest, Toggl overlap, and wearable wall-clock times already use it. Not confirmed for this contract.
- Audit store: `system_messages`, a new table, or both. Also whether an award should append `xp_history`. The current `persistClassXpAwards` path does not.
- How a Toggl `session` event dedupes against a Fitbit Sport row already typed from Toggl and already awarded wearable XP.
- Which Toggl fields are safe to store (duration, project name, tag) and which are not.
- The field that marks a meeting as TTI work. `ttiWork` above is a placeholder. An unmerged draft pull request (#36) proposes `workTag: "tti"` or `tags` containing `"tti"` on `POST /api/activities`. That pull request is not on `main`, and this draft does not adopt its field.
- Whether an untagged meeting is stored as a non-Developer event, stored with zero XP, or rejected.
- Whether a Todoist event stores a task id only, or also a title. Titles can be personal. The id format is not specified here.
- Whether a self-reported event is stored for the audit trail or rejected. It must not award XP either way.
- How long audit rows are kept.
- Whether the existing in-engine `TOGGL_API_TOKEN` Sport-typing path and `TODOIST_API_TOKEN` task API should later be retired in favor of this bridge. This item does not retire them.
- Whether manual treasury rows (`merchant`, `amount`) should be constrained by the same raw-finance rule. This item does not migrate or delete them.
- What "done" means for a replay that follows a reject: the quest pattern ignores the second body. A client that fixes a rejected payload must use a new idempotency key. Confirm that is the rule here too.

### Acceptance criteria

This section being merged does not finish the item. The item is done when all of the following are true:

- [ ] The ingest route exists under `/api/system`, accepts the System service credential, and rejects a missing or revoked credential with `401`.
- [ ] A service credential still cannot call routes outside `/api/system`.
- [ ] `source` is required and is one of the five tags. Any other source is rejected.
- [ ] `idempotencyKey` is required. Repeating it for the same user returns the original outcome and does not award XP again, including two concurrent requests.
- [ ] `verification` is required. `self-reported` awards no XP. `manual` combined with `verified-by-source` is rejected.
- [ ] The body cannot set the XP amount. The server decides the amount, or it awards nothing when the amount is still an open question.
- [ ] An audit record is written for accept, replay, and reject. It has no token, no raw finance fields, and no PII beyond the user id the credential already implies.
- [ ] Finance events accept only the four kinds. A body with a transaction, merchant, balance, account number, or (until decided) a money amount is rejected and the forbidden fields are not stored.
- [ ] The repo still has no Plaid client, Plaid token, Plaid env var, or raw financial fixture.
- [ ] A calendar meeting awards Developer XP only when explicitly tagged TTI work. An untagged meeting does not.
- [ ] A Toggl session event does not double-count a session already awarded through wearable Sport sync. The dedupe rule is written down before the award ships.
- [ ] A Todoist completion event does not pay twice for the same completion, including a reopen and close.
- [ ] Keys in docs and in `.env.example` are names only. No new secret is added.
- [ ] Tests cover idempotent replay, self-reported no-XP, rejected raw finance, and TTI versus untagged meetings.
