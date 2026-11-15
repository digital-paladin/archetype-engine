# Social XP

Socializing is logged as `social` (or `social-<skill-phrase>`) on `POST /api/activities`. Meetings are logged as `meeting-active` or `meeting-passive`. The server decides the XP. A client-supplied `xp` value is ignored for social scoring, same as a recovery quest.

The character sheet parser still reads seven trees: Developer, Sage, Warrior, Artist, Redteamer, Financial Strategist, Survivalist. Social Dynamics and Charisma are not sections of that file. They are `character_stats` classes, created the first time a log pays that tree.

## Previous behavior

There was no social skill tree. The frontend meeting activities (`meetings-active`, `meetings-passive`) were sent to the server as `personal-project`, which paid Developer XP (base 10, plus 0.2 per minute) with no skill goal and no reflection. An activity type the server did not know fell through to 10 XP filed as Sage. Nothing checked a work or training block.

## Rules

1. **Deliberate practice.** Skill XP is paid only when the log names a skill goal and includes a post-event reflection. Any non-whitespace note counts. The rate matches art practice: `SOCIAL_SKILL_BASE_XP` plus `floor(minutes × SOCIAL_SKILL_DURATION_MULTIPLIER)`. No duration pays the base only.
2. **Overlap.** An event whose interval overlaps a recorded work or training block pays 0 and is flagged (`schedule_overlap`, plus `[social-flag:work]` or `[social-flag:training]` in the notes). A boundary that only touches is not an overlap.
3. **Casual time.** No recognized skill goal pays `CASUAL_SOCIAL_XP`, flat, not per minute, and that amount is credited to one tree. A week (Sunday 00:00 America/Chicago through the next Sunday) cannot grant more than `CASUAL_SOCIAL_WEEKLY_CAP`. The cap is strictly below `DEEP_WORK_XP_FLOOR`, so a capped week cannot exceed one minimum deep-work award. The cap is one total, not per tree.
4. **Casual tree.** The activity label, description, and notes are matched against `CASUAL_TREE_KEYWORDS`. Longest phrase wins. Networking, group, and rapport (and the other Social Dynamics skills) credit Social Dynamics. Presence, storytelling, humor, and speaking (and the other Charisma skills) credit Charisma. No match, or an equal-length match on both trees, uses `CASUAL_SOCIAL_DEFAULT_TREE` (Social Dynamics).
5. **Both trees on purpose.** Deliberate practice pays Social Dynamics and Charisma on the same event only when the log names a skill for each. Two skills on one tree pay that tree once.
6. **Meetings.** Developer XP is paid only when the body has an explicit TTI mark: `workTag: "tti"` or `tags` containing `"tti"`. The rate is the `personal-project` rate, and the notes gain `[work-tag:tti]`. Any other meeting, including one with no tag, uses the social rules. The mark is not inferred from prose.

### Skill map

| Tree | Skills |
|---|---|
| Social Dynamics | Reading people, reading rooms, networking, group dynamics (also "hosting"), rapport, conflict (also "hard conversation") |
| Charisma | Presence, storytelling, humor, confident approaches (also "stranger conversation"), public speaking |

Phrases match after lowercasing and treating hyphens as spaces. An unrecognized skill goal pays nothing (it is not casual time). A skill goal with no reflection pays nothing.

## Defaults

Defined in `backend/src/config/socialXp.config.ts`.

| Constant | Default | Why |
|---|---|---|
| `CASUAL_SOCIAL_XP` | 2 | Flat award for one casual event, credited to one tree |
| `CASUAL_SOCIAL_WEEKLY_CAP` | 8 | Below the deep-work floor |
| `DEEP_WORK_XP_FLOOR` | 10 | Smallest primary base of `DEEP_WORK_ACTIVITY_TYPES` (`personal-project`, `redteam-training`, `art-music`, and the other listed deep-work types) |
| `CASUAL_SOCIAL_DEFAULT_TREE` | `social-dynamics` | Used when the activity text does not choose a tree |
| `TTI_WORK_TAG` | `tti` | The only mark that keeps a meeting on Developer XP |
| `SOCIAL_SKILL_BASE_XP` | 10 | Same base as `art-music` |
| `SOCIAL_SKILL_DURATION_MULTIPLIER` | 0.2 | Same per-minute rate as `art-music` |

Casual totals are read back from `[social-xp:casual:<n>]` tags on earlier social rows, whichever tree was credited.

## Schedule data

Intervals the engine already has:

- `activity_log` rows for a deep-work type or a training type (`workout-*`, plus the training aliases used by recovery quests) that have both `logged_at` and a duration. The newest 2000 rows are checked.
- Toggl Track entries that map to a workout (the same keyword map used to type wearable sessions). Those are training blocks.

`loadCalendarBlocks()` is the hook for a prospective calendar. It returns an empty list.

```ts
// TODO(social-schedule): no calendar of upcoming work or training blocks.
```

System quests store `scheduledFor` as a civil date and a `training` flag, not a start and end. Those dates are not stretched into a 24-hour block. Toggl entries that do not map to a workout are not labeled work, so they are not blocks either. A missing `TOGGL_API_TOKEN` skips that source. A Toggl request that fails sets `scheduleWarning: "toggl_unavailable"` and scores the event with the intervals that did load.

A TTI meeting is stored as `meeting-active` or `meeting-passive`, not as `personal-project`, so it is not itself a deep-work overlap block.

## Request

```json
{
  "activityType": "social",
  "occurredAt": "2026-10-20T18:00:00.000Z",
  "duration": 30,
  "skillGoals": ["networking", "storytelling"],
  "reflection": "Asked one open question."
}
```

Casual time can name the tree in the label or notes without a skill goal:

```json
{ "activityType": "social", "label": "networking lunch" }
```

A TTI job meeting:

```json
{ "activityType": "meeting-active", "duration": 60, "workTag": "tti" }
```

`skillGoal` (singular) and a comma-separated string are accepted. `social-public-speaking` names that skill when the body does not. `GET /api/activities/calculate-xp?type=social` previews the casual flat award on the default tree. `?type=meeting-active&workTag=tti` previews the Developer rate.

The quick-log and hotbar do not collect a skill goal, a reflection, or `workTag`. A meeting logged from those surfaces is social, not Developer.

## Open questions

- An event that names both trees pays each tree the full practice rate, the same way other multi-class awards pay each class its own amount. The minutes are not split.
- A log with no start and no duration cannot be checked for overlap (`interval_unknown`) and can still earn XP. Date-only logs are stored at noon UTC, so the overlap test against timed rows is coarse.
- The markdown character sheet does not grow Social Dynamics or Charisma sections. The stat row appears when the first award is saved.
- Recorded deep-work and training rows stand in for a schedule. They are what already happened, not a future appointment. The calendar hook is empty until a real source exists.
- Overlap looks at the newest 2000 activity rows. An older timed block is invisible.
