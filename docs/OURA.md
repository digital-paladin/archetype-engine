# Oura

Oura is connected with the OAuth 2.0 authorization-code flow. The backend stores the access token and rotating refresh token encrypted, then reads one civil day's sleep, readiness, and activity summaries. Personal access tokens were deprecated in December 2025 and this app does not accept them.

The code paths below were tested with synthetic HTTP fixtures. Nothing in this repository was authorized against a live Oura account, and no Oura application was registered from here.

## What the app requests

Official reference used for this integration: [Oura API v2](https://cloud.ouraring.com/v2/docs) and the [authentication](https://cloud.ouraring.com/docs/authentication) page.

| Item | Value |
|---|---|
| Authorization URL | `https://cloud.ouraring.com/oauth/authorize` |
| Token URL | `https://api.ouraring.com/oauth/token` |
| API base | `https://api.ouraring.com/v2/usercollection` |
| Scope | `daily` only |

`daily` is the official scope for daily summaries of sleep, activity, and readiness. The app does not request `email`, `personal`, `heartrate`, `workout`, `tag`, `session`, or `spo2`.

Access tokens are short-lived (Oura's docs say typically 24 hours). Each refresh stores the new access token and, when Oura returns one, the new refresh token. A refresh that comes back `invalid_grant` or HTTP 400/401 deletes that user's tokens and marks the connection revoked.

## What gets stored

For the signed-in user and one `YYYY-MM-DD` day:

- **Sleep score** from `daily_sleep`. That document does not include durations. Contributor values such as `total_sleep` are 0–100 scores, not seconds.
- **Sleep duration and bedtime** from `sleep`, preferring `type=long_sleep`. Naps are counted and are not added into the night. `deleted` and `rest` periods are ignored. Heart-rate samples and movement strings are not stored. If Oura refuses `/sleep`, the day is stored as partial and the daily sleep score is kept.
- **Readiness** from `daily_readiness` only. `contributors.hrv_balance` is stored as a 0–100 contributor, not as HRV in milliseconds, and it is not written to `hrv_ms`.
- **Activity** from `daily_activity`: score, steps, calories, and activity/non-wear seconds. Per-minute MET series and `class_5_min` are not stored. This does not create workouts and does not call the wearable XP awarder.

`summary_date` is the date that was requested. `timezone` is the UTC offset on the source timestamp (bedtime when present), because the `daily` scope does not include an IANA time zone. Bedtime clock times are taken from that offset, not from the server's zone.

An empty collection is a successful `no_data` sync. That is what a connected account looks like before a ring is paired or before the Oura app has synced. A 403 is membership or scope failure, not an empty ring. A 429 is retried once.

When a day has an Oura sleep score above 0, or measured hours, and the journal day does not already have sleep hours, the missing score and hours are copied onto `daily_journal_entries.fitbit_score` / `sleep_hours`. That is the existing consolidation input. A later sync can fill hours that were not available the first time, and it does not change a score already stored. A journal night that already has sleep hours is left alone, so a manual nap edit stays put. Readiness is never copied into an XP field. Sync reports `xpAwarded: 0`.

Rows are upserted on `(user_id, summary_date)`. Disconnect deletes that user's Oura tokens and Oura summary rows. It does not delete journal sleep already copied for consolidation.

## App registration (still required)

1. Create an API application at [cloud.ouraring.com/oauth/applications](https://cloud.ouraring.com/oauth/applications).
2. Set the redirect URI to the exact callback the backend will use:
   - Local: `http://localhost:3000/api/oura/callback`
   - Deployed: `https://YOUR-BACKEND-HOST/api/oura/callback`
3. Put the client id and secret only in the backend environment (`backend/.env` locally, the host's secret store when deployed). Do not put them in the frontend, a commit, or chat.
4. Set `INTEGRATIONS_ENCRYPTION_KEY` to a long random string. Oura token encryption uses it. If it is unset, the app falls back to `SUPABASE_SERVICE_ROLE_KEY` the same way Todoist does. If both are unset, connect is refused.
5. Set `OURA_REDIRECT_URI` to the same URI registered in step 2. In production the app stays unconfigured until this is set, so it does not silently use the localhost default.
6. Apply the summary table before the first sync. Railway does not run SQL on deploy:

   ```bash
   node backend/scripts/apply-migration.js supabase/migrations/015_oura_daily_summaries.sql
   ```

7. Restart the backend. A new Oura API application can authorize about 10 users until Oura approves it.

`OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, and `OURA_REDIRECT_URI` are the only Oura-specific variables. There is no personal-access-token variable.

## Using it

The signed-in Paladin (or higher) opens Integrations and chooses Connect. The browser is sent to Oura and returns to `/api/oura/callback`. The OAuth `state` is a short-lived signed value bound to that user. It is not the user id, and a missing state is not filled from `OWNER_USER_ID`.

Sync Oura on the same card reads America/Chicago today when no date is sent, matching the Fitbit activity sync and the 11:50pm `America/Chicago` cron. The cron, when this user is `OWNER_USER_ID` and Oura is connected, stores that Chicago day's summaries. It does not award workout XP. Google Health and legacy Fitbit keep their previous sleep-only cron path when Oura is not connected.

Oura's `day` is the calendar date in the member's Oura profile. This app does not ask for personal info, so it cannot read an IANA zone from Oura. Pass `{"date":"YYYY-MM-DD"}` to `POST /api/oura/sync` when the Chicago default is the wrong civil day.

Sleep data appears in Oura's API after the member opens the Oura app and syncs. Activity can arrive earlier. An account with a claimed ring and no paired hardware stays on `no_data` until Oura publishes a document.

## What was tested, and what was not

Tested in this repo, with synthetic fixtures labeled as such:

- Signed OAuth state, rejection of a raw user id, replay, HTML escaping of the callback error, and no `OWNER_USER_ID` fallback.
- Token sealing, refresh rotation, a 401 retry, revocation clearing tokens, and error text that does not include token material.
- Normalization of missing fields, the wrong-day document, pagination, contributor-versus-duration, idempotent upserts, empty/partial/forbidden/rate-limit results, and journal writes that do not copy readiness into HRV or award XP.

Not done, and not claimed:

- No live Oura authorization, no production client secret, no application registration, and no deploy.
- Webhooks are not implemented. Ongoing updates use the existing Chicago cron plus the manual sync button.
- The in-memory nonce that blocks OAuth replay resets when the process restarts. The authorization code itself is single-use at Oura and expires in about 10 minutes.
- `wearable_tokens` for Google Health and legacy Fitbit are still stored as plaintext in the columns named `*_encrypted`. Oura tokens are sealed before they are written to those columns. A row saved by the previous Oura code, if one exists, is still readable and is resealed on the next refresh.
