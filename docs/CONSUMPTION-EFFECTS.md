# Consumption status effects

Logging food, fluids, supplements, or alcohol updates the journal and, when the dose is large enough to matter, creates or refreshes a status effect. Repeat doses of the same kind merge into one row. The modifiers are modest on purpose. The old manual **Alcohol Effect** template (flat −30% sleep for 8 hours) is still in the preset list for a hand-applied effect. Automatic logging uses **Alcohol Shadow** instead, scaled by standard drinks and how close the drink is to bedtime.

Effects are stored per user in Supabase. A redeploy no longer wipes them.

## Apply this on deploy

Railway deploys the backend from `main` and does **not** run SQL. Apply this file to the same Supabase project the API uses, before relying on auto effects or `POST /api/system/consumption`:

`supabase/migrations/012_status_effects.sql`

```bash
node backend/scripts/apply-migration.js supabase/migrations/012_status_effects.sql
```

Or paste it into the Supabase SQL editor.

That creates `status_effects` and `consumption_events`, and adds `protein_grams_logged`, `meal_count`, and `food_log` to `daily_journal_entries` if they are missing (the consume path already writes them).

`011_system_quest_edits.sql` belongs to the system-quest correction work. `012` does not depend on it. Apply both; the order does not matter.

If `status-effects.json` is still next to the journal (`STATUS_EFFECTS_PATH`, or beside `JOURNAL_PATH`):

- The first authenticated read imports it into `status_effects` when that table is empty, then renames the file to `status-effects.json.imported`.
- If the table already has rows, or the file is empty or unreadable, the file is left in place and ignored. The API keeps serving.
- With no Supabase keys, the process keeps the JSON file itself (`STATUS_EFFECTS_STORE=file` forces that). Tests use an in-memory store.

Journal logging still succeeds if the effects table is missing. The response then includes `effectsError` and an empty `effects` list.

## What logging changes

| Signal | Effect | Merge key |
|---|---|---|
| Alcohol (`volumeOz` × ABV) | Alcohol Shadow | `alcohol` |
| Caffeine (mg) | Caffeine Clarity, mixed when it is close to bedtime | `caffeine` |
| Water under 40 oz after 14:00 local | Dehydration, until intake recovers | `dehydration` |
| Water at the 100 oz goal | Hydrated, and dehydration is removed | `hydrated` |
| Added sugar ≥ 5 g | Sugar Rush | `sugar` |
| Protein ≥ 80% of goal, and at the goal | Protein Building, then High Protein Synthesis | `protein-building`, `protein-goal` |
| Creatine (g) | Creatine Saturation, 24 h | `creatine` |
| Magnesium (mg) | Magnesium Calm, 8 h | `magnesium` |
| Melatonin (mg) | Melatonin Wind-Down, 7 h. The latest dose replaces earlier ones | `melatonin` |

Unknown supplement keys are stored on the food log and do not invent an effect. Natural sugar in fruit is not an added-sugar effect unless `addedSugarG` is sent.

ACM item 0 (**Abstained from undisciplined alcohol indulgence**) and `abstinence_streaks` are not updated. An alcohol log returns `abstinencePrompt` with `broken: false`. The player decides whether it was undisciplined.

## Alcohol

US standard drink (NIAAA): 14 g ethanol, which is 0.6 fl oz of pure alcohol.

```
standard drinks = volumeOz × (ABV ÷ 100) ÷ 0.6
                = volumeOz × ABV% ÷ 60
```

12 oz at 4.2% is `12 × 4.2 / 60 = 0.84` standard drinks.

Clearance is about one standard drink per hour (the usual rule of thumb for the ~0.015 g/dL/hour elimination rate). The effect then keeps running for a sleep/recovery tail, because sleep architecture can stay worse after blood alcohol is back near zero, especially when the drink is close to bed.

