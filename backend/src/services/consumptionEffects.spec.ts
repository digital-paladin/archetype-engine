import { resolveConsumptionConfig } from '../config/consumptionEffects.config';
import {
  bedtimeForDate,
  hoursUntilBedtime,
  planConsumptionEffects,
  projectAlcohol,
  projectCaffeine,
  projectHydration,
  projectMelatonin,
  projectProtein,
  projectSugar,
  standardDrinks,
  AlcoholDose,
  detectDietFlags,
} from './consumptionEffects';
import { planLegacyJsonImport, readLegacyEffectsFile } from './statusEffect.store';
import fs from 'fs';
import os from 'os';
import path from 'path';

const cfg = resolveConsumptionConfig();
const TZ = 'America/Chicago';
const TUESDAY = '2026-10-20';
const WEDNESDAY = '2026-10-21';

function millerDose(at: Date, hoursUntilBed: number): AlcoholDose {
  return {
    at: at.toISOString(),
    standardDrinks: standardDrinks(12, 4.2),
    volumeOz: 12,
    abvPercent: 4.2,
    itemName: 'Miller Lite (12 oz)',
    hoursUntilBed,
  };
}

function stat(draft: { effects: Array<{ stat: string; modifier: string }> } | null, name: string): string | undefined {
  return draft?.effects.find(effect => effect.stat === name)?.modifier;
}

describe('standard drinks', () => {
  it('counts 12 oz at 4.2% ABV as 0.84 US standard drinks', () => {
    expect(standardDrinks(12, 4.2)).toBeCloseTo(0.84, 5);
  });
});

