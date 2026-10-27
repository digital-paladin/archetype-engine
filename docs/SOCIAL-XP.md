# Social XP

Socializing is logged as `social` (or `social-<skill-phrase>`) on `POST /api/activities`. The server decides the XP. A client-supplied `xp` value is ignored, same as a recovery quest.

The character sheet parser still reads seven trees: Developer, Sage, Warrior, Artist, Redteamer, Financial Strategist, Survivalist. Social Dynamics and Charisma are not sections of that file. They are `character_stats` classes, created the first time a log pays that tree.

## Current behavior

There is no social skill tree. The closest rates are the frontend meeting activities (`meetings-active` 5 XP/hour, `meetings-passive` 3 XP/hour). Both are sent to the server as `personal-project`, which pays Developer XP (base 10, plus 0.2 per minute) with no skill goal and no reflection. The frontend calculator also has a mentoring bonus of 8 Developer XP. Any activity type the server does not know falls through to 10 XP filed as Sage. Nothing checks a work or training block.

## New behavior

1. **Deliberate practice.** Skill XP is paid only when the log names a skill goal and includes a post-event reflection of at least `SOCIAL_REFLECTION_MIN_CHARS` trimmed characters. The rate matches art practice: `SOCIAL_SKILL_BASE_XP` plus `floor(minutes × SOCIAL_SKILL_DURATION_MULTIPLIER)`. No duration pays the base only.
2. **Overlap.** An event whose interval overlaps a recorded work or training block pays 0 and is flagged (`schedule_overlap`, plus `[social-flag:work]` or `[social-flag:training]` in the notes). A boundary that only touches is not an overlap.
3. **Casual time.** No recognized skill goal pays `CASUAL_SOCIAL_XP`, flat, not per minute. A week cannot grant more than `CASUAL_SOCIAL_WEEKLY_CAP`. The cap is strictly below `DEEP_WORK_XP_FLOOR`, the smallest primary base among deep-work activity types, so a capped week cannot exceed one minimum deep-work award. Casual XP is written on the activity row (`class_name` `Social`) and is not added to a skill tree.
4. **Both trees.** Social Dynamics and Charisma are paid on the same event only when the log names a skill for each. Two skills on one tree pay that tree once.

### Skill map

| Tree | Skills |
|---|---|
| Social Dynamics | Reading people, reading rooms, networking, group dynamics (also "hosting"), rapport, conflict (also "hard conversation") |
| Charisma | Presence, storytelling, humor, confident approaches (also "stranger conversation"), public speaking |

Phrases match after lowercasing and treating hyphens as spaces. An unrecognized goal pays nothing (it is not casual time). A goal with no reflection pays nothing.

## Defaults

Defined in `backend/src/config/socialXp.config.ts`.

| Constant | Default | Why |
|---|---|---|
| `CASUAL_SOCIAL_XP` | 2 | Flat award for one casual event |
| `CASUAL_SOCIAL_WEEKLY_CAP` | 8 | Below the deep-work floor |
| `DEEP_WORK_XP_FLOOR` | 10 | Smallest primary base of `DEEP_WORK_ACTIVITY_TYPES` (`personal-project`, `redteam-training`, `art-music`, and the other listed deep-work types) |
| `SOCIAL_REFLECTION_MIN_CHARS` | 24 | A short sentence, not a one-word note |
| `SOCIAL_SKILL_BASE_XP` | 10 | Same base as `art-music` |
| `SOCIAL_SKILL_DURATION_MULTIPLIER` | 0.2 | Same per-minute rate as `art-music` |

The week is Monday 00:00 America/Chicago through the next Monday. Casual totals are read back from `[social-xp:casual:<n>]` tags on earlier `social` rows.

## Schedule data

Intervals the engine already has:

- `activity_log` rows for a deep-work type or a training type (`workout-*`, plus the training aliases used by recovery quests) that have both `logged_at` and a duration. The newest 2000 rows are checked.
- Toggl Track entries that map to a workout (the same keyword map used to type wearable sessions). Those are training blocks.

`loadCalendarBlocks()` is the hook for a prospective calendar. It returns an empty list.

```ts
// TODO(social-schedule): no calendar of upcoming work or training blocks.
```

System quests store `scheduledFor` as a civil date and a `training` flag, not a start and end. Those dates are not stretched into a 24-hour block. Toggl entries that do not map to a workout are not labeled work, so they are not blocks either. A missing `TOGGL_API_TOKEN` skips that source. A Toggl request that fails sets `scheduleWarning: "toggl_unavailable"` and scores the event with the intervals that did load.

## Request

```json
{
  "activityType": "social",
  "occurredAt": "2026-10-20T18:00:00.000Z",
  "duration": 30,
  "skillGoals": ["networking", "storytelling"],
  "reflection": "Asked one open question and left space before answering."
}
```

`skillGoal` (singular) and a comma-separated string are accepted. `social-public-speaking` names that skill when the body does not. `GET /api/activities/calculate-xp?type=social` previews the casual flat award only.

The quick-log and hotbar do not collect a skill goal or a reflection, so they cannot submit this yet.

## Open questions

- Casual XP is activity-log credit only. It does not level Social Dynamics, Charisma, Sage, or any other class. A separate non-skill counter may be a better home.
- An event that names both trees pays each tree the full practice rate, the same way other multi-class awards pay each class its own amount. The minutes are not split.
- The week starts Monday. A Sunday boundary is a product choice, not something the engine already defines.
- 24 characters is a placeholder floor for "short reflection."
- A log with no start and no duration cannot be checked for overlap (`interval_unknown`) and can still earn skill XP. Date-only logs are stored at noon UTC, so the overlap test against timed rows is coarse.
- Meetings still alias to `personal-project` and still pay Developer XP.
- The markdown character sheet does not grow Social Dynamics or Charisma sections. The stat row appears when the first skill award is saved.
- Recorded deep-work and training rows stand in for a schedule. They are what already happened, not a future appointment. The calendar hook is empty until a real source exists.
- Overlap looks at the newest 2000 activity rows. An older timed block is invisible.