Hours until bedtime are measured in `America/Chicago` (or `APP_TIMEZONE`) against today's bedtime. Bedtime is, in order: the request's `bedtime`, today's `sleep_start`, yesterday's `sleep_start`, then the weekday override, then the default. The player's lights-out is `21:30`, except Tuesday (parkour night) at `22:15`. An explicit `bedtime` on the request wins over all of those. After bedtime the value is 0, so a pour after lights-out is a nightcap.

```
proximity = clamp(1.35 − 0.22 × hoursUntilBed, 0.30, 1.25)
severity  = drinksStillClearing × proximity
Sleep Quality      = min(35, round(10 × severity))%
Recovery Rate      = min(25, round( 8 × severity))%
XP Consolidation   = min(15, round( 5 × severity))%
Testosterone       = min(12, round( 4 × severity))%
tail minutes       = clamp(240 − 40 × hoursUntilBed, 45, 240)
duration           = clearance + tail
```

Pleasure / Social Freedom is `+Mild` under 1 drink still clearing, `+Moderate` under 2.5, otherwise `+High`. The penalty is fixed when the dose is logged. It does not tick down every minute. The next dose recomputes from what is still clearing plus the new pour, and extends the expiry. A second row is not created.

### One 12 oz Miller Lite

Same 0.84 standard drinks. America/Chicago, October (CDT, UTC−5). Tuesday uses lights-out 22:15. Every other weekday uses 21:30. No `sleep_start` is logged, and the request does not send `bedtime`.

#### Tuesday (bed 22:15) — 2026-10-20

| | 7:00 PM | 9:45 PM |
|---|---|---|
| Hours before bed | 3.25 | 0.5 |
| Proximity | 0.635 | 1.24 |
| Severity | 0.533 | 1.042 |
| Sleep Quality | −5% | −10% |
| Recovery Rate | −4% | −8% |
| XP Consolidation | −3% | −5% |
| Testosterone | −2% | −4% |
| Pleasure | +Mild | +Mild |
| Duration | 2 h 40 m (160 min) | 4 h 30 m (270 min) |
| Dose shown | 0.84 standard drinks | 0.84 standard drinks |

The 7 PM beer expires around 9:40 PM. The 9:45 PM beer is half an hour before parkour-night lights-out, about twice the sleep penalty, and still running past midnight.

#### Any other weekday (bed 21:30)

| | 7:00 PM | 9:45 PM |
|---|---|---|
| Hours before bed | 2.5 | 0 (15 min after lights-out) |
| Proximity | 0.80 | 1.25 (the cap) |
| Severity | 0.672 | 1.05 |
| Sleep Quality | −7% | −11% |
| Recovery Rate | −5% | −8% |
| XP Consolidation | −3% | −5% |
| Testosterone | −3% | −4% |
| Pleasure | +Mild | +Mild |
| Duration | 3 h 10 m (190 min) | 4 h 50 m (290 min) |
| Dose shown | 0.84 standard drinks | 0.84 standard drinks |

On a normal night the 7 PM beer is already a heavier debuff than the Tuesday 7 PM beer, and it expires around 10:10 PM. The 9:45 PM beer is after lights-out, so proximity sits on the cap. Three of those nightcaps land near the caps (sleep −32% before the 35% ceiling) rather than the old flat −30% / −25% / −10% for any amount.

## Caffeine, water, sugar, protein, supplements

Caffeine uses a 5 hour half-life. 95 mg (8 oz black coffee) is the reference: Focus +12%, Mental Clarity +8%, about 5 hours, and "−Tier 1" physical fatigue at 80 mg or more. Caps are +25% focus and +18% clarity. Inside 6 hours of bedtime the same proximity curve adds a sleep penalty, capped at −15%. A second cup adds its remaining milligrams to the first; it does not open a second effect.

