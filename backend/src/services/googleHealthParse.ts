import {
  ActivitySummary,
  FitbitActivity,
  FoodEntry,
  FoodLog,
  HeartZone,
  VitalsData,
} from './fitbit.service';
import { WearableSleepData } from './wearable.types';

/** Read-only scopes that cover every Fitbit payload this app still uses. */
export const GOOGLE_HEALTH_READONLY_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
] as const;

/** Passive tracker stream (Fitbit / Pixel Watch). Excludes manual logs. */
export const GOOGLE_WEARABLES_FAMILY = 'users/me/dataSourceFamilies/google-wearables';

/** First-party Google data, including manual logs and scale entries. */
export const GOOGLE_SOURCES_FAMILY = 'users/me/dataSourceFamilies/google-sources';

const GRAMS_PER_LB = 453.59237;
const ML_PER_FL_OZ = 29.5735;

interface CivilDate {
  year?: number;
  month?: number;
  day?: number;
}

interface CivilTime {
  hours?: number;
  minutes?: number;
}

interface CivilDateTime {
  date?: CivilDate;
  time?: CivilTime;
}

interface SleepStage {
  startTime?: string;
  endTime?: string;
  type?: string;
}

interface SleepSession {
  interval?: {
    startTime?: string;
    endTime?: string;
    civilStartTime?: CivilDateTime;
    civilEndTime?: CivilDateTime;
  };
  startTime?: string;
  endTime?: string;
  type?: string;
  stages?: SleepStage[];
  sleepStages?: SleepStage[];
  metadata?: { mainSleep?: boolean };
  summary?: { minutesAsleep?: string | number; minutesAwake?: string | number };
}

interface DataPoint {
  name?: string;
  sleep?: SleepSession;
  exercise?: ExerciseSession;
  nutritionLog?: NutritionLogPoint;
  dailyRestingHeartRate?: { date?: CivilDate; beatsPerMinute?: string | number };
  dailyHeartRateZones?: { date?: CivilDate; heartRateZones?: ZoneThreshold[] };
  dailyOxygenSaturation?: DailySpo2;
  dailyVo2Max?: { date?: CivilDate; vo2Max?: number };
  dailyRespiratoryRate?: { date?: CivilDate; breathsPerMinute?: number };
  height?: { sampleTime?: { physicalTime?: string }; heightMillimeters?: string | number };
  weight?: { sampleTime?: { physicalTime?: string }; weightGrams?: number };
}

interface ExerciseSession {
  interval?: {
    startTime?: string;
    endTime?: string;
    civilStartTime?: CivilDateTime;
  };
  exerciseType?: string;
  displayName?: string;
  activeDuration?: string;
  metricsSummary?: {
    caloriesKcal?: number;
    distanceMillimeters?: number;
    steps?: string | number;
  };
}

interface NutritionLogPoint {
  nutrients?: Array<{ nutrient?: string; quantity?: { grams?: number } }>;
  energy?: { kcal?: number };
  totalCarbohydrate?: { grams?: number };
  totalFat?: { grams?: number };
  mealType?: string;
  serving?: { amount?: number; foodMeasurementUnitDisplayName?: string };
  foodDisplayName?: string;
}

interface ZoneThreshold {
  heartRateZoneType?: string;
  minBeatsPerMinute?: string | number;
  maxBeatsPerMinute?: string | number;
}

interface DailySpo2 {
  date?: CivilDate;
  averagePercentage?: number;
  lowerBoundPercentage?: number;
  upperBoundPercentage?: number;
}

export interface GoogleActivityParts {
  stepsRollup?: { steps?: { countSum?: string | number } } | null;
  activeMinutesRollup?: { activeMinutes?: { activeMinutesRollupByActivityLevel?: Array<{ activityLevel?: string; activeMinutesSum?: string | number }> } } | null;
  sedentaryRollup?: { sedentaryPeriod?: { durationSum?: string } } | null;
  caloriesRollup?: { totalCalories?: { kcalSum?: number } } | null;
  azmRollup?: { activeZoneMinutes?: { sumInFatBurnHeartZone?: string | number; sumInCardioHeartZone?: string | number; sumInPeakHeartZone?: string | number } } | null;
  timeInZoneRollup?: { timeInHeartRateZone?: { timeInHeartRateZones?: Array<{ heartRateZone?: string; duration?: string }> } } | null;
  caloriesInZoneRollup?: { caloriesInHeartRateZone?: { caloriesInHeartRateZones?: Array<{ heartRateZone?: string; kcal?: number }> } } | null;
  restingPoints?: DataPoint[];
  zoneThresholdPoints?: DataPoint[];
  exercisePoints?: DataPoint[];
  date?: string;
}

