/**
 * Pure dose → status-effect math. No database and no clock besides the `now`
 * argument. Rationale and sources: docs/CONSUMPTION-EFFECTS.md.
 */

import {
  ConsumptionEffectsConfig,
  proteinGoalGrams,
  resolveConsumptionConfig,
} from '../config/consumptionEffects.config';
import { EffectStat, StatusEffectCategory, StatusEffectType } from '../models/statusEffect';

export interface AlcoholDose {
  at: string;
  standardDrinks: number;
  volumeOz: number;
  abvPercent: number;
  itemName: string;
  hoursUntilBed: number;
}

export interface CaffeineDose {
  at: string;
  mg: number;
  itemName: string;
  hoursUntilBed: number;
}

export interface SugarDose {
  at: string;
  grams: number;
  itemName: string;
}

export interface SupplementDose {
  at: string;
  amount: number;
  itemName: string;
}

export interface EffectDraft {
  effectKey: string;
  name: string;
  type: StatusEffectType;
  category: StatusEffectCategory;
  source: string;
  icon: string;
  effects: EffectStat[];
  /** Minutes from `now`. -1 = until the condition clears. */
  duration: number;
  dose: string;
  notes: string;
  autoApplied: true;
  meta: Record<string, unknown>;
  remove?: boolean;
}

export interface ConsumptionSignals {
  itemName: string;
  consumedAt: string;
  waterOz?: number;
  caffeineMg?: number;
  addedSugarG?: number;
  alcohol?: { volumeOz: number; abvPercent: number } | null;
  supplements?: Array<{ key: string; amount: number; unit?: string }>;
}

export interface EffectContext {
  now: Date;
  bedtime: string;
  timeZone: string;
  hydrationOz: number;
  proteinGrams: number;
  localHour: number;
  alcoholDoses: AlcoholDose[];
  caffeineDoses: CaffeineDose[];
  sugarDoses: SugarDose[];
  creatineDoses: SupplementDose[];
  magnesiumDoses: SupplementDose[];
  melatoninDoses: SupplementDose[];
  config?: ConsumptionEffectsConfig;
}

const DIET_PATTERNS: Array<{ flag: string; pattern: RegExp }> = [
  { flag: 'avocado', pattern: /avocado/ },
  { flag: 'seed-oil', pattern: /seed oil|canola|soybean oil|vegetable oil|sunflower oil|safflower|corn oil|grapeseed|rapeseed/ },
];

