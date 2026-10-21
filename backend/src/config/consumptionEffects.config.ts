/**
 * Knobs for consumption → status effects.
 *
 * Numbers are the defaults documented in docs/CONSUMPTION-EFFECTS.md.
 * Override operational values with env vars, or replace any nested field
 * with CONSUMPTION_EFFECTS_JSON (a JSON object deep-merged onto the defaults).
 * Callers can also pass a partial override into resolveConsumptionConfig().
 */

export interface AlcoholEffectConfig {
  /** Fl oz of pure ethanol in one US standard drink (NIAAA: 0.6 fl oz / 14 g). */
  ozEthanolPerStandardDrink: number;
  clearanceDrinksPerHour: number;
  proximityIntercept: number;
  proximitySlope: number;
  proximityMin: number;
  proximityMax: number;
  sleepPerSeverity: number;
  recoveryPerSeverity: number;
  xpPerSeverity: number;
  testosteronePerSeverity: number;
  sleepCap: number;
  recoveryCap: number;
  xpCap: number;
  testosteroneCap: number;
  tailIntercept: number;
  tailSlope: number;
  tailMin: number;
  tailMax: number;
  pleasureMildBelow: number;
  pleasureModerateBelow: number;
}

export interface CaffeineEffectConfig {
  referenceMg: number;
  halfLifeHours: number;
  durationBaseMinutes: number;
  durationMin: number;
  durationMax: number;
  focusPerReference: number;
  focusCap: number;
  clarityPerReference: number;
  clarityCap: number;
  fatigueTierMg: number;
  /** Sleep penalty applies when the dose is inside this many hours of bedtime. */
  sleepPenaltyWithinHours: number;
  sleepPerReference: number;
  sleepCap: number;
  /** Doses older than this are dropped from the stack. */
  memoryHours: number;
}

export interface HydrationEffectConfig {
  goalOz: number;
  dehydrationFloorOz: number;
  /** Local hour (0–23). Dehydration is not applied earlier than this. */
  checkHourLocal: number;
  focusAtEmpty: number;
  focusAtFloor: number;
  outputAtEmpty: number;
  outputAtFloor: number;
  vitalityPtsAtEmpty: number;
  vitalityPtsAtFloor: number;
  hydratedFocus: number;
  hydratedOutput: number;
  hydratedDurationMinutes: number;
}

export interface SugarEffectConfig {
  minGrams: number;
  focusPer10g: number;
  focusCap: number;
  durationBase: number;
  durationPer10g: number;
  durationCap: number;
  spikeGrams: number;
  insulinGrams: number;
  memoryHours: number;
}

export interface ProteinEffectConfig {
  gramsPerLb: number;
  /** When set, goal grams = gramsPerLb × bodyWeightLb. Otherwise goalGrams is used. */
  bodyWeightLb: number | null;
  goalGrams: number;
  partialRatio: number;
  recoveryAtGoal: number;
  recoveryPartial: number;
  durationMinutes: number;
}

export interface SupplementDoseConfig {
  reference: number;
  primaryPct: number;
  secondaryPct: number;
  primaryCap: number;
  secondaryCap: number;
  durationMinutes: number;
}

export interface MelatoninConfig {
  sleepQualityPct: number;
  grogginessAboveMg: number;
  grogginessFocusPct: number;
  durationMinutes: number;
}

export interface ConsumptionEffectsConfig {
  timeZone: string;
  /** Fallback lights-out when no weekday override, journal sleep_start, or request bedtime applies. */
  defaultBedtime: string;
  /**
   * Optional lights-out by weekday. Keys are weekday names (`tuesday`),
   * unique prefixes of at least 3 letters (`tue`), or `0`–`6` (Sunday = 0).
   * Days omitted here use `defaultBedtime`.
   */
  bedtimeByWeekday: Record<string, string>;
  alcohol: AlcoholEffectConfig;
  caffeine: CaffeineEffectConfig;
  hydration: HydrationEffectConfig;
  sugar: SugarEffectConfig;
  protein: ProteinEffectConfig;
  creatine: SupplementDoseConfig;
  magnesium: SupplementDoseConfig;
  melatonin: MelatoninConfig;
}

