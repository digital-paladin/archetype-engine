# Archetype System MCP server

stdio [MCP](https://modelcontextprotocol.io) server for Grok Bot (the System). It calls the live System API with the service credential. It does not award XP itself and it does not bypass backend validation.

The contract it follows is the one in draft [#37](https://github.com/digital-paladin/archetype-engine/pull/37) (`cursor/grok-bot-system-bridge-roadmap-6ee2`, the "Grok Bot System bridge" section at the end of `docs/SYSTEM-QUESTS.md`):

- The service credential is a `sys_` token, sent as `Authorization: Bearer`.
- That credential can call `/api/system/*` only. `isServicePathAllowed` in `backend/src/middleware/auth.middleware.ts` returns `403 service_key_scope` for every other path, including `POST /api/activities`.
- There is no `POST /api/system/events` yet. This server does not invent that route.

Casual social XP (2 XP, 8 XP weekly cap, week starts Sunday 00:00 America/Chicago) and the meeting rule (Developer XP only when `workTag` is `"tti"`) are specified in draft [#36](https://github.com/digital-paladin/archetype-engine/pull/36). They are not on `main`. This server does not apply them, and it does not log activities.

## Launch

From the repository root, after installing and building this package:

```bash
npm --prefix mcp/archetype-system ci
npm --prefix mcp/archetype-system run build
node mcp/archetype-system/dist/index.js
```

The process speaks MCP on stdin/stdout. Diagnostics go to stderr. The credential is never written to either stream.

Cursor (or another MCP host) can start it with:

```json
{
  "mcpServers": {
    "archetype-system": {
      "command": "node",
      "args": ["mcp/archetype-system/dist/index.js"],
      "env": {
        "ARCHETYPE_API_BASE_URL": "https://backend.example",
        "ARCHETYPE_SYSTEM_KEY_FILE": "~/.secrets/archetype_system_key"
      }
    }
  }
}
```

`args` is relative to the host's working directory. Use an absolute path to `dist/index.js` if the host does not start in the repository root.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `ARCHETYPE_API_BASE_URL` | yes | Backend origin only, for example `https://backend.example`. No path, query, hash, or userinfo. |
| `ARCHETYPE_SYSTEM_KEY` | one of these | The System service credential. A non-empty value wins over the file. |
| `ARCHETYPE_SYSTEM_KEY_FILE` | one of these | File that contains the credential. Defaults to `~/.secrets/archetype_system_key`. A leading `~` is expanded. |

The credential is the token minted in the app (**System** tab → **Grok Bot credential → Generate**), or via `POST /api/system/credentials` with a player session. It looks like `sys_` plus 64 lowercase hex characters. The server stores only a hash. Do not commit the token, paste it into a quest, or pass it as a tool argument.

Generate that token with a player session. A service credential cannot mint or revoke keys (`403 service_key_scope`).

## Tools

| Tool | Backend | What it does |
|---|---|---|
| `get_status` | `GET /api/system/status` | Level, current XP, and total XP per class. Rows are `className`, `level`, `currentXp`, `totalXp`. |
| `list_quests` | `GET /api/system/quests` | Optional `status` (`active`, `cleared`, `failed`, `expired`) and `includeHidden`. Listing runs deadline expiry first. |
| `get_quest` | `GET /api/system/quests/:id` | One quest. `id` is the quest UUID. Same hidden-quest masking as the list. |
| `complete_quest` | `POST /api/system/quests/:id/clear` | Status becomes `cleared`. The server pays the stored `xpReward`. The tool sends no body and accepts no XP amount. A second clear does not pay again. |
| `get_recent_messages` | `GET /api/system/messages` | Latest System-window messages. Optional `limit` from 1 to 100 (server default 50). |

`GET /api/system/status` was added so the System key can read class rows without calling `/api/character`. It reads `character_stats` for the credential's user and does not fall back to the markdown character sheet. It does not return the profile, birth date, or `rpg_stats` (the personal API key is stored there).

Quest clears still follow the rules already enforced by the System quest service (Thursday training rejection, recovery-only penalties, server-side XP). A `422` or `409` from the API is returned as a tool error with the backend `error` code. This server does not reinterpret it.

## Not wired (follow-ups)

These were considered and left out because the backend does not support them for a System credential. The server does not stub them with a tool that would look like it succeeded.

**`log_activity`.** [#37](https://github.com/digital-paladin/archetype-engine/pull/37) describes an ingest under `/api/system` (`source`, `idempotencyKey`, `verification`, and an explicit meeting work tag). That route is not implemented. The open questions there include the XP amount, where the audit row is stored, and the final name of the TTI field (`ttiWork` in that draft; `workTag: "tti"` in [#36](https://github.com/digital-paladin/archetype-engine/pull/36)). Calling `POST /api/activities` with the System key is `403`. On `main`, that route also does not read `workTag`, so it would not enforce the meeting rule even with a player session. This server does not compute XP and does not add the ingest route.

**`add_reflection`.** Nothing under `/api/system` stores a player reflection. `POST /api/system/messages` writes a System-window message and, for a service credential, stamps `source: "grokbot"`. That is the System speaking, not a reflection, so this server does not use it as one. Activity notes, food notes, and journal notes are outside `/api/system`. A non-blank check here would not persist anything.

**`get_recent_events`.** The bridge audit trail (accept, idempotent replay, and reject, with `source` and `verification`, and without the token or raw finance fields) is an open question in #37. `get_recent_messages` is the closest live read. It is the System window, which quest corrections already append to. It is not that audit log.

**Finance.** No tool reads or writes treasury rows, transactions, merchants, balances, or account numbers. This package does not add a Plaid client.

When the ingest route from #37 exists, `log_activity` should forward `source`, `idempotencyKey`, `verification`, and an optional work tag, and should still omit any XP amount so the backend remains the authority. Until #36 is on `main`, do not assume a meeting tag or the casual-social cap is enforced by `POST /api/activities`.