export function detectDietFlags(itemName: string, extra = ''): string[] {
  const text = `${itemName} ${extra}`.toLowerCase();
  return DIET_PATTERNS.filter(entry => entry.pattern.test(text)).map(entry => entry.flag);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function roundPct(value: number, cap: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(cap, Math.max(0, Math.round(value)));
}

export function standardDrinks(
  volumeOz: number,
  abvPercent: number,
  ozEthanolPerStandardDrink = 0.6,
): number {
  if (volumeOz <= 0 || abvPercent <= 0 || ozEthanolPerStandardDrink <= 0) return 0;
  return (volumeOz * (abvPercent / 100)) / ozEthanolPerStandardDrink;
}

export function formatAmount(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '0';
  const factor = 10 ** digits;
  const rounded = Math.round(n * factor) / factor;
  const text = rounded.toFixed(digits);
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

export function zonedParts(date: Date, timeZone: string): {
  year: number; month: number; day: number; hour: number; minute: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

export function localDateInZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Hours until today's bedtime. After bedtime this is 0 (nightcap). */
export function hoursUntilBedtime(at: Date, bedtimeHHMM: string, timeZone: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(bedtimeHHMM.trim());
  if (!match) return 0;
  const bedMin = Number(match[1]) * 60 + Number(match[2]);
  const local = zonedParts(at, timeZone);
  const nowMin = local.hour * 60 + local.minute;
  const delta = bedMin - nowMin;
  return delta <= 0 ? 0 : delta / 60;
}

export function normalizeBedtime(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const match = /^(\d{1,2}):(\d{2})/.exec(String(raw).trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function pctStat(stat: string, percent: number, direction: 'positive' | 'negative'): EffectStat | null {
  if (percent <= 0) return null;
  const sign = direction === 'negative' ? '-' : '+';
  return { stat, modifier: `${sign}${percent}%`, direction };
}

function alcoholProximity(hoursUntilBed: number, cfg: ConsumptionEffectsConfig): number {
  const a = cfg.alcohol;
  return clamp(
    a.proximityIntercept - a.proximitySlope * Math.max(0, hoursUntilBed),
    a.proximityMin,
    a.proximityMax,
  );
}

function alcoholTailMinutes(hoursUntilBed: number, cfg: ConsumptionEffectsConfig): number {
  const a = cfg.alcohol;
  return clamp(a.tailIntercept - a.tailSlope * Math.max(0, hoursUntilBed), a.tailMin, a.tailMax);
}

function alcoholWindowMs(dose: AlcoholDose, cfg: ConsumptionEffectsConfig): number {
  const clearanceH = dose.standardDrinks / cfg.alcohol.clearanceDrinksPerHour;
  const tailH = alcoholTailMinutes(dose.hoursUntilBed, cfg) / 60;
  return (clearanceH + tailH) * 3600000;
}

export function projectAlcohol(
  doses: AlcoholDose[],
  now: Date,
  cfg: ConsumptionEffectsConfig,
): EffectDraft | null {
  const nowMs = now.getTime();
  const active = doses.filter(d => d.standardDrinks > 0 && new Date(d.at).getTime() + alcoholWindowMs(d, cfg) > nowMs);
  if (active.length === 0) return null;

  let burden = 0;
  let logged = 0;
  let proximity = 0;
  for (const dose of active) {
    const elapsedH = Math.max(0, (nowMs - new Date(dose.at).getTime()) / 3600000);
    const remaining = Math.max(0, dose.standardDrinks - elapsedH * cfg.alcohol.clearanceDrinksPerHour);
    burden += remaining;
    logged += dose.standardDrinks;
    if (remaining > 0.001) proximity = Math.max(proximity, alcoholProximity(dose.hoursUntilBed, cfg));
  }
  if (burden <= 0.001) return null;

  const severity = burden * proximity;
  const a = cfg.alcohol;
  const sleep = roundPct(a.sleepPerSeverity * severity, a.sleepCap);
  const recovery = roundPct(a.recoveryPerSeverity * severity, a.recoveryCap);
  const xp = roundPct(a.xpPerSeverity * severity, a.xpCap);
  const testosterone = roundPct(a.testosteronePerSeverity * severity, a.testosteroneCap);
  const pleasure = burden < a.pleasureMildBelow
    ? '+Mild'
    : burden < a.pleasureModerateBelow
      ? '+Moderate'
      : '+High';

  const effects = [
    pctStat('Sleep Quality', sleep, 'negative'),
    pctStat('Recovery Rate', recovery, 'negative'),
    pctStat('XP Consolidation', xp, 'negative'),
    pctStat('Testosterone', testosterone, 'negative'),
    burden >= 0.25 ? { stat: 'Pleasure / Social Freedom', modifier: pleasure, direction: 'positive' as const } : null,
  ].filter((row): row is EffectStat => !!row);

  if (effects.length === 0) return null;

  const expiresMs = Math.max(...active.map(d => new Date(d.at).getTime() + alcoholWindowMs(d, cfg)));
  const duration = Math.max(1, Math.round((expiresMs - nowMs) / 60000));
  const latest = active.reduce((a, b) => (new Date(a.at).getTime() >= new Date(b.at).getTime() ? a : b));
  return {
    effectKey: 'alcohol',
    name: 'Alcohol Shadow',
    type: 'mixed',
    category: 'substance',
    source: alcoholSource(active, latest),
    icon: '🍺',
    effects,
    duration,
    dose: `${formatAmount(burden)} standard drinks`,
    notes: [
      `${formatAmount(logged)} standard drinks logged in this window, ${formatAmount(burden)} still clearing.`,
      `Proximity ${formatAmount(proximity)} at ${formatAmount(latest.hoursUntilBed)}h before bedtime.`,
      'Clearance is about 1 standard drink/hour, then a sleep/recovery tail. Modifiers are fixed until the next dose or expiry.',
    ].join(' '),
    autoApplied: true,
    meta: {
      kind: 'alcohol',
      doses: active,
      standardDrinks: round2(burden),
      loggedDrinks: round2(logged),
      hoursUntilBed: round2(latest.hoursUntilBed),
      proximity: round2(proximity),
      severity: round2(severity),
    },
  };
}

function formatBedtimePhrase(hoursUntilBed: number): string {
  if (hoursUntilBed <= 0) return 'at or after bedtime';
  return `${formatAmount(hoursUntilBed)}h before bedtime`;
}

function summarizeNames(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(' + ');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function alcoholSource(doses: AlcoholDose[], latest: AlcoholDose): string {
  return `${summarizeNames(doses.map(d => d.itemName))} · ${formatAmount(latest.abvPercent, 1)}% ABV · ${formatBedtimePhrase(latest.hoursUntilBed)}`;
}

export function projectCaffeine(
  doses: CaffeineDose[],
  now: Date,
  cfg: ConsumptionEffectsConfig,
): EffectDraft | null {
  const nowMs = now.getTime();
  const memoryMs = cfg.caffeine.memoryHours * 3600000;
  const active = doses.filter(d => d.mg > 0 && nowMs - new Date(d.at).getTime() < memoryMs);
  if (active.length === 0) return null;

  let remaining = 0;
  let proximity = 0;
  let withinBed = false;
  for (const dose of active) {
    const elapsedH = Math.max(0, (nowMs - new Date(dose.at).getTime()) / 3600000);
    const left = dose.mg * Math.pow(0.5, elapsedH / cfg.caffeine.halfLifeHours);
    remaining += left;
    if (left >= 5 && dose.hoursUntilBed < cfg.caffeine.sleepPenaltyWithinHours) {
      withinBed = true;
      proximity = Math.max(proximity, alcoholProximity(dose.hoursUntilBed, cfg));
    }
  }
  if (remaining < 5) return null;

  const c = cfg.caffeine;
  const ratio = remaining / c.referenceMg;
  const focus = roundPct(c.focusPerReference * ratio, c.focusCap);
  const clarity = roundPct(c.clarityPerReference * ratio, c.clarityCap);
  const sleep = withinBed ? roundPct(c.sleepPerReference * ratio * (proximity || 1), c.sleepCap) : 0;
  const effects = [
    pctStat('Focus', focus, 'positive'),
    pctStat('Mental Clarity', clarity, 'positive'),
    remaining >= c.fatigueTierMg
      ? { stat: 'Physical Fatigue', modifier: '−Tier 1', direction: 'positive' as const }
      : null,
    pctStat('Sleep Quality', sleep, 'negative'),
  ].filter((row): row is EffectStat => !!row);
  if (effects.length === 0) return null;

  const duration = clamp(
    Math.round(c.durationBaseMinutes * Math.sqrt(Math.max(ratio, 0.05))),
    c.durationMin,
    c.durationMax,
  );
  const hasNeg = effects.some(e => e.direction === 'negative');
  const hasPos = effects.some(e => e.direction === 'positive');

  return {
    effectKey: 'caffeine',
    name: 'Caffeine Clarity',
    type: hasNeg && hasPos ? 'mixed' : 'buff',
    category: 'substance',
    source: summarizeNames(active.map(d => d.itemName)),
    icon: '☕',
    effects,
    duration,
    dose: `${formatAmount(remaining, 0)} mg caffeine`,
    notes: `About ${formatAmount(remaining, 0)} mg still active (half-life ${c.halfLifeHours}h, reference ${c.referenceMg} mg). Sleep penalty applies only inside ${c.sleepPenaltyWithinHours}h of bedtime.`,
    autoApplied: true,
    meta: { kind: 'caffeine', doses: active, remainingMg: round2(remaining) },
  };
}

export function projectSugar(
  doses: SugarDose[],
  now: Date,
  cfg: ConsumptionEffectsConfig,
): EffectDraft | null {
  const nowMs = now.getTime();
  const memoryMs = cfg.sugar.memoryHours * 3600000;
  const active = doses.filter(d => d.grams > 0 && nowMs - new Date(d.at).getTime() < memoryMs);
  const grams = active.reduce((sum, d) => sum + d.grams, 0);
  if (grams < cfg.sugar.minGrams) return null;
  const s = cfg.sugar;
  const focus = roundPct(s.focusPer10g * (grams / 10), s.focusCap);
  const duration = clamp(
    Math.round(s.durationBase + s.durationPer10g * (grams / 10)),
    1,
    s.durationCap,
  );
  return {
    effectKey: 'sugar',
    name: 'Sugar Rush',
    type: 'mixed',
    category: 'food',
    source: summarizeNames(active.map(d => d.itemName)),
    icon: '🍬',
    effects: [
      { stat: 'Energy', modifier: grams >= s.spikeGrams ? '+Spike' : '+Mild', direction: 'positive' },
      ...(pctStat('Focus', focus, 'negative') ? [pctStat('Focus', focus, 'negative')!] : []),
      { stat: 'Insulin', modifier: grams >= s.insulinGrams ? '+Elevated' : '+Mild', direction: 'negative' },
    ],
    duration,
    dose: `${formatAmount(grams, 1)} g added sugar`,
    notes: 'Added sugar only. Fruit and other foods are not tagged unless addedSugarG is sent. The player rule is no added sugar; this is a modest debuff, not a block.',
    autoApplied: true,
    meta: { kind: 'sugar', doses: active, grams: round2(grams) },
  };
}

export function projectHydration(
  hydrationOz: number,
  localHour: number,
  cfg: ConsumptionEffectsConfig,
): EffectDraft[] {
  const h = cfg.hydration;
  const drafts: EffectDraft[] = [];
  if (hydrationOz >= h.goalOz) {
    drafts.push({
      effectKey: 'hydrated',
      name: 'Hydrated',
      type: 'buff',
      category: 'environmental',
      source: `${formatAmount(hydrationOz, 0)} / ${h.goalOz} oz`,
      icon: '💧',
      effects: [
        { stat: 'Focus', modifier: `+${h.hydratedFocus}%`, direction: 'positive' },
        { stat: 'Physical Output', modifier: `+${h.hydratedOutput}%`, direction: 'positive' },
      ],
      duration: h.hydratedDurationMinutes,
      dose: `${formatAmount(hydrationOz, 0)} oz`,
      notes: `Daily fluid goal is ${h.goalOz} oz. Food water is not estimated; only logged waterOz counts.`,
      autoApplied: true,
      meta: { kind: 'hydrated', hydrationOz },
    });
    drafts.push({ effectKey: 'dehydration', name: 'Dehydration', type: 'debuff', category: 'environmental', source: '', icon: '💧', effects: [], duration: -1, dose: '', notes: '', autoApplied: true, meta: {}, remove: true });
    return drafts;
  }

  drafts.push({ effectKey: 'hydrated', name: 'Hydrated', type: 'buff', category: 'environmental', source: '', icon: '💧', effects: [], duration: -1, dose: '', notes: '', autoApplied: true, meta: {}, remove: true });

  const pastCheck = localHour >= h.checkHourLocal;
  if (!pastCheck || hydrationOz >= h.dehydrationFloorOz) {
    drafts.push({ effectKey: 'dehydration', name: 'Dehydration', type: 'debuff', category: 'environmental', source: '', icon: '💧', effects: [], duration: -1, dose: '', notes: '', autoApplied: true, meta: {}, remove: true });
    return drafts;
  }

  const deficit = clamp((h.dehydrationFloorOz - hydrationOz) / h.dehydrationFloorOz, 0, 1);
  const focus = roundPct(h.focusAtFloor + (h.focusAtEmpty - h.focusAtFloor) * deficit, h.focusAtEmpty);
  const output = roundPct(h.outputAtFloor + (h.outputAtEmpty - h.outputAtFloor) * deficit, h.outputAtEmpty);
  const vitality = roundPct(h.vitalityPtsAtFloor + (h.vitalityPtsAtEmpty - h.vitalityPtsAtFloor) * deficit, h.vitalityPtsAtEmpty);
  drafts.push({
    effectKey: 'dehydration',
    name: 'Dehydration',
    type: 'debuff',
    category: 'environmental',
    source: `${formatAmount(hydrationOz, 0)} oz logged · floor ${h.dehydrationFloorOz} oz`,
    icon: '💧',
    effects: [
      ...(pctStat('Focus', focus, 'negative') ? [pctStat('Focus', focus, 'negative')!] : []),
      ...(pctStat('Physical Output', output, 'negative') ? [pctStat('Physical Output', output, 'negative')!] : []),
      vitality > 0 ? { stat: 'Vitality', modifier: `-${vitality} pts`, direction: 'negative' as const } : null,
    ].filter((row): row is EffectStat => !!row),
    duration: -1,
    dose: `${formatAmount(hydrationOz, 0)} / ${h.goalOz} oz`,
    notes: `Applied after local hour ${h.checkHourLocal} while intake is under ${h.dehydrationFloorOz} oz. Clears at the floor, and the Hydrated buff replaces it at ${h.goalOz} oz.`,
    autoApplied: true,
    meta: { kind: 'dehydration', hydrationOz },
  });
  return drafts;
}

export function projectProtein(proteinGrams: number, cfg: ConsumptionEffectsConfig): EffectDraft[] {
  const goal = proteinGoalGrams(cfg);
  const p = cfg.protein;
  const removePartial: EffectDraft = { effectKey: 'protein-building', name: 'Protein Building', type: 'buff', category: 'food', source: '', icon: '🥩', effects: [], duration: p.durationMinutes, dose: '', notes: '', autoApplied: true, meta: {}, remove: true };
  const removeGoal: EffectDraft = { effectKey: 'protein-goal', name: 'High Protein Synthesis', type: 'buff', category: 'food', source: '', icon: '🥩', effects: [], duration: p.durationMinutes, dose: '', notes: '', autoApplied: true, meta: {}, remove: true };
  if (goal <= 0 || proteinGrams < goal * p.partialRatio) {
    return [{ ...removePartial }, { ...removeGoal }];
  }
  const atGoal = proteinGrams >= goal;
  const dose = `${formatAmount(proteinGrams, 0)} g / ${goal} g`;
  if (atGoal) {
    return [
      removePartial,
      {
        effectKey: 'protein-goal',
        name: 'High Protein Synthesis',
        type: 'buff',
        category: 'food',
        source: `Protein goal met (${p.gramsPerLb} g/lb)`,
        icon: '🥩',
        effects: [
          { stat: 'Muscle Synthesis', modifier: '+Optimal', direction: 'positive' },
          { stat: 'Recovery Rate', modifier: `+${p.recoveryAtGoal}%`, direction: 'positive' },
        ],
        duration: p.durationMinutes,
        dose,
        notes: p.bodyWeightLb
          ? `Goal is ${p.gramsPerLb} g/lb × ${p.bodyWeightLb} lb = ${goal} g.`
          : `Goal is ${goal} g because body weight is not set (journal "high" tier; ${p.gramsPerLb} g/lb at about ${Math.round(goal / p.gramsPerLb)} lb). Set CONSUMPTION_BODYWEIGHT_LB to compute it.`,
        autoApplied: true,
        meta: { kind: 'protein', proteinGrams, goal },
      },
    ];
  }
  return [
    removeGoal,
    {
      effectKey: 'protein-building',
      name: 'Protein Building',
      type: 'buff',
      category: 'food',
      source: `${formatAmount(proteinGrams, 0)} g toward ${goal} g`,
      icon: '🥩',
      effects: [
        { stat: 'Muscle Synthesis', modifier: '+Building', direction: 'positive' },
        { stat: 'Recovery Rate', modifier: `+${p.recoveryPartial}%`, direction: 'positive' },
      ],
      duration: p.durationMinutes,
      dose,
      notes: `Partial credit at ${Math.round(p.partialRatio * 100)}% of the protein goal. The full synthesis buff replaces this at ${goal} g.`,
      autoApplied: true,
      meta: { kind: 'protein', proteinGrams, goal },
    },
  ];
}

function projectScaledSupplement(
  effectKey: string,
  name: string,
  icon: string,
  statPrimary: string,
  statSecondary: string,
  doses: SupplementDose[],
  now: Date,
  spec: ConsumptionEffectsConfig['creatine'],
  doseUnit: string,
): EffectDraft | null {
  const nowMs = now.getTime();
  const active = doses.filter(d => d.amount > 0 && nowMs - new Date(d.at).getTime() < spec.durationMinutes * 60000);
  const amount = active.reduce((sum, d) => sum + d.amount, 0);
  if (amount <= 0) return null;
  const ratio = amount / spec.reference;
  const primary = roundPct(spec.primaryPct * ratio, spec.primaryCap);
  const secondary = roundPct(spec.secondaryPct * ratio, spec.secondaryCap);
  const effects = [
    pctStat(statPrimary, primary, 'positive'),
    pctStat(statSecondary, secondary, 'positive'),
  ].filter((row): row is EffectStat => !!row);
  if (effects.length === 0) return null;
  return {
    effectKey,
    name,
    type: 'buff',
    category: 'food',
    source: summarizeNames(active.map(d => d.itemName)),
    icon,
    effects,
    duration: spec.durationMinutes,
    dose: `${formatAmount(amount, 1)} ${doseUnit}`,
    notes: `Reference dose ${spec.reference} ${doseUnit}. Repeat doses inside the window add up to the cap; they do not stack separate effects.`,
    autoApplied: true,
    meta: { kind: effectKey, doses: active, amount: round2(amount) },
  };
}

export function projectMelatonin(
  doses: SupplementDose[],
  now: Date,
  cfg: ConsumptionEffectsConfig,
): EffectDraft | null {
  const nowMs = now.getTime();
  const window = cfg.melatonin.durationMinutes * 60000;
  const active = doses.filter(d => d.amount > 0 && nowMs - new Date(d.at).getTime() < window);
  if (active.length === 0) return null;
  const latest = active.reduce((a, b) => (new Date(a.at).getTime() >= new Date(b.at).getTime() ? a : b));
  const effects: EffectStat[] = [
    { stat: 'Sleep Quality', modifier: `+${cfg.melatonin.sleepQualityPct}%`, direction: 'positive' },
    { stat: 'Sleep Onset', modifier: '+Faster', direction: 'positive' },
  ];
  if (latest.amount > cfg.melatonin.grogginessAboveMg) {
    effects.push({
      stat: 'Focus',
      modifier: `-${cfg.melatonin.grogginessFocusPct}%`,
      direction: 'negative',
    });
  }
  return {
    effectKey: 'melatonin',
    name: 'Melatonin Wind-Down',
    type: latest.amount > cfg.melatonin.grogginessAboveMg ? 'mixed' : 'buff',
    category: 'substance',
    source: latest.itemName,
    icon: '🌙',
    effects,
    duration: cfg.melatonin.durationMinutes,
    dose: `${formatAmount(latest.amount, 2)} mg melatonin`,
    notes: 'The latest dose replaces earlier ones. Doses are not summed. Above the grogginess threshold a small next-morning focus penalty is included for the same window.',
    autoApplied: true,
    meta: { kind: 'melatonin', doses: [latest], amount: latest.amount },
  };
}

function pushDose<T extends { at: string }>(existing: T[], dose: T | null): T[] {
  return dose ? [...existing, dose] : existing;
}

export function planConsumptionEffects(signals: ConsumptionSignals, ctx: EffectContext): EffectDraft[] {
  const cfg = ctx.config ?? resolveConsumptionConfig();
  const hours = hoursUntilBedtime(ctx.now, ctx.bedtime, ctx.timeZone);
  const drafts: EffectDraft[] = [];

  const alcoholDrinks = signals.alcohol
    ? standardDrinks(signals.alcohol.volumeOz, signals.alcohol.abvPercent, cfg.alcohol.ozEthanolPerStandardDrink)
    : 0;
  const alcoholDoses = pushDose(ctx.alcoholDoses, alcoholDrinks > 0 ? {
    at: signals.consumedAt,
    standardDrinks: alcoholDrinks,
    volumeOz: signals.alcohol!.volumeOz,
    abvPercent: signals.alcohol!.abvPercent,
    itemName: signals.itemName,
    hoursUntilBed: hours,
  } : null);
  const alcohol = projectAlcohol(alcoholDoses, ctx.now, cfg);
  if (alcohol) drafts.push(alcohol);

  const caffeineDoses = pushDose(ctx.caffeineDoses, (signals.caffeineMg ?? 0) > 0 ? {
    at: signals.consumedAt,
    mg: signals.caffeineMg!,
    itemName: signals.itemName,
    hoursUntilBed: hours,
  } : null);
  const caffeine = projectCaffeine(caffeineDoses, ctx.now, cfg);
  if (caffeine) drafts.push(caffeine);

  const sugarDoses = pushDose(ctx.sugarDoses, (signals.addedSugarG ?? 0) > 0 ? {
    at: signals.consumedAt,
    grams: signals.addedSugarG!,
    itemName: signals.itemName,
  } : null);
  const sugar = projectSugar(sugarDoses, ctx.now, cfg);
  if (sugar) drafts.push(sugar);

  drafts.push(...projectHydration(ctx.hydrationOz, ctx.localHour, cfg));
  drafts.push(...projectProtein(ctx.proteinGrams, cfg));

  const supplementDoses = (key: string, existing: SupplementDose[]): SupplementDose[] => {
    const extra = (signals.supplements ?? []).filter(s => s.key === key && s.amount > 0);
    return [
      ...existing,
      ...extra.map(s => ({ at: signals.consumedAt, amount: s.amount, itemName: signals.itemName })),
    ];
  };

  const creatine = projectScaledSupplement(
    'creatine', 'Creatine Saturation', '⚗️', 'Strength', 'Recovery Rate',
    supplementDoses('creatine', ctx.creatineDoses), ctx.now, cfg.creatine, 'g',
  );
  if (creatine) drafts.push(creatine);

  const magnesium = projectScaledSupplement(
    'magnesium', 'Magnesium Calm', '💊', 'Sleep Quality', 'Recovery Rate',
    supplementDoses('magnesium', ctx.magnesiumDoses), ctx.now, cfg.magnesium, 'mg',
  );
  if (magnesium) drafts.push(magnesium);

  const melatonin = projectMelatonin(supplementDoses('melatonin', ctx.melatoninDoses), ctx.now, cfg);
  if (melatonin) drafts.push(melatonin);

  return drafts;
}

export const ACM_ALCOHOL_ITEM_INDEX = 0;
export const ACM_ALCOHOL_LABEL = 'Abstained from undisciplined alcohol indulgence';

export function alcoholAbstinencePrompt(loggedDrinks: number): {
  itemIndex: 0;
  label: string;
  prompt: true;
  broken: false;
  message: string;
} | null {
  if (loggedDrinks <= 0) return null;
  return {
    itemIndex: ACM_ALCOHOL_ITEM_INDEX,
    label: ACM_ALCOHOL_LABEL,
    prompt: true,
    broken: false,
    message: 'Alcohol was logged. ACM item 0 and the abstinence streak were not changed. Confirm a break yourself if this counts as undisciplined indulgence.',
  };
}
