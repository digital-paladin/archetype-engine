/**
 * analyticsParser.spec.ts
 * Unit tests for parseRecentEntries, calcTimeToLevel, and parseDisciplineData.
 *
 * All tests are fixture-based — no file I/O. When character-sheet.md entry
 * format changes (headings, bullet style, grit format) update fixtures here
 * and the parser regex together.
 */

import { describe, it, expect } from '@jest/globals';
import { parseRecentEntries, calcTimeToLevel, parseDisciplineData } from './analyticsParser';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

/** Two-entry fixture: one with XP + Grit, one with only XP */
const TWO_ENTRY_FIXTURE = `
### Feb 27 → Feb 28, 2026 (Fri → Sat)

- Developer: +15 XP
- Sage: +8 XP
- Warrior (Deadlift): +10 XP
**Grit Score:** 9/12 (75%)

### Feb 26 → Feb 27, 2026 (Thu → Fri)

- Developer: +20 XP
- Financial Strategist: +5 XP
**Grit Score:** 6/12 (50%)
`;

/** Entry with duplicate class XP lines (should sum) */
const DUPLICATE_ENTRY_FIXTURE = `
### Mar 01 → Mar 02, 2026 (Sun → Mon)

- Developer: +10 XP
- Developer: +5 XP
- Sage: +12 XP
`;

/** Entry with no XP lines */
const NO_XP_ENTRY_FIXTURE = `
### Jan 10 → Jan 11, 2026 (Sat → Sun)

Just a rest day entry.
`;