export const DEFAULT_CONSUMPTION_EFFECTS_CONFIG: ConsumptionEffectsConfig = {
  timeZone: 'America/Chicago',
  defaultBedtime: '21:30',
  /** Parkour night. Other weekdays use defaultBedtime. */
  bedtimeByWeekday: {
    tuesday: '22:15',
  },
  alcohol: {
    ozEthanolPerStandardDrink: 0.6,
    clearanceDrinksPerHour: 1,
    proximityIntercept: 1.35,
    proximitySlope: 0.22,
    proximityMin: 0.30,
    proximityMax: 1.25,
    sleepPerSeverity: 10,
    recoveryPerSeverity: 8,
    xpPerSeverity: 5,
    testosteronePerSeverity: 4,
    sleepCap: 35,
    recoveryCap: 25,
    xpCap: 15,
    testosteroneCap: 12,
    tailIntercept: 240,
    tailSlope: 40,
    tailMin: 45,
    tailMax: 240,
    pleasureMildBelow: 1,
    pleasureModerateBelow: 2.5,
  },
  caffeine: {
    referenceMg: 95,
    halfLifeHours: 5,
    durationBaseMinutes: 300,
    durationMin: 60,
    durationMax: 480,
    focusPerReference: 12,
    focusCap: 25,
    clarityPerReference: 8,
    clarityCap: 18,
    fatigueTierMg: 80,
    sleepPenaltyWithinHours: 6,
    sleepPerReference: 6,
    sleepCap: 15,
    memoryHours: 12,
  },
  hydration: {
    goalOz: 100,
    dehydrationFloorOz: 40,
    checkHourLocal: 14,
    focusAtEmpty: 25,
    focusAtFloor: 10,
    outputAtEmpty: 15,
    outputAtFloor: 5,
    vitalityPtsAtEmpty: 5,
    vitalityPtsAtFloor: 2,
    hydratedFocus: 5,
    hydratedOutput: 5,
    hydratedDurationMinutes: 360,
  },
  sugar: {
    minGrams: 5,
    focusPer10g: 4,
    focusCap: 15,
    durationBase: 45,
    durationPer10g: 10,
    durationCap: 180,
    spikeGrams: 15,
    insulinGrams: 10,
    memoryHours: 6,
  },
  protein: {
    gramsPerLb: 0.64,
    bodyWeightLb: null,
    goalGrams: 130,
    partialRatio: 0.8,
    recoveryAtGoal: 8,
    recoveryPartial: 4,
    durationMinutes: 1440,
  },
  creatine: {
    reference: 5,
    primaryPct: 5,
    secondaryPct: 4,
    primaryCap: 8,
    secondaryCap: 6,
    durationMinutes: 1440,
  },
  magnesium: {
    reference: 200,
    primaryPct: 4,
    secondaryPct: 3,
    primaryCap: 8,
    secondaryCap: 6,
    durationMinutes: 480,
  },
  melatonin: {
    sleepQualityPct: 3,
    grogginessAboveMg: 3,
    grogginessFocusPct: 5,
    durationMinutes: 420,
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepMerge(current, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

function numOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/** Canonical weekday, or null when the key is ambiguous or unknown. */
export function canonicalWeekday(key: string): string | null {
  const k = key.trim().toLowerCase();
  if (/^[0-6]$/.test(k)) return WEEKDAY_NAMES[Number(k)];
  if (k.length < 3) return null;
  const hits = WEEKDAY_NAMES.filter(name => name.startsWith(k));
  return hits.length === 1 ? hits[0] : null;
}

function normalizeHHMM(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Drop unknown weekdays and invalid times. Later duplicate keys win. */
export function normalizeBedtimeByWeekday(raw: unknown): Record<string, string> | null {
  if (!isPlainObject(raw)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const day = canonicalWeekday(key);
    const hhmm = normalizeHHMM(value);
    if (day && hhmm) out[day] = hhmm;
  }
  return out;
}

function applyEnv(cfg: ConsumptionEffectsConfig): void {
  if (process.env.APP_TIMEZONE) cfg.timeZone = process.env.APP_TIMEZONE;
  const bedtime = normalizeHHMM(process.env.CONSUMPTION_BEDTIME);
  if (bedtime) cfg.defaultBedtime = bedtime;
  const weekdayRaw = process.env.CONSUMPTION_BEDTIME_BY_WEEKDAY;
  if (weekdayRaw) {
    try {
      const parsed = normalizeBedtimeByWeekday(JSON.parse(weekdayRaw));
      if (parsed) cfg.bedtimeByWeekday = parsed;
    } catch (err) {
      console.warn('[CONSUMPTION] CONSUMPTION_BEDTIME_BY_WEEKDAY ignored:', err instanceof Error ? err.message : err);
    }
  }
  const weight = numOrNull(process.env.CONSUMPTION_BODYWEIGHT_LB);
  if (weight !== null) cfg.protein.bodyWeightLb = weight;
  const goalOz = numOrNull(process.env.CONSUMPTION_HYDRATION_GOAL_OZ);
  if (goalOz !== null) cfg.hydration.goalOz = goalOz;
  const proteinGoal = numOrNull(process.env.CONSUMPTION_PROTEIN_GOAL_GRAMS);
  if (proteinGoal !== null) cfg.protein.goalGrams = proteinGoal;
  const rawJson = process.env.CONSUMPTION_EFFECTS_JSON;
  if (rawJson) {
    try {
      Object.assign(cfg, deepMerge(cfg, JSON.parse(rawJson)));
    } catch (err) {
      console.warn('[CONSUMPTION] CONSUMPTION_EFFECTS_JSON ignored:', err instanceof Error ? err.message : err);
    }
  }
}

export function resolveConsumptionConfig(
  overrides?: unknown,
): ConsumptionEffectsConfig {
  const cfg = structuredClone(DEFAULT_CONSUMPTION_EFFECTS_CONFIG);
  applyEnv(cfg);
  if (overrides) Object.assign(cfg, deepMerge(cfg, overrides));
  const bedtime = normalizeHHMM(cfg.defaultBedtime);
  if (bedtime) cfg.defaultBedtime = bedtime;
  cfg.bedtimeByWeekday = normalizeBedtimeByWeekday(cfg.bedtimeByWeekday) ?? {};
  return cfg;
}

export function proteinGoalGrams(cfg: ConsumptionEffectsConfig): number {
  if (cfg.protein.bodyWeightLb && cfg.protein.bodyWeightLb > 0) {
    return Math.round(cfg.protein.gramsPerLb * cfg.protein.bodyWeightLb);
  }
  return cfg.protein.goalGrams;
}