Hydration goal is 100 oz, matching the Vow of Water. Dehydration starts only at local hour 14 or later, and only under 40 oz. Empty is Focus −25%, Physical Output −15%, Vitality −5. The penalty shrinks as intake rises and is removed at 40 oz. Reaching 100 oz applies Hydrated (Focus +5%, Physical Output +5%, 6 hours) and removes dehydration. Morning with an empty log is not dehydration.

Added sugar under 5 g does nothing. At 12 g: Focus −5%, Energy +Mild, Insulin +Elevated, a bit under an hour. Caps: Focus −15%, 3 hours. This fires only when `addedSugarG` is sent.

Protein goal is `0.64 g/lb × CONSUMPTION_BODYWEIGHT_LB` when that weight is set. Otherwise it is 130 g, the existing journal "high" tier (0.64 g/lb at about 203 lb). At 80% of goal, Protein Building is Recovery +4%. At the goal, High Protein Synthesis replaces it: Muscle Synthesis +Optimal, Recovery +8%, 24 hours. The template's +15% recovery was the ceiling; the automatic buff stays under it.

Creatine reference is 5 g (ISSN maintenance range is about 3–5 g/day). Strength +5% and Recovery +4% at 5 g, capped at +8% / +6%, for 24 hours. Magnesium reference is 200 mg elemental: Sleep Quality +4%, Recovery +3%, caps +8% / +6%, for 8 hours. Melatonin is a flat Sleep Quality +3% and faster sleep onset for 7 hours. Doses are not summed; the latest one wins. Above 3 mg, Focus −5% is added for that same window.

## Sources

These are game modifiers, not clinical advice. The scale is deliberately smaller than the manual templates.

- NIAAA, "What Is a Standard Drink?" — 14 g / 0.6 fl oz ethanol. The liver metabolizes on the order of one standard drink per hour.
- Ebrahim IO et al. "Alcohol and sleep I: effects on normal sleep." *Alcohol Clin Exp Res.* 2013. Dose-dependent REM loss; worse when drinking is close to sleep.
- Colrain IM, Nicholas CL, Baker FC. "Alcohol and the sleeping brain." *Handb Clin Neurol.* 2014.
- Drake C et al. "Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed." *J Clin Sleep Med.* 2013. That study used 400 mg. A cup of coffee is scaled well below it.
- Caffeine half-life of about 5 hours is the common adult average (range roughly 3–7 hours).
- Institute of Medicine adequate intake for total water, and the in-game 100 oz fluid vow. The debuff uses logged `waterOz` only.
- Protein threshold `0.64 g/lb` is the existing ACM item. ISSN's exercising range of about 1.4–2.0 g/kg is roughly 0.64–0.91 g/lb.
- ISSN creatine position stand: 3–5 g/day maintains stores. The buff means today's dose is in, not an acute strength miracle.
- Abbasi B et al. "The effect of magnesium supplementation on primary insomnia in elderly." *J Res Med Sci.* 2012. The in-game dose is smaller than that trial.
- Ferracioli-Oda E, Qawasmi A, Bloch MH. Melatonin meta-analysis, *PLoS One* 2013. Low doses (around 0.5 mg) are often enough; higher doses are where morning grogginess shows up.
- WHO guidance to limit free sugars. The debuff is a signal for logged added sugar, not a ban.

## Configuration

Defaults live in `backend/src/config/consumptionEffects.config.ts`.

