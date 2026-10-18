# Fitbit Web API → Google Health API v4

Google shuts down the Fitbit Web API on **30 October 2026**. Archetype Engine now reads the same Fitbit / Pixel Watch data through the [Google Health API](https://developers.google.com/health) (`health.googleapis.com/v4`).

Sleep, activity, heart rate, nutrition, and vitals still land on the existing journal columns and `/api/fitbit/*` responses, so daily metrics, sleep consolidation, and the ACM sleep bonus do not need a new contract. `fitbit_score` is still the 0–100 score those paths already read.

## What moved

| App payload | Legacy Fitbit call | Google Health v4 | Scope |
| --- | --- | --- | --- |
| Sleep score, hours, stages | `GET /1.2/user/-/sleep/date/{date}` | `sleep` reconcile | `googlehealth.sleep.readonly` |
| Steps, active / lightly active minutes, sedentary minutes, calories out, active zone minutes | `GET /1/user/-/activities/date/{date}` | daily rollup of `steps`, `active-minutes`, `sedentary-period`, `total-calories`, `active-zone-minutes` | `googlehealth.activity_and_fitness.readonly` |
| Logged workouts (Warrior quest) | `activities[]` on that same call | `exercise` reconcile | `googlehealth.activity_and_fitness.readonly` |
| Resting heart rate | `summary.restingHeartRate` | `daily-resting-heart-rate` | `googlehealth.health_metrics_and_measurements.readonly` |
| Fat Burn / Cardio / Peak zones | `summary.heartRateZones` | `time-in-heart-rate-zone`, `calories-in-heart-rate-zone`, `daily-heart-rate-zones` | activity scope for time and calories; health-metrics scope for bpm bounds |
| Food log and protein band | `GET /1/user/-/foods/log/date/{date}` | `nutrition-log` reconcile + daily rollup | `googlehealth.nutrition.readonly` |
| Weight, body fat, hydration | body log, water log | `weight`, `body-fat`, `hydration-log` | health-metrics and nutrition |
| SpO2, respiratory rate | spo2, breathing rate | `daily-oxygen-saturation`, `daily-respiratory-rate` | `googlehealth.health_metrics_and_measurements.readonly` |
| VO2 max | cardioscore | `daily-vo2-max` | `googlehealth.activity_and_fitness.readonly` |

Passive tracker data uses data source family `google-wearables` (same family the sleep client already used). Workouts, food, water, weight, and body fat use `google-sources` so a manual log or Aria scale entry is not dropped. `google-wearables` excludes manual entries.

## Environment variables

Set these in local `.env` and in Railway. Do not commit values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_HEALTH_CLIENT_ID` | Yes, for the new path | OAuth web client id |
| `GOOGLE_HEALTH_CLIENT_SECRET` | Yes, for the new path | OAuth web client secret. Server only. |
| `GOOGLE_HEALTH_REDIRECT_URI` | Yes | Must match a redirect URI on the OAuth client. Default `http://localhost:3000/api/google-health/callback` |
| `FITBIT_DATA_SOURCE` | No | `auto` (default), `google`, or `legacy`. See the flag section below. |
| `FITBIT_CLIENT_ID` | Only for the legacy fallback | Existing Fitbit Web API app |
| `FITBIT_CLIENT_SECRET` | Only for the legacy fallback | Existing Fitbit Web API app |
| `FITBIT_REDIRECT_URI` | Only for the legacy fallback | `http://localhost:3000/api/fitbit/callback` |

`auto` is safe before the Google client exists: if `GOOGLE_HEALTH_CLIENT_ID` / `GOOGLE_HEALTH_CLIENT_SECRET` are empty, or the user has not connected Google Health, the app keeps calling the legacy Fitbit API.

## OAuth scopes

The consent URL requests only these readonly scopes:

- `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
- `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
- `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
- `https://www.googleapis.com/auth/googlehealth.nutrition.readonly`

No write, location, ECG, or irregular-rhythm scopes are requested. Users can grant a subset. A withheld scope returns 403 for that data type; the route responds with `requiresAuth: true` instead of writing a fake protein or hydration value. Sleep, activity, and vitals still return whatever scopes did succeed.

These scopes are **Restricted** ([Google Health app verification](https://developers.google.com/health/app-verification), [restricted scopes](https://support.google.com/cloud/answer/13464325)).

## Google Cloud console

1. Open [Google Cloud Console](https://console.cloud.google.com) and select or create the project that will own the OAuth client.
2. APIs & Services → Library → enable **Google Health API**.
3. APIs & Services → OAuth consent screen.
   - User type: External, unless the Google account is in a Workspace org you control.
   - App name: Archetype Engine (must match the in-app disclosure).
   - Add the support email and the owner as a test user while the app is in Testing.
   - Scopes: add the four readonly scopes above. Do not add broader scopes "for later".
4. APIs & Services → Credentials → Create credentials → OAuth client ID → **Web application**.
   - Authorized redirect URIs:
     - `http://localhost:3000/api/google-health/callback`
     - `https://YOUR-RAILWAY-HOST/api/google-health/callback`
5. Copy the client id and secret into `GOOGLE_HEALTH_CLIENT_ID` and `GOOGLE_HEALTH_CLIENT_SECRET`.
6. Confirm `supabase/migrations/005_google_health_provider.sql` has been applied (`wearable_tokens` allows `provider = 'google'`).
7. Sign in to the app and use **Fitbit / Pixel Watch (Google Health)** on the sleep panel. The button sits next to the disclosure: Archetype Engine reads Fitbit / Pixel Watch sleep, activity, heart rate, and nutrition to fill the journal, sleep score, and daily metrics.
8. Re-consent with the Google account that owns the Fitbit data. Legacy `fitbit_tokens` are not migrated.

`/api/google-health/callback` stays unauthenticated because the Google redirect cannot send the app JWT. `state` carries the signed-in user id from `/api/google-health/connect-url`.

## Verification the owner must do

Testing mode is enough for the owner and up to 100 test users. An unverified app that requests Restricted scopes shows an unverified-app warning and cannot be used by the public.

Before anyone outside the test-user list connects:

1. Publish branding on the OAuth consent screen, then request verification from the [OAuth verification center](https://console.cloud.google.com/auth/verification).
2. Justify each scope. Narrower scopes do not cover this app: sleep score needs `sleep.readonly`, steps and workouts need `activity_and_fitness.readonly`, resting heart rate / weight / SpO2 / respiratory rate need `health_metrics_and_measurements.readonly`, and the food log needs `nutrition.readonly`.
3. Record a YouTube demo, in English, of the real app: the in-app disclosure, the full consent screen with these exact scopes, and the journal / sleep / activity / nutrition screens that use the data. [Verification requirements](https://support.google.com/cloud/answer/13464321).
4. Complete the annual third-party security assessment required for Restricted scopes. Google lists the assessors in the verification flow. Budget this before a public launch; it is separate from Play review.
5. Keep the in-app disclosure on the connect screen. A privacy-policy link alone does not satisfy the [Health API disclosure rules](https://developers.google.com/health/app-verification).
6. If a user grants only some scopes, leave the rest of the app usable and offer `/api/google-health/connect-url` again. Do not add a second in-app permission toggle that can disagree with the Google account.

Until verification finishes, leave `FITBIT_DATA_SOURCE` at `auto` or `legacy` so existing Fitbit tokens keep the journal filling.

## Feature flag

| `FITBIT_DATA_SOURCE` | Behavior |
| --- | --- |
| `auto` (default, or any unknown value) | Google Health when the client is configured **and** this user has tokens. Otherwise the legacy Fitbit Web API, if that client is configured. |
| `google` | Google Health only. Missing credentials → 503. Connected client but no tokens → `requiresAuth` and a pointer at `/api/google-health/connect-url`. The legacy API is not called. |
| `legacy` | Fitbit Web API only, even if Google Health tokens exist. |

The same flag gates the wearable sleep cascade, the daily-metrics sleep backfill, and the 11:50pm Chicago sleep cron. Oura stays first in that cascade. `/api/wearables/status` reports `fitbitDataSource`.

## Cutover checklist

- [ ] Google Health API enabled; OAuth web client created; redirect URIs include local and Railway.
- [ ] `GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET`, and `GOOGLE_HEALTH_REDIRECT_URI` set in Railway. Secret is not in git.
- [ ] `005_google_health_provider.sql` applied.
- [ ] `FITBIT_DATA_SOURCE` left at `auto`.
- [ ] Owner signs in and connects Google Health. `/api/google-health/status` shows `connected: true`.
- [ ] Reload the dashboard. Sleep still writes `fitbit_score` and `sleep_hours`. Activity still fills steps, zones, and the Warrior quest. Nutrition still writes `protein_level` (`low` under 80g, `medium` from 80g, `high` from 130g). Vitals still write `hydration_oz` when water is logged.
- [ ] Confirm `/api/fitbit/activities/today`, `/nutrition/today`, and `/vitals/today` return `source: "google-health"`.
- [ ] Leave the legacy Fitbit app in place until that check is green.
- [ ] After a few good days, set `FITBIT_DATA_SOURCE=google` so a Google outage cannot silently fall back to an API that will 404 after 30 October 2026.
- [ ] Submit Restricted-scope verification before adding users beyond the test list.
- [ ] On or before 30 October 2026, remove `FITBIT_CLIENT_ID` / `FITBIT_CLIENT_SECRET` if you no longer want the legacy path.

## Decisions worth knowing

- **Heart zones.** Google's minute zones are Light / Moderate / Vigorous / Peak. Google's own Active Zone Minutes help text calls moderate "fat burn" and vigorous "cardio", so the UI still shows Fat Burn ← Moderate, Cardio ← Vigorous, Peak ← Peak. Light is omitted, the same way Fitbit's "Out of Range" zone was omitted. `activeZoneMinutes` is the weighted Fitbit AZM total (1× fat burn, 2× cardio and peak).
- **Sleep score.** Google Health has no Fitbit sleep score. Hours, efficiency, vitality, and score use the same formula as `parseFitbitSleepDay`, and the result is still stored in `fitbit_score`. Classic `ASLEEP` stages count as sleep. `RESTLESS` does not. `metadata.mainSleep` wins when Google sets it.
- **Calorie goal.** `nutrition-log` has no Fitbit `goals.calories`. `goalCalories` is `0`, and the food panel already hides the goal bar in that case. Asking for `settings.readonly` just to recover a goal was not worth a fifth Restricted scope.
- **BMI.** Weight logs do not include BMI. It is computed from today's weight and the latest `height` sample. If height was never logged, `bmi` is omitted. Weight is converted from grams to pounds.
- **VO2 max.** Fitbit returned a range string such as `42–46`. Google returns one number; the UI string is that number (`42` or `42.5`).
- **SpO2 min / max.** `spo2Min` and `spo2Max` are the daily confidence bounds (`lowerBoundPercentage` / `upperBoundPercentage`), not the min and max of raw samples.
- **Food brand.** The nutrition log has a display name and not a brand. `brand` is left empty rather than issuing one Food API read per entry.
- **Partial consent.** One denied scope does not blank the rest of that screen. If every activity or vitals call is denied, the route returns `requiresAuth` instead of a fake all-zero day. An empty-but-successful food log still writes protein `low`, which is what the legacy parser did.