// ─────────────────────────────────────────────────────────────
// parseRecentEntries()
// ─────────────────────────────────────────────────────────────
describe('parseRecentEntries()', () => {
  it('returns entries in reverse chronological order (most recent first)', () => {
    const result = parseRecentEntries(TWO_ENTRY_FIXTURE);
    expect(result[0].dateLabel).toBe('Feb 27');
    expect(result[1].dateLabel).toBe('Feb 26');
  });

  it('parses per-class XP correctly for first entry', () => {
    const result = parseRecentEntries(TWO_ENTRY_FIXTURE);
    expect(result[0].classXP['Developer']).toBe(15);
    expect(result[0].classXP['Sage']).toBe(8);
    expect(result[0].classXP['Warrior']).toBe(10);
  });

  it('parses per-class XP correctly for second entry', () => {
    const result = parseRecentEntries(TWO_ENTRY_FIXTURE);
    expect(result[1].classXP['Developer']).toBe(20);
    expect(result[1].classXP['Financial Strategist']).toBe(5);
  });

  it('calculates totalXP as sum of all class XP', () => {
    const result = parseRecentEntries(TWO_ENTRY_FIXTURE);
    expect(result[0].totalXP).toBe(33); // 15+8+10
    expect(result[1].totalXP).toBe(25); // 20+5
  });

  it('parses grit percentage correctly', () => {
    const result = parseRecentEntries(TWO_ENTRY_FIXTURE);
    expect(result[0].gritPct).toBe(75);
    expect(result[1].gritPct).toBe(50);
  });

  it('returns undefined gritPct when no Grit Score line', () => {
    const result = parseRecentEntries(DUPLICATE_ENTRY_FIXTURE);
    expect(result[0].gritPct).toBeUndefined();
  });

  it('sums duplicate class XP lines within the same entry', () => {
    const result = parseRecentEntries(DUPLICATE_ENTRY_FIXTURE);
    expect(result[0].classXP['Developer']).toBe(15); // 10+5
  });

  it('returns empty classXP and 0 totalXP for an entry with no XP lines', () => {
    const result = parseRecentEntries(NO_XP_ENTRY_FIXTURE);
    expect(result[0].totalXP).toBe(0);
    expect(Object.keys(result[0].classXP).length).toBe(0);
  });

  it('respects maxEntries limit', () => {
    const result = parseRecentEntries(TWO_ENTRY_FIXTURE, 1);
    expect(result.length).toBe(1);
    expect(result[0].dateLabel).toBe('Feb 27');
  });

  it('returns empty array when content has no entry headers', () => {
    expect(parseRecentEntries('No entries here at all.').length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// calcTimeToLevel()
// ─────────────────────────────────────────────────────────────
describe('calcTimeToLevel()', () => {
  const TREES = [
    { id: 'developer', name: 'Developer', level: 20, currentXP: 2000, xpToNextLevel: 8944 },
    { id: 'sage',      name: 'Sage',      level: 26, currentXP: 500,  xpToNextLevel: 13265 },
    { id: 'warrior',   name: 'Warrior',   level: 9,  currentXP: 1000, xpToNextLevel: 3162 }, // xpNeeded=2162, avgDailyXP=0 → inactive
  ];
  const PROJECTIONS = {
    Developer: { avgDailyXP: 10 },
    Sage:      { avgDailyXP: 5 },
    Warrior:   { avgDailyXP: 0 }, // inactive
  };

  it('returns one result per skill tree', () => {
    const result = calcTimeToLevel(TREES, PROJECTIONS);
    expect(result.length).toBe(3);
  });

  it('calculates daysRemaining as ceil(xpNeeded / avgDailyXP)', () => {
    const result = calcTimeToLevel(TREES, PROJECTIONS);
    const dev = result.find(r => r.className === 'Developer')!;
    const xpNeeded = 8944 - 2000; // 6944
    expect(dev.daysRemaining).toBe(Math.ceil(6944 / 10)); // 695
  });

  it('marks isInactive true when avgDailyXP is 0', () => {
    const result = calcTimeToLevel(TREES, PROJECTIONS);
    const warrior = result.find(r => r.className === 'Warrior')!;
    expect(warrior.isInactive).toBe(true);
    expect(warrior.projectedDate).toBe('Unknown');
  });

  it('returns daysRemaining=-1 (sentinel) for inactive class', () => {
    const result = calcTimeToLevel(TREES, PROJECTIONS);
    const warrior = result.find(r => r.className === 'Warrior')!;
    expect(warrior.daysRemaining).toBe(-1); // impl coerces Infinity → -1 for JSON safety
  });

  it('returns daysRemaining=0 when xpNeeded is 0', () => {
    const trees = [{ id: 'sage', name: 'Sage', level: 26, currentXP: 13265, xpToNextLevel: 13265 }];
    const result = calcTimeToLevel(trees, { Sage: { avgDailyXP: 5 } });
    expect(result[0].daysRemaining).toBe(0);
    expect(result[0].projectedDate).toBe('Already at max');
  });

  it('handles missing projection entry (treats as inactive)', () => {
    const trees = [{ id: 'artist', name: 'Artist', level: 1, currentXP: 0, xpToNextLevel: 282 }];
    const result = calcTimeToLevel(trees, {}); // no Artist projection
    expect(result[0].isInactive).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// parseDisciplineData() — breach detection per entry type
// ─────────────────────────────────────────────────────────────

const STANDARD_BREACH_FIXTURE = `
### Feb 27 → Feb 28, 2026 (Fri → Sat)
**Grit Score:** 6/12 (50%)
- ❌ Abstained from undisciplined alcohol indulgence
- ❌ Abstained from undisciplined sexual indulgence
- ✅ Dr. Alfred Diet Plan (no junk food)
`;

const SHORT_FORM_FIXTURE = `
### Feb 26 → Feb 27, 2026 (Thu → Fri)
**Grit Score:** 8/12 (67%)
- ✅ Abstained from alcohol
- ✅ Abstained from sexual indulgence
- ❌ Dr. Alfred Diet Plan (had sweets — biscotti)
`;

const CHECKBOX_UNLOGGED_FIXTURE = `
### Feb 25 → Feb 26, 2026 (Wed → Thu)
**Grit Score:** 0/12 (0%)
- [ ] Abstained from undisciplined alcohol indulgence
- [ ] Abstained from undisciplined sexual indulgence
- [ ] Dr. Alfred Diet Plan
`;

const DIET_REDMEAT_FIXTURE = `
### Feb 24 → Feb 25, 2026 (Tue → Wed)
- ✅ Abstained from undisciplined alcohol indulgence
- ✅ Abstained from undisciplined sexual indulgence
- ❌ Dr. Alfred Diet Plan (had steak at dinner)
`;

const DIET_OTHER_FIXTURE = `
### Feb 23 → Feb 24, 2026 (Mon → Tue)
- ✅ Abstained from undisciplined alcohol indulgence
- ✅ Abstained from undisciplined sexual indulgence
- ❌ Dr. Alfred Diet Plan (grabbed fast food)
`;

const CLEAN_FIXTURE = `
### Feb 22 → Feb 23, 2026 (Sun → Mon)
- ✅ Abstained from undisciplined alcohol indulgence
- ✅ Abstained from undisciplined sexual indulgence
- ✅ Dr. Alfred Diet Plan (clean all day)
`;

describe('parseDisciplineData() — breach detection', () => {
  describe('standard ✅/❌ with "undisciplined" keyword', () => {
    it('detects alcohol breach (❌)', () => {
      const r = parseDisciplineData(STANDARD_BREACH_FIXTURE);
      expect(r.entries[0].breaches.alcohol).toBe(true);
    });

    it('detects lust breach (❌)', () => {
      const r = parseDisciplineData(STANDARD_BREACH_FIXTURE);
      expect(r.entries[0].breaches.lust).toBe(true);
    });

    it('does NOT detect diet breach when ✅', () => {
      const r = parseDisciplineData(STANDARD_BREACH_FIXTURE);
      expect(r.entries[0].breaches.diet).toBe(false);
    });
  });

  describe('short-form entries (no "undisciplined" keyword)', () => {
    it('does NOT breach alcohol when ✅ short-form', () => {
      const r = parseDisciplineData(SHORT_FORM_FIXTURE);
      expect(r.entries[0].breaches.alcohol).toBe(false);
    });

    it('does NOT breach lust when ✅ short-form', () => {
      const r = parseDisciplineData(SHORT_FORM_FIXTURE);
      expect(r.entries[0].breaches.lust).toBe(false);
    });

    it('detects diet breach (❌ short-form) with sweets subcategory', () => {
      const r = parseDisciplineData(SHORT_FORM_FIXTURE);
      expect(r.entries[0].breaches.diet).toBe(true);
      expect(r.entries[0].breaches.sweets).toBe(true);
    });
  });

  describe('checkbox format [ ] / [x] (unlogged day → treated as no breach)', () => {
    it('alcohol [ ] is NOT counted as a breach', () => {
      const r = parseDisciplineData(CHECKBOX_UNLOGGED_FIXTURE);
      expect(r.entries[0].breaches.alcohol).toBe(false);
    });

    it('lust [ ] is NOT counted as a breach', () => {
      const r = parseDisciplineData(CHECKBOX_UNLOGGED_FIXTURE);
      expect(r.entries[0].breaches.lust).toBe(false);
    });

    it('diet [ ] is NOT counted as a breach', () => {
      const r = parseDisciplineData(CHECKBOX_UNLOGGED_FIXTURE);
      expect(r.entries[0].breaches.diet).toBe(false);
    });
  });

  describe('diet sub-categories', () => {
    it('classifies "steak" as redMeat breach', () => {
      const r = parseDisciplineData(DIET_REDMEAT_FIXTURE);
      expect(r.entries[0].breaches.redMeat).toBe(true);
      expect(r.entries[0].breaches.sweets).toBe(false);
      expect(r.entries[0].breaches.other).toBe(false);
    });

    it('classifies unrecognised diet fail as "other"', () => {
      const r = parseDisciplineData(DIET_OTHER_FIXTURE);
      expect(r.entries[0].breaches.other).toBe(true);
      expect(r.entries[0].breaches.sweets).toBe(false);
      expect(r.entries[0].breaches.redMeat).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// parseDisciplineData() — aggregate statistics
// ─────────────────────────────────────────────────────────────

/** 3-entry fixture: 1 breach each for alcohol, lust, diet */
const THREE_ENTRY_FIXTURE = STANDARD_BREACH_FIXTURE + SHORT_FORM_FIXTURE + CLEAN_FIXTURE;

describe('parseDisciplineData() — aggregate statistics', () => {
  it('alcoholPassRate = 100% when no breaches in any entry', () => {
    const r = parseDisciplineData(CLEAN_FIXTURE);
    expect(r.alcoholPassRate).toBe(100);
  });

  it('alcoholPassRate = 0% when all entries breach alcohol', () => {
    const r = parseDisciplineData(STANDARD_BREACH_FIXTURE);
    expect(r.alcoholPassRate).toBe(0);
  });

  it('alcoholPassRate = 67% when 2 out of 3 entries are clean', () => {
    // THREE_ENTRY_FIXTURE: standard breach (❌), short-form (✅), clean (✅)
    const r = parseDisciplineData(THREE_ENTRY_FIXTURE);
    expect(r.alcoholPassRate).toBe(67); // Math.round((1 - 1/3) * 100) = 67
  });

  it('disciplineScore uses weighted formula: alcohol×0.35 + lust×0.30 + diet×0.35', () => {
    // All clean: 100×0.35 + 100×0.30 + 100×0.35 = 100
    const rClean = parseDisciplineData(CLEAN_FIXTURE);
    expect(rClean.disciplineScore).toBe(100);
  });

  it('disciplineScore = 0 when all categories breach every day', () => {
    const combo = STANDARD_BREACH_FIXTURE.replace(
      '- ✅ Dr. Alfred Diet Plan (no junk food)',
      '- ❌ Dr. Alfred Diet Plan (ate sweets)'
    );
    const r = parseDisciplineData(combo);
    expect(r.disciplineScore).toBe(0);
  });

  it('sweetsBreachCount counts entries with sweets diet sub-breach', () => {
    const r = parseDisciplineData(SHORT_FORM_FIXTURE);
    expect(r.sweetsBreachCount).toBe(1);
  });

  it('redMeatBreachCount counts entries with red-meat diet sub-breach', () => {
    const r = parseDisciplineData(DIET_REDMEAT_FIXTURE);
    expect(r.redMeatBreachCount).toBe(1);
  });

  it('otherBreachCount counts entries with unclassified diet breach', () => {
    const r = parseDisciplineData(DIET_OTHER_FIXTURE);
    expect(r.otherBreachCount).toBe(1);
  });

  it('mixingEvents counts days with 2+ main discipline breaches', () => {
    // STANDARD_BREACH_FIXTURE: alcohol ❌ + lust ❌ → 2 breaches → 1 mixing event
    const r = parseDisciplineData(STANDARD_BREACH_FIXTURE);
    expect(r.mixingEvents).toBe(1);
  });

  it('alcoholStreak = consecutive clean days from most recent entry', () => {
    // THREE_ENTRY_FIXTURE order: STANDARD (breach), SHORT (clean), CLEAN (clean)
    // Most recent = STANDARD → streak starts at 0 right away
    const r = parseDisciplineData(THREE_ENTRY_FIXTURE);
    expect(r.alcoholStreak).toBe(0);
  });

  it('alcoholStreak = entry count when no breaches at all', () => {
    const r = parseDisciplineData(CLEAN_FIXTURE);
    expect(r.alcoholStreak).toBe(1);
  });

  it('respects maxEntries limit', () => {
    const r = parseDisciplineData(THREE_ENTRY_FIXTURE, 1);
    expect(r.entries.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Arrow format regression — Apr 2026 migration from → to ->
//
// Before the fix (commit 586a40f) the regex only matched Unicode →.
// All entries written Apr 2026+ use ASCII ->.
// These tests pin both formats so the regression can never re-occur.
// ─────────────────────────────────────────────────────────────

/** ASCII arrow entries — format used from Apr 2026 onwards */
const ASCII_ARROW_FIXTURE = `
### Apr 29 -> Apr 30, 2026 (Wed -> Thu)

- Developer: +54 XP
- Warrior: +8 XP
**Grit Score:** 9/12 (75%)

### Apr 28 -> Apr 29, 2026 (Tue -> Wed)

- Developer: +72 XP
- Sage: +12 XP
**Grit Score:** 6/12 (50%)
`;

/** Mixed: recent entries use -> (Apr 2026+), archives use → (pre-Apr 2026) */
const MIXED_ARROW_FIXTURE = `
### Apr 29 -> Apr 30, 2026 (Wed -> Thu)

- Developer: +54 XP

### Feb 27 → Feb 28, 2026 (Fri → Sat)

- Sage: +8 XP
`;

describe('parseRecentEntries() — arrow format regression', () => {
  it('parses entries with ASCII -> arrow (Apr 2026+ format)', () => {
    const result = parseRecentEntries(ASCII_ARROW_FIXTURE);
    expect(result.length).toBe(2);
    expect(result[0].dateLabel).toBe('Apr 29');
    expect(result[0].classXP['Developer']).toBe(54);
    expect(result[0].classXP['Warrior']).toBe(8);
    expect(result[0].gritPct).toBe(75);
  });

  it('parses XP from second ASCII -> entry correctly', () => {
    const result = parseRecentEntries(ASCII_ARROW_FIXTURE);
    expect(result[1].dateLabel).toBe('Apr 28');
    expect(result[1].classXP['Developer']).toBe(72);
    expect(result[1].classXP['Sage']).toBe(12);
  });

  it('parses files containing both → and -> arrows (archive + current)', () => {
    const result = parseRecentEntries(MIXED_ARROW_FIXTURE);
    expect(result.length).toBe(2);
    expect(result[0].dateLabel).toBe('Apr 29'); // ASCII ->
    expect(result[1].dateLabel).toBe('Feb 27'); // Unicode →
  });

  it('returns 0 entries when content only has → but regex now requires both formats', () => {
    // Sanity-check: pure → content is still parsed (archives still work)
    const unicodeOnly = `
### Feb 27 → Feb 28, 2026 (Fri → Sat)

- Sage: +8 XP
`;
    const result = parseRecentEntries(unicodeOnly);
    expect(result.length).toBe(1);
    expect(result[0].classXP['Sage']).toBe(8);
  });
});

describe('parseDisciplineData() — arrow format regression', () => {
  it('counts ASCII -> entries in discipline data', () => {
    const result = parseDisciplineData(ASCII_ARROW_FIXTURE);
    expect(result.entries.length).toBe(2);
  });

  it('counts mixed arrow entries in discipline data', () => {
    const result = parseDisciplineData(MIXED_ARROW_FIXTURE);
    expect(result.entries.length).toBe(2);
  });
});