| Env | Effect |
|---|---|
| `APP_TIMEZONE` | Bedtime clock. Default `America/Chicago`. |
| `CONSUMPTION_BEDTIME` | Fallback lights-out `HH:MM` for weekdays without an override. Default `21:30`. An invalid value is ignored. |
| `CONSUMPTION_BEDTIME_BY_WEEKDAY` | JSON object of weekday → `HH:MM`. Replaces the whole map. Default seed is `{"tuesday":"22:15"}`. Keys may be `tuesday`, `tue`, or `2` (Sunday = `0`). Unknown days and invalid times are dropped. A bad JSON value is ignored and the seed stays. |
| `CONSUMPTION_BODYWEIGHT_LB` | Protein goal = 0.64 × this weight. |
| `CONSUMPTION_HYDRATION_GOAL_OZ` | Default 100. |
| `CONSUMPTION_PROTEIN_GOAL_GRAMS` | Used when weight is unset. Default 130. |
| `CONSUMPTION_EFFECTS_JSON` | JSON object deep-merged over the defaults, including `defaultBedtime` and `bedtimeByWeekday`. A bad JSON value is ignored. This merge runs after `CONSUMPTION_BEDTIME_BY_WEEKDAY`, so a weekday set here is added to that map. |
| `STATUS_EFFECTS_STORE` | `memory`, `file`, or omit for Supabase when the service-role key is set. |
| `STATUS_EFFECTS_PATH` | Legacy JSON path. Otherwise beside `JOURNAL_PATH`. |

## API

Player sessions keep using `POST /api/consume`. The service key (`sys_…`, scope `system`) cannot call that route. It calls `POST /api/system/consumption`, which runs the same logger, requires `idempotencyKey`, and posts one System notice. A replay of the key returns `200` with `idempotentReplay: true` and does not apply the dose again or post a second notice. The key still cannot mint credentials, approve money rewards, or call anything outside `/api/system/*`.

### Player

```bash
curl -X POST "$API/api/consume" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "itemName": "Miller Lite (12 oz)",
    "protein": 0,
    "calories": 96,
    "buffValue": "Alcohol Shadow",
    "alcohol": { "volumeOz": 12, "abvPercent": 4.2 },
    "consumedAt": "2026-10-20T19:00:00-05:00",
    "clientDate": "2026-10-20"
  }'
```

`2026-10-20` is a Tuesday, so lights-out is 22:15. Sending `"bedtime": "23:00"` would use 23:00 instead. `200` body (fields after `message` are new; `success` and `message` stay):

```json
{
  "success": true,
  "message": "Consumed Miller Lite (12 oz): +0g protein, 96 kcal logged",
  "effects": [{
    "name": "Alcohol Shadow",
    "effectKey": "alcohol",
    "autoApplied": true,
    "dose": "0.84 standard drinks",
    "source": "Miller Lite (12 oz) · 4.2% ABV · 3.25h before bedtime",
    "type": "mixed",
    "effects": [
      { "stat": "Sleep Quality", "modifier": "-5%", "direction": "negative" }
    ]
  }],
  "abstinencePrompt": {
    "itemIndex": 0,
    "prompt": true,
    "broken": false,
    "message": "Alcohol was logged. ACM item 0 and the abstinence streak were not changed. Confirm a break yourself if this counts as undisciplined indulgence."
  },
  "dietFlags": []
}
```

### Grok Bot

```bash
curl -X POST "$API/api/system/consumption" \
  -H "Authorization: Bearer $ARCHETYPE_SYSTEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "consumption:2026-10-20:miller-1945",
    "itemName": "Miller Lite (12 oz)",
    "calories": 96,
    "alcohol": { "volumeOz": 12, "abvPercent": 4.2 },
    "consumedAt": "2026-10-20T21:45:00-05:00"
  }'
```

On that Tuesday the 9:45 PM pour is 0.5 h before 22:15: Sleep Quality −10%, duration 270 minutes. The same pour on Wednesday (`2026-10-21T21:45:00-05:00`) is after 21:30, so the source says `at or after bedtime`, Sleep Quality is −11%, and the duration is 290 minutes.

`201` the first time, `200` with `idempotentReplay: true` after that. `noticeBody` is also stored as a System message (`GET /api/system/messages`) and emitted as `system:notice`. The body includes `id`, the food-log id of the new row.