describe('bedtime schedule', () => {
  const envKeys = ['CONSUMPTION_BEDTIME', 'CONSUMPTION_BEDTIME_BY_WEEKDAY', 'CONSUMPTION_EFFECTS_JSON'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('defaults to 21:30, with Tuesday lights-out at 22:15', () => {
    expect(cfg.defaultBedtime).toBe('21:30');
    expect(bedtimeForDate(TUESDAY, cfg)).toBe('22:15');
    expect(bedtimeForDate(WEDNESDAY, cfg)).toBe('21:30');
    expect(bedtimeForDate('2026-10-19', cfg)).toBe('21:30');
  });

  it('reads a weekday map from the environment and ignores a bad payload', () => {
    process.env.CONSUMPTION_BEDTIME = '21:00';
    process.env.CONSUMPTION_BEDTIME_BY_WEEKDAY = '{"tue":"22:45","nope":"99:99"}';
    const tuned = resolveConsumptionConfig();
    expect(tuned.defaultBedtime).toBe('21:00');
    expect(bedtimeForDate(TUESDAY, tuned)).toBe('22:45');
    expect(bedtimeForDate(WEDNESDAY, tuned)).toBe('21:00');

    process.env.CONSUMPTION_BEDTIME_BY_WEEKDAY = '{';
    expect(bedtimeForDate(TUESDAY, resolveConsumptionConfig())).toBe('22:15');
  });

  it('deep-merges CONSUMPTION_EFFECTS_JSON onto the weekday map', () => {
    process.env.CONSUMPTION_BEDTIME_BY_WEEKDAY = '{"monday":"22:00"}';
    process.env.CONSUMPTION_EFFECTS_JSON = '{"defaultBedtime":"21:15","bedtimeByWeekday":{"friday":"23:00"}}';
    const tuned = resolveConsumptionConfig();
    expect(tuned.defaultBedtime).toBe('21:15');
    expect(bedtimeForDate('2026-10-19', tuned)).toBe('22:00');
    expect(bedtimeForDate('2026-10-23', tuned)).toBe('23:00');
    expect(bedtimeForDate(TUESDAY, tuned)).toBe('21:15');
  });

  it('lets a caller override add a weekday without dropping Tuesday', () => {
    const caller = resolveConsumptionConfig({ bedtimeByWeekday: { sunday: '22:30' } });
    expect(caller.defaultBedtime).toBe('21:30');
    expect(bedtimeForDate('2026-10-18', caller)).toBe('22:30');
    expect(bedtimeForDate(TUESDAY, caller)).toBe('22:15');
  });
});

describe('Miller Lite versus bedtime', () => {
  function shadow(iso: string, bed: string) {
    const at = new Date(iso);
    const hours = hoursUntilBedtime(at, bed, TZ);
    return projectAlcohol([millerDose(at, hours)], at, cfg)!;
  }

  it('on Tuesday (bed 22:15) a 7:00 PM beer is milder than the same beer at 9:45 PM', () => {
    const early = shadow(`${TUESDAY}T19:00:00-05:00`, '22:15');
    expect(early.name).toBe('Alcohol Shadow');
    expect(early.dose).toBe('0.84 standard drinks');
    expect(early.source).toContain('Miller Lite (12 oz)');
    expect(early.source).toContain('4.2% ABV');
    expect(early.source).toContain('3.25h before bedtime');
    expect(stat(early, 'Sleep Quality')).toBe('-5%');
    expect(stat(early, 'Recovery Rate')).toBe('-4%');
    expect(stat(early, 'XP Consolidation')).toBe('-3%');
    expect(stat(early, 'Testosterone')).toBe('-2%');
    expect(stat(early, 'Pleasure / Social Freedom')).toBe('+Mild');
    expect(early.duration).toBe(160);
    expect(early.autoApplied).toBe(true);
    expect(early.effectKey).toBe('alcohol');

    const late = shadow(`${TUESDAY}T21:45:00-05:00`, '22:15');
    expect(late.dose).toBe('0.84 standard drinks');
    expect(late.source).toContain('0.5h before bedtime');
    expect(stat(late, 'Sleep Quality')).toBe('-10%');
    expect(stat(late, 'Recovery Rate')).toBe('-8%');
    expect(stat(late, 'XP Consolidation')).toBe('-5%');
    expect(stat(late, 'Testosterone')).toBe('-4%');
    expect(stat(late, 'Pleasure / Social Freedom')).toBe('+Mild');
    expect(late.duration).toBe(270);
  });

  it('on a normal weekday (bed 21:30) 7:00 PM is heavier, and 9:45 PM is a nightcap', () => {
    const early = shadow(`${WEDNESDAY}T19:00:00-05:00`, '21:30');
    expect(hoursUntilBedtime(new Date(`${WEDNESDAY}T19:00:00-05:00`), '21:30', TZ)).toBeCloseTo(2.5, 5);
    expect(early.source).toContain('2.5h before bedtime');
    expect(stat(early, 'Sleep Quality')).toBe('-7%');
    expect(stat(early, 'Recovery Rate')).toBe('-5%');
    expect(stat(early, 'XP Consolidation')).toBe('-3%');
    expect(stat(early, 'Testosterone')).toBe('-3%');
    expect(stat(early, 'Pleasure / Social Freedom')).toBe('+Mild');
    expect(early.duration).toBe(190);

    const lateAt = new Date(`${WEDNESDAY}T21:45:00-05:00`);
    expect(hoursUntilBedtime(lateAt, '21:30', TZ)).toBe(0);
    const late = shadow(`${WEDNESDAY}T21:45:00-05:00`, '21:30');
    expect(late.source).toContain('at or after bedtime');
    expect(stat(late, 'Sleep Quality')).toBe('-11%');
    expect(stat(late, 'Recovery Rate')).toBe('-8%');
    expect(stat(late, 'XP Consolidation')).toBe('-5%');
    expect(stat(late, 'Testosterone')).toBe('-4%');
    expect(stat(late, 'Pleasure / Social Freedom')).toBe('+Mild');
    expect(late.duration).toBe(290);
  });

  it('merges a second Tuesday beer into one heavier effect instead of a second row', () => {
    const bed = bedtimeForDate(TUESDAY, cfg);
    const later = new Date(`${TUESDAY}T21:45:00-05:00`);
    const earlier = new Date(later.getTime() - 20 * 60 * 1000);
    const doses = [
      millerDose(earlier, hoursUntilBedtime(earlier, bed, TZ)),
      millerDose(later, hoursUntilBedtime(later, bed, TZ)),
    ];
    const draft = projectAlcohol(doses, later, cfg);
    expect(draft!.effectKey).toBe('alcohol');
    expect(Number(draft!.dose.split(' ')[0])).toBeGreaterThan(0.84);
    expect(parseInt(stat(draft, 'Sleep Quality')!.replace('%', ''), 10)).toBeLessThan(-10);
  });
});

describe('other consumption effects', () => {
  const morning = new Date('2026-10-20T15:00:00-05:00'); // 10:00 Chicago

  it('scales caffeine and only penalizes sleep close to bedtime', () => {
    const early = projectCaffeine([{
      at: morning.toISOString(), mg: 95, itemName: 'Black Coffee (8 oz)', hoursUntilBed: 13,
    }], morning, cfg);
    expect(stat(early, 'Focus')).toBe('+12%');
    expect(stat(early, 'Mental Clarity')).toBe('+8%');
    expect(stat(early, 'Sleep Quality')).toBeUndefined();
    expect(early!.duration).toBe(300);
    expect(early!.dose).toBe('95 mg caffeine');

    const late = projectCaffeine([{
      at: morning.toISOString(), mg: 95, itemName: 'Black Coffee (8 oz)', hoursUntilBed: 3,
    }], morning, cfg);
    expect(stat(late, 'Sleep Quality')).toBe('-4%');
    expect(late!.type).toBe('mixed');
  });

  it('holds off dehydration until the afternoon and clears it at the goal', () => {
    const morningDrafts = projectHydration(0, 10, cfg);
    expect(morningDrafts.every(d => d.remove || d.effectKey !== 'dehydration' || d.remove)).toBe(true);
    expect(morningDrafts.find(d => d.effectKey === 'dehydration')?.remove).toBe(true);

    const dry = projectHydration(0, 15, cfg).find(d => d.effectKey === 'dehydration');
    expect(dry?.remove).toBeFalsy();
    expect(stat(dry ?? null, 'Focus')).toBe('-25%');
    expect(stat(dry ?? null, 'Vitality')).toBe('-5 pts');

    const wet = projectHydration(100, 15, cfg);
    expect(wet.find(d => d.effectKey === 'hydrated')?.dose).toBe('100 oz');
    expect(wet.find(d => d.effectKey === 'dehydration')?.remove).toBe(true);
  });

  it('scales added sugar and ignores amounts under the threshold', () => {
    expect(projectSugar([{ at: morning.toISOString(), grams: 4, itemName: 'Taste' }], morning, cfg)).toBeNull();
    const rush = projectSugar([{ at: morning.toISOString(), grams: 12, itemName: 'Soda' }], morning, cfg);
    expect(rush!.dose).toBe('12 g added sugar');
    expect(stat(rush, 'Focus')).toBe('-5%');
    expect(rush!.effects.find(e => e.stat === 'Energy')?.modifier).toBe('+Mild');
  });

  it('uses 130 g as the protein goal until a body weight is configured', () => {
    const partial = projectProtein(104, cfg).find(d => d.effectKey === 'protein-building');
    expect(partial?.remove).toBeFalsy();
    expect(partial?.dose).toBe('104 g / 130 g');
    const goal = projectProtein(130, cfg).find(d => d.effectKey === 'protein-goal');
    expect(stat(goal ?? null, 'Recovery Rate')).toBe('+8%');
    expect(projectProtein(130, cfg).find(d => d.effectKey === 'protein-building')?.remove).toBe(true);
  });

  it('caps creatine, and lets the latest melatonin dose replace the earlier one', () => {
    const planned = planConsumptionEffects({
      itemName: 'Titan Salt of the Forge',
      consumedAt: morning.toISOString(),
      supplements: [{ key: 'creatine', amount: 10, unit: 'g' }, { key: 'fish-oil', amount: 1, unit: 'g' }],
    }, {
      now: morning,
      bedtime: '21:30',
      timeZone: TZ,
      hydrationOz: 80,
      proteinGrams: 40,
      localHour: 10,
      alcoholDoses: [],
      caffeineDoses: [],
      sugarDoses: [],
      creatineDoses: [],
      magnesiumDoses: [],
      melatoninDoses: [],
      config: cfg,
    });
    const creatine = planned.find(d => d.effectKey === 'creatine');
    expect(stat(creatine ?? null, 'Strength')).toBe('+8%');
    expect(planned.some(d => d.effectKey === 'fish-oil')).toBe(false);

    const melatonin = projectMelatonin([
      { at: new Date(morning.getTime() - 3600000).toISOString(), amount: 0.5, itemName: 'first' },
      { at: morning.toISOString(), amount: 5, itemName: 'second' },
    ], morning, cfg);
    expect(melatonin!.dose).toBe('5 mg melatonin');
    expect(stat(melatonin, 'Focus')).toBe('-5%');
    expect(melatonin!.type).toBe('mixed');
  });
});

describe('diet flags and legacy json', () => {
  it('flags avocado and seed oils without treating them as a block list in the math', () => {
    expect(detectDietFlags('Avocado (½ medium)')).toContain('avocado');
    expect(detectDietFlags('Dressing', 'soybean oil')).toContain('seed-oil');
    expect(detectDietFlags('Miller Lite (12 oz)')).toEqual([]);
    expect(detectDietFlags('Creatine monohydrate (5 g)')).toEqual([]);
  });

  it('imports an empty-table json file and ignores one when rows already exist', () => {
    expect(planLegacyJsonImport({ fileFound: false, rowCount: 0, effectCount: 0 }).action).toBe('skip');
    expect(planLegacyJsonImport({ fileFound: true, rowCount: 3, effectCount: 2 }).action).toBe('ignore');
    expect(planLegacyJsonImport({ fileFound: true, rowCount: 0, effectCount: 0 }).action).toBe('ignore');
    expect(planLegacyJsonImport({ fileFound: true, rowCount: 0, effectCount: 2 }).action).toBe('import');
    expect(planLegacyJsonImport({
      fileFound: true, rowCount: 0, effectCount: 0, readError: 'bad json',
    }).action).toBe('ignore');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effects-'));
    const file = path.join(dir, 'status-effects.json');
    fs.writeFileSync(file, '{');
    expect(readLegacyEffectsFile(file).error).toBeTruthy();
    fs.writeFileSync(file, JSON.stringify([{ id: 'e1', name: 'Old', type: 'buff', source: 'disk', icon: '✦' }]));
    const read = readLegacyEffectsFile(file);
    expect(read.effects).toHaveLength(1);
    expect(read.effects[0].name).toBe('Old');
  });
});
