import { resolveConsumptionConfig } from '../config/consumptionEffects.config';
import {
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
const BED = '23:00';

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

describe('Miller Lite versus bedtime', () => {
  const at7 = new Date('2026-10-20T19:00:00-05:00');
  const at945 = new Date('2026-10-20T21:45:00-05:00');

  it('places 7:00 PM 4h before a 23:00 bedtime and 9:45 PM 1.25h before it', () => {
    expect(hoursUntilBedtime(at7, BED, TZ)).toBeCloseTo(4, 5);
    expect(hoursUntilBedtime(at945, BED, TZ)).toBeCloseTo(1.25, 5);
  });

  it('makes one light beer at 7 PM a mild, short Alcohol Shadow', () => {
    const draft = projectAlcohol([millerDose(at7, 4)], at7, cfg);
    expect(draft).not.toBeNull();
    expect(draft!.name).toBe('Alcohol Shadow');
    expect(draft!.dose).toBe('0.84 standard drinks');
    expect(draft!.source).toContain('Miller Lite (12 oz)');
    expect(draft!.source).toContain('4.2% ABV');
    expect(draft!.source).toContain('4h before bedtime');
    expect(stat(draft, 'Sleep Quality')).toBe('-4%');
    expect(stat(draft, 'Recovery Rate')).toBe('-3%');
    expect(stat(draft, 'XP Consolidation')).toBe('-2%');
    expect(stat(draft, 'Testosterone')).toBe('-2%');
    expect(stat(draft, 'Pleasure / Social Freedom')).toBe('+Mild');
    expect(draft!.duration).toBe(130);
    expect(draft!.autoApplied).toBe(true);
    expect(draft!.effectKey).toBe('alcohol');
  });

  it('makes the same beer at 9:45 PM a heavier, longer Alcohol Shadow', () => {
    const draft = projectAlcohol([millerDose(at945, 1.25)], at945, cfg);
    expect(draft!.dose).toBe('0.84 standard drinks');
    expect(draft!.source).toContain('1.25h before bedtime');
    expect(stat(draft, 'Sleep Quality')).toBe('-9%');
    expect(stat(draft, 'Recovery Rate')).toBe('-7%');
    expect(stat(draft, 'XP Consolidation')).toBe('-5%');
    expect(stat(draft, 'Testosterone')).toBe('-4%');
    expect(stat(draft, 'Pleasure / Social Freedom')).toBe('+Mild');
    expect(draft!.duration).toBe(240);
  });

  it('merges a second beer into one heavier effect instead of a second row', () => {
    const later = new Date('2026-10-20T21:45:00-05:00');
    const earlier = new Date(later.getTime() - 20 * 60 * 1000);
    const doses = [
      millerDose(earlier, hoursUntilBedtime(earlier, BED, TZ)),
      millerDose(later, hoursUntilBedtime(later, BED, TZ)),
    ];
    const draft = projectAlcohol(doses, later, cfg);
    expect(draft!.effectKey).toBe('alcohol');
    expect(Number(draft!.dose.split(' ')[0])).toBeGreaterThan(0.84);
    expect(parseInt(stat(draft, 'Sleep Quality')!.replace('%', ''), 10)).toBeLessThan(-9);
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
      bedtime: BED,
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