export interface GoogleFoodParts {
  points?: DataPoint[];
  rollup?: {
    nutritionLog?: {
      nutrients?: Array<{ nutrient?: string; quantity?: { gramsSum?: number } }>;
      energy?: { kcalSum?: number };
      totalCarbohydrate?: { gramsSum?: number };
      totalFat?: { gramsSum?: number };
    };
  } | null;
}

export interface GoogleVitalsParts {
  date?: string;
  weightRollup?: { weight?: { weightGramsAvg?: number } } | null;
  weekWeightRollups?: Array<{ weight?: { weightGramsAvg?: number } }>;
  bodyFatRollup?: { bodyFat?: { bodyFatPercentageAvg?: number } } | null;
  hydrationRollup?: { hydrationLog?: { amountConsumed?: { millilitersSum?: number } } } | null;
  spo2Points?: DataPoint[];
  vo2Points?: DataPoint[];
  respiratoryPoints?: DataPoint[];
  heightPoints?: DataPoint[];
}

const MEAL_LABELS: Record<string, string> = {
  BEFORE_BREAKFAST: 'Before Breakfast',
  BREAKFAST: 'Breakfast',
  BEFORE_LUNCH: 'Morning Snack',
  LUNCH: 'Lunch',
  BEFORE_DINNER: 'Afternoon Snack',
  DINNER: 'Dinner',
  AFTER_DINNER: 'Evening Snack',
  SNACK: 'Anytime',
  ANYTIME: 'Anytime',
};