Other bodies the same endpoint accepts: `waterOz`, `caffeineMg`, `addedSugarG`, `totalSugarG`, `supplements: [{ "key": "creatine", "amount": 5, "unit": "g" }]`, `protein`, `bodyWeightLb`. Keys the logger understands are `creatine`, `magnesium`, and `melatonin`.

`totalSugarG` is the label's total sugar, including sugar that was not added. It is stored on the food log and returned by the list and correction routes. It does not set the `added-sugar` flag and it does not apply Sugar Rush. Those still require `addedSugarG`.

### Correcting an entry

A posted row is replaced, not logged again. Daily protein, meal count, and water move by the difference, so a second meal, a second XP line, and a second dose are not created. The activity feed is not appended. Flags are recomputed from the name, notes, and added sugar. Dose-stack effects (sugar, alcohol, caffeine, creatine, magnesium, melatonin) drop this row's previous dose and project the stack again at the latest dose time, which keeps the window the meal would have had. Protein and hydration buffs are refreshed when the edited day is today, or when the live buff's stored total still matches that day.

Replaying the same `idempotencyKey` returns the entry as it is now and does not post a second System message.

No new SQL. `id`, `notes`, `editedAt`, `edits`, and `totalSugarG` live on the existing `food_log` JSON from `012_status_effects.sql`.

List a day (assigns an id to any older row that does not have one):

```bash
curl "$API/api/system/consumption?date=2026-10-27" \
  -H "Authorization: Bearer $ARCHETYPE_SYSTEM_KEY"
```

```json
{
  "success": true,
  "date": "2026-10-27",
  "entries": [{
    "id": "6f1c0b2e-7a0d-4e5a-9c1f-2b6d8e4a1c30",
    "itemName": "Tres Leches Slice",
    "calories": 540,
    "protein": 9,
    "addedSugarG": 0,
    "totalSugarG": null,
    "notes": null,
    "consumedAt": "2026-10-27T19:30:00-05:00",
    "dietFlags": [],
    "editedAt": null,
    "editCount": 0
  }]
}
```

Correct it:

```bash
curl -X PATCH "$API/api/system/consumption/6f1c0b2e-7a0d-4e5a-9c1f-2b6d8e4a1c30" \
  -H "Authorization: Bearer $ARCHETYPE_SYSTEM_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "consumption-correction:tres-leches-sugar",
    "addedSugarG": 42.5,
    "totalSugarG": 42.5,
    "notes": "Label sugar for the portion eaten",
    "reason": "Label was read after the meal was logged"
  }'
```

`200` body includes `changes` (`addedSugarG: 0 → 42.5`), `previous`, `dietFlags: ["added-sugar"]`, and a Sugar Rush effect projected from the meal's own timestamp. `noticeBody` is also stored as a System message. The same call with a player session is `PATCH /api/consume/:id` (idempotency key optional, no System message). `GET /api/consume?date=YYYY-MM-DD` lists that player's day. An unknown id is `404`. A missing or non-system credential is `401` or `403`.

`GET /api/status-effects` is unchanged in shape. Auto rows add `dose`, `autoApplied`, `effectKey`, and `source`. The Status Effects panel shows the source, the dose, and an auto tag.

The panel also emits nothing by itself. A successful log emits `status-effects-updated` to that user's socket room so the panel reloads.

## Catalogue

New seeds, none of which contain avocado, avocado oil, seed oils, or added sugar:

- Miller Lite, 12 oz, 4.2% ABV (`alcohol`)
- Creatine monohydrate, 5 g
- Magnesium glycinate, 200 mg elemental
- Melatonin, 0.5 mg

Black coffee is 95 mg caffeine. Green tea is 30 mg.

**Already in the catalogue, flagged rather than added again:** item 30, `Avocado (½ medium)` (`allergenFlag: "avocado"`). The player's rule is an avocado allergy. Logging that name also returns `dietFlags: ["avocado"]`. Seed-oil phrases in the name or notes return `seed-oil`. Added sugar returns `added-sugar`. None of these block the log.
