# System quests

The System window is the player-facing half of a Solo Leveling style quest channel. Grok Bot (or any client holding a **service credential**) creates quests and messages. The app stores them per user, shows them in the `[SYSTEM]` window, and pays the XP that was stored on the quest. The request body cannot choose the XP.

Player sessions (login token or the personal API key from `GET /api/auth/api-key`) can call every endpoint. A service credential can call **only** `/api/system/*`, and it still cannot mint credentials or approve money rewards.

## What Paul runs once

No new Railway environment variables. The API uses the Supabase keys already set on the backend (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`).

Apply the migration to that same Supabase project before the bot calls the API. The file is `010_system_quests.sql` because open PR #19 already uses `009_scheduled_indulgences.sql`. PRs #20–#25 do not add a migration.

1. Open the Supabase SQL editor for the project Railway uses.
2. Paste and run [`supabase/migrations/010_system_quests.sql`](../supabase/migrations/010_system_quests.sql).

That creates `system_quests`, `system_messages`, and `service_credentials` (RLS on, service role bypasses it).

Quest corrections (`PATCH /api/system/quests/:id`) need a second migration, [`011_system_quest_edits.sql`](../supabase/migrations/011_system_quest_edits.sql). It adds `system_quests.edits`. Railway auto-deploys the backend from `main` and does **not** run SQL, so apply `011` in the Supabase SQL editor (or with `apply-migration.js`) before the bot calls the correction route. Create, progress, clear, and fail keep working if `011` is not applied yet; the correction route will fail until the column exists. The frontend on Vercel does not need a database change.

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
| `PATCH` | `/api/system/quests/:id/progress` | player or service | `{ objectiveId, progress?, done? }` on an **active** quest. |
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

`kind` is `daily`, `emergency`, `hidden`, or `penalty`.

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