/** Google zone → the three Fitbit zone names the dashboard already renders. */
const ZONE_LABELS: Record<string, HeartZone['name']> = {
  MODERATE: 'Fat Burn',
  VIGOROUS: 'Cardio',
  PEAK: 'Peak',
};

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function durationToMinutes(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw / 60;
  if (typeof raw !== 'string') return 0;
  const match = raw.trim().match(/^(-?\d+(?:\.\d+)?)s$/);
  if (!match) return 0;
  return parseFloat(match[1]) / 60;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function gramsToLbs(grams: number): number {
  return round1(grams / GRAMS_PER_LB);
}

export function civilDateString(date?: CivilDate): string | null {
  if (!date?.year || !date.month || !date.day) return null;
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function civilClock(civil?: CivilDateTime): string | undefined {
  const time = civil?.time;
  if (!time || (time.hours == null && time.minutes == null)) return undefined;
  const hours = time.hours ?? 0;
  const minutes = time.minutes ?? 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function clockFromIso(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function minutesBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return (b - a) / 60000;
}

function pointMatchesDate(date: CivilDate | undefined, dateStr: string | undefined): boolean {
  if (!dateStr) return true;
  const formatted = civilDateString(date);
  return !formatted || formatted === dateStr;
}

function stableLogId(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 1_000_000_000;
}

function exerciseLabel(type?: string, displayName?: string): string {
  if (displayName && displayName.trim()) return displayName.trim();
  if (!type || type.endsWith('_UNSPECIFIED')) return 'Activity';
  return type
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function nutrientGrams(nutrients: NutritionLogPoint['nutrients'], name: string): number {
  const hit = (nutrients ?? []).find(n => n.nutrient === name);
  return hit?.quantity?.grams ?? 0;
}

/**
 * Same score the legacy Fitbit parser writes into journal.fitbit_score.
 * Consolidation and the ACM sleep bonus read that column, so the formula stays put.
 */
function scoreFromMinutes(totalMin: number, totalBed: number): Pick<WearableSleepData, 'score' | 'hours' | 'vitality' | 'efficiency'> {
  const bed = totalBed > 0 ? totalBed : (totalMin || 1);
  const efficiency = Math.min(Math.round((totalMin / bed) * 100), 100);
  const hours = round1(totalMin / 60);
  const vitality = Math.min(Math.round(((totalMin / 480) * (efficiency / 100)) * 100) / 10, 10);
  const score = Math.min(Math.round((totalMin / 480) * 60 + (efficiency / 100) * 40), 100);
  return { score, hours, vitality, efficiency };
}

export function parseGoogleSleep(
  data: { dataPoints?: DataPoint[] } | null | undefined,
  dateStr: string,
): WearableSleepData {
  const empty: WearableSleepData = {
    score: 0, hours: 0, vitality: 0, efficiency: 0,
    deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0,
  };
  const points = Array.isArray(data?.dataPoints) ? data!.dataPoints! : [];
  const sessions = points.map(p => p.sleep).filter((s): s is SleepSession => !!s);
  const main = pickMainSleep(sessions, dateStr);
  if (!main) return empty;

  const startIso = main.interval?.startTime || main.startTime;
  const endIso = main.interval?.endTime || main.endTime;
  const bedMin = minutesBetween(startIso, endIso);

  const stages = main.stages || main.sleepStages || [];
  let deep = 0, rem = 0, light = 0, awake = 0;
  for (const stage of stages) {
    const mins = minutesBetween(stage.startTime, stage.endTime);
    switch ((stage.type || '').toUpperCase()) {
      case 'DEEP': deep += mins; break;
      case 'REM': rem += mins; break;
      case 'LIGHT':
      case 'ASLEEP': light += mins; break;
      case 'AWAKE':
      case 'WAKE': awake += mins; break;
      default: break;
    }
  }

  const asleepMin = deep + rem + light;
  const summaryAsleep = asNumber(main.summary?.minutesAsleep);
  const totalMin = asleepMin > 0
    ? asleepMin
    : (summaryAsleep > 0 ? summaryAsleep : Math.max(0, bedMin - awake));
  const scored = scoreFromMinutes(totalMin, bedMin);

  return {
    ...scored,
    deep_min: Math.round(deep),
    rem_min: Math.round(rem),
    light_min: Math.round(light),
    awake_min: Math.round(awake),
    startTime: civilClock(main.interval?.civilStartTime) || clockFromIso(startIso),
    endTime: civilClock(main.interval?.civilEndTime) || clockFromIso(endIso),
  };
}

function pickMainSleep(sessions: SleepSession[], dateStr: string): SleepSession | null {
  if (sessions.length === 0) return null;
  const matching = sessions.filter(session => {
    const end = session.interval?.endTime || session.endTime;
    const civil = civilDateString(session.interval?.civilEndTime?.date);
    if (civil) return civil === dateStr;
    return end ? end.slice(0, 10) === dateStr : true;
  });
  const pool = matching.length > 0 ? matching : sessions;
  const flagged = pool.find(session => session.metadata?.mainSleep);
  if (flagged) return flagged;
  return pool.reduce((best, cur) => (
    minutesBetween(cur.interval?.startTime || cur.startTime, cur.interval?.endTime || cur.endTime)
      > minutesBetween(best.interval?.startTime || best.startTime, best.interval?.endTime || best.endTime)
      ? cur : best
  ));
}

export function assembleActivitySummary(parts: GoogleActivityParts): ActivitySummary {
  const steps = Math.round(asNumber(parts.stepsRollup?.steps?.countSum));
  let light = 0, moderate = 0, vigorous = 0;
  for (const row of parts.activeMinutesRollup?.activeMinutes?.activeMinutesRollupByActivityLevel ?? []) {
    const minutes = asNumber(row.activeMinutesSum);
    switch (row.activityLevel) {
      case 'LIGHT': light += minutes; break;
      case 'MODERATE': moderate += minutes; break;
      case 'VIGOROUS': vigorous += minutes; break;
      default: break;
    }
  }

  const sedentaryMin = Math.round(durationToMinutes(parts.sedentaryRollup?.sedentaryPeriod?.durationSum));
  const azm = parts.azmRollup?.activeZoneMinutes;
  const activeZoneMinutes = asNumber(azm?.sumInFatBurnHeartZone)
    + asNumber(azm?.sumInCardioHeartZone)
    + asNumber(azm?.sumInPeakHeartZone);

  const zoneMinutes = new Map<string, number>();
  for (const row of parts.timeInZoneRollup?.timeInHeartRateZone?.timeInHeartRateZones ?? []) {
    if (!row.heartRateZone || !ZONE_LABELS[row.heartRateZone]) continue;
    zoneMinutes.set(row.heartRateZone, (zoneMinutes.get(row.heartRateZone) ?? 0) + durationToMinutes(row.duration));
  }
  const zoneCalories = new Map<string, number>();
  for (const row of parts.caloriesInZoneRollup?.caloriesInHeartRateZone?.caloriesInHeartRateZones ?? []) {
    if (!row.heartRateZone || !ZONE_LABELS[row.heartRateZone]) continue;
    zoneCalories.set(row.heartRateZone, (zoneCalories.get(row.heartRateZone) ?? 0) + (row.kcal ?? 0));
  }
  const thresholds = new Map<string, { min: number; max: number }>();
  for (const point of parts.zoneThresholdPoints ?? []) {
    if (!pointMatchesDate(point.dailyHeartRateZones?.date, parts.date)) continue;
    for (const zone of point.dailyHeartRateZones?.heartRateZones ?? []) {
      if (!zone.heartRateZoneType) continue;
      thresholds.set(zone.heartRateZoneType, {
        min: asNumber(zone.minBeatsPerMinute),
        max: asNumber(zone.maxBeatsPerMinute),
      });
    }
  }

  const heartZones: HeartZone[] = (['MODERATE', 'VIGOROUS', 'PEAK'] as const)
    .map(key => {
      const minutes = Math.round(zoneMinutes.get(key) ?? 0);
      if (minutes <= 0) return null;
      const bounds = thresholds.get(key);
      return {
        name: ZONE_LABELS[key],
        minutes,
        calOut: Math.round(zoneCalories.get(key) ?? 0),
        min: bounds?.min ?? 0,
        max: bounds?.max ?? 0,
      };
    })
    .filter((zone): zone is HeartZone => zone != null);

  const resting = (parts.restingPoints ?? []).find(point =>
    pointMatchesDate(point.dailyRestingHeartRate?.date, parts.date)
    && asNumber(point.dailyRestingHeartRate?.beatsPerMinute) > 0,
  );
  const restingHR = asNumber(resting?.dailyRestingHeartRate?.beatsPerMinute);

  return {
    steps,
    activeMinutes: Math.round(moderate + vigorous),
    lightlyActiveMinutes: light > 0 ? Math.round(light) : undefined,
    sedentaryMinutes: sedentaryMin > 0 ? sedentaryMin : undefined,
    caloriesOut: Math.round(parts.caloriesRollup?.totalCalories?.kcalSum ?? 0),
    activeZoneMinutes: activeZoneMinutes > 0 ? Math.round(activeZoneMinutes) : undefined,
    activities: parseExercises(parts.exercisePoints ?? []),
    restingHR: restingHR > 0 ? Math.round(restingHR) : undefined,
    heartZones: heartZones.length > 0 ? heartZones : undefined,
  };
}

function parseExercises(points: DataPoint[]): FitbitActivity[] {
  const activities: FitbitActivity[] = [];
  for (const point of points) {
    const exercise = point.exercise;
    if (!exercise) continue;
    const activeMin = durationToMinutes(exercise.activeDuration);
    const intervalMin = minutesBetween(exercise.interval?.startTime, exercise.interval?.endTime);
    const durationMin = Math.round(activeMin > 0 ? activeMin : intervalMin);
    const steps = asNumber(exercise.metricsSummary?.steps);
    const distanceMm = exercise.metricsSummary?.distanceMillimeters ?? 0;
    const calories = Math.round(exercise.metricsSummary?.caloriesKcal ?? 0);
    if (durationMin <= 0 && calories <= 0 && steps <= 0) continue;
    activities.push({
      name: exerciseLabel(exercise.exerciseType, exercise.displayName),
      durationMin,
      calories,
      steps: steps > 0 ? Math.round(steps) : undefined,
      distanceKm: distanceMm > 0 ? round1(distanceMm / 1_000_000) : undefined,
      startTime: civilClock(exercise.interval?.civilStartTime)
        || clockFromIso(exercise.interval?.startTime)
        || '',
    });
  }
  return activities;
}

export function assembleFoodLog(parts: GoogleFoodParts): FoodLog {
  const entries: FoodEntry[] = [];
  for (const point of parts.points ?? []) {
    const log = point.nutritionLog;
    if (!log) continue;
    const calories = Math.round(log.energy?.kcal ?? 0);
    const protein = round1(nutrientGrams(log.nutrients, 'PROTEIN'));
    const fiber = round1(nutrientGrams(log.nutrients, 'DIETARY_FIBER'));
    const carbs = round1(log.totalCarbohydrate?.grams ?? 0);
    const fat = round1(log.totalFat?.grams ?? 0);
    entries.push({
      name: log.foodDisplayName || 'Unknown',
      brand: undefined,
      calories,
      protein,
      carbs,
      fat,
      fiber,
      amount: log.serving?.amount ?? 1,
      unit: log.serving?.foodMeasurementUnitDisplayName || 'serving',
      mealType: MEAL_LABELS[log.mealType || ''] || 'Anytime',
      logId: stableLogId(point.name || `${log.foodDisplayName || 'food'}:${entries.length}`),
    });
  }

  const roll = parts.rollup?.nutritionLog;
  const proteinFromRoll = roll?.nutrients?.find(n => n.nutrient === 'PROTEIN')?.quantity?.gramsSum;
  const fiberFromRoll = roll?.nutrients?.find(n => n.nutrient === 'DIETARY_FIBER')?.quantity?.gramsSum;
  const summed = entries.reduce((acc, entry) => ({
    calories: acc.calories + entry.calories,
    protein: acc.protein + entry.protein,
    carbs: acc.carbs + entry.carbs,
    fat: acc.fat + entry.fat,
    fiber: acc.fiber + entry.fiber,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

  return {
    entries,
    totals: {
      calories: Math.round(roll?.energy?.kcalSum ?? summed.calories),
      protein: round1(proteinFromRoll ?? summed.protein),
      carbs: round1(roll?.totalCarbohydrate?.gramsSum ?? summed.carbs),
      fat: round1(roll?.totalFat?.gramsSum ?? summed.fat),
      fiber: round1(fiberFromRoll ?? summed.fiber),
      water: 0,
    },
    // Google Health nutrition-log has no Fitbit-style daily calorie goal.
    goalCalories: 0,
  };
}

export function assembleVitals(parts: GoogleVitalsParts): VitalsData {
  const result: VitalsData = {};
  const todayGrams = parts.weightRollup?.weight?.weightGramsAvg ?? 0;
  if (todayGrams > 0) result.weight = gramsToLbs(todayGrams);

  const weekLbs = (parts.weekWeightRollups ?? [])
    .map(point => point.weight?.weightGramsAvg ?? 0)
    .filter(grams => grams > 0)
    .map(gramsToLbs);
  if (weekLbs.length > 0) {
    const sum = weekLbs.reduce((a, b) => a + b, 0);
    result.weeklyAvgWeight = round1(sum / weekLbs.length);
    result.weeklyWeightDays = Math.min(weekLbs.length, 7);
  }

  const bodyFat = parts.bodyFatRollup?.bodyFat?.bodyFatPercentageAvg;
  if (bodyFat != null && bodyFat > 0) result.bodyFat = round1(bodyFat);

  const spo2 = (parts.spo2Points ?? []).find(point =>
    pointMatchesDate(point.dailyOxygenSaturation?.date, parts.date),
  )?.dailyOxygenSaturation;
  if (spo2?.averagePercentage != null) {
    result.spo2Avg = round1(spo2.averagePercentage);
    if (spo2.lowerBoundPercentage != null) result.spo2Min = round1(spo2.lowerBoundPercentage);
    if (spo2.upperBoundPercentage != null) result.spo2Max = round1(spo2.upperBoundPercentage);
  }

  const vo2 = (parts.vo2Points ?? []).find(point =>
    pointMatchesDate(point.dailyVo2Max?.date, parts.date) && (point.dailyVo2Max?.vo2Max ?? 0) > 0,
  )?.dailyVo2Max?.vo2Max;
  if (vo2 != null && vo2 > 0) {
    const rounded = round1(vo2);
    result.vo2Max = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  const breaths = (parts.respiratoryPoints ?? []).find(point =>
    pointMatchesDate(point.dailyRespiratoryRate?.date, parts.date)
    && (point.dailyRespiratoryRate?.breathsPerMinute ?? 0) > 0,
  )?.dailyRespiratoryRate?.breathsPerMinute;
  if (breaths != null && breaths > 0) result.respiratoryRate = round1(breaths);

  const waterMl = parts.hydrationRollup?.hydrationLog?.amountConsumed?.millilitersSum ?? 0;
  if (waterMl > 0) result.waterOz = Math.round(waterMl / ML_PER_FL_OZ);

  const heightMm = latestHeightMillimeters(parts.heightPoints ?? []);
  if (todayGrams > 0 && heightMm > 0) {
    const weightKg = todayGrams / 1000;
    const heightM = heightMm / 1000;
    result.bmi = round1(weightKg / (heightM * heightM));
  }

  return result;
}

function latestHeightMillimeters(points: DataPoint[]): number {
  let best = 0;
  let bestAt = -1;
  for (const point of points) {
    const mm = asNumber(point.height?.heightMillimeters);
    if (mm <= 0) continue;
    const at = Date.parse(point.height?.sampleTime?.physicalTime || '') || 0;
    if (at >= bestAt) {
      bestAt = at;
      best = mm;
    }
  }
  return best;
}
