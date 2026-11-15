/**
 * Smart-scale body composition. Values are stored as reported.
 * Bounds below are unit limits (a percent, a positive pound-mass), not vendor
 * healthy ranges — those bands are inconsistent and are not computed here.
 * Logging a reading does not award XP.
 */

export class BodyCompositionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface BodyCompositionReading {
  id: string;
  source: string;
  measuredAt: string;
  fasted: boolean | null;
  context: string | null;
  notes: string | null;
  idempotencyKey: string;
  healthScore: number | null;
  healthScoreLabel: string | null;
  healthScoreConfidencePct: number | null;
  biologicalAgeYears: number | null;
  metabolicAgeYears: number | null;
  bodyFatPct: number | null;
  bodyWaterPct: number | null;
  skeletalMuscleMassLb: number | null;
  weightLb: number | null;
  bodyCompositionGrade: string | null;
  activityGrade: string | null;
  sleepGrade: string | null;
  bodyFatLabel: string | null;
  bodyWaterLabel: string | null;
  skeletalMuscleMassLabel: string | null;
  weightLabel: string | null;
  biologicalAgeLabel: string | null;
  metabolicAgeLabel: string | null;
  createdAt: string;
}

export interface StoredBodyComposition extends BodyCompositionReading {
  userId: string;
}

export type BodyCompositionDraft = Omit<BodyCompositionReading, 'id' | 'createdAt'>;

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

interface NumberBound {
  min: number;
  max: number;
  /** When true, `min` is exclusive (pound-mass must be greater than 0). */
  exclusiveMin?: boolean;
  integer?: boolean;
}

function fail(message: string): never {
  throw new BodyCompositionError('invalid_body_composition', message, 400);
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('JSON object body is required');
  }
  return body as Record<string, unknown>;
}

function readRequiredKey(body: Record<string, unknown>): string {
  const raw = body.idempotencyKey;
  if (typeof raw !== 'string') fail('idempotencyKey is required (1–200 characters)');
  const key = raw.trim();
  if (!key || key.length > 200 || /[\r\n]/.test(key)) {
    fail('idempotencyKey is required (1–200 characters)');
  }
  return key;
}

function readSource(body: Record<string, unknown>): string {
  if (typeof body.source !== 'string') fail('source is required (1–40 characters)');
  const source = body.source.trim();
  if (!source || source.length > 40 || /[\r\n]/.test(source)) {
    fail('source is required (1–40 characters)');
  }
  return source;
}

function readMeasuredAt(body: Record<string, unknown>): string {
  if (typeof body.measuredAt !== 'string' || !body.measuredAt.trim()) {
    fail('measuredAt is required (ISO-8601 timestamp)');
  }
  const ms = Date.parse(body.measuredAt);
  if (!Number.isFinite(ms)) fail('measuredAt is required (ISO-8601 timestamp)');
  return new Date(ms).toISOString();
}

function readFasted(body: Record<string, unknown>): boolean | null {
  if (!Object.prototype.hasOwnProperty.call(body, 'fasted') || body.fasted == null) return null;
  if (typeof body.fasted !== 'boolean') fail('fasted must be a boolean or null');
  return body.fasted;
}

function readOptionalText(
  body: Record<string, unknown>,
  key: string,
  max: number,
  allowNewlines: boolean,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] == null) return null;
  if (typeof body[key] !== 'string') fail(`${key} must be a string or null`);
  const text = (body[key] as string).trim();
  if (!text) return null;
  if (text.length > max) fail(`${key} must be at most ${max} characters`);
  if (!allowNewlines && /[\r\n]/.test(text)) fail(`${key} must be a single line`);
  return text;
}

function readOptionalNumber(
  body: Record<string, unknown>,
  key: string,
  bound: NumberBound,
  unit: string,
): number | null {
  if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] == null) return null;
  const n = body[key];
  const span = bound.exclusiveMin
    ? `greater than ${bound.min} and at most ${bound.max}`
    : `from ${bound.min} to ${bound.max}`;
  const kind = bound.integer ? `an integer ${unit}` : `a ${unit}`;
  if (typeof n !== 'number' || !Number.isFinite(n) || (bound.integer && !Number.isInteger(n))) {
    fail(`${key} must be ${kind} ${span}, or null`);
  }
  if ((bound.exclusiveMin ? n <= bound.min : n < bound.min) || n > bound.max) {
    fail(`${key} must be ${kind} ${span}, or null`);
  }
  return n;
}

/** Accept a write body. Measurement fields are optional. `xp` is ignored. */
export function parseBodyCompositionBody(body: unknown): BodyCompositionDraft {
  const record = asRecord(body);
  return {
    idempotencyKey: readRequiredKey(record),
    source: readSource(record),
    measuredAt: readMeasuredAt(record),
    fasted: readFasted(record),
    context: readOptionalText(record, 'context', 200, false),
    notes: readOptionalText(record, 'notes', 2000, true),
    healthScore: readOptionalNumber(record, 'healthScore', { min: 0, max: 100000, integer: true }, 'health score'),
    healthScoreLabel: readOptionalText(record, 'healthScoreLabel', 80, false),
    healthScoreConfidencePct: readOptionalNumber(
      record,
      'healthScoreConfidencePct',
      { min: 0, max: 100 },
      'percent',
    ),
    biologicalAgeYears: readOptionalNumber(record, 'biologicalAgeYears', { min: 0, max: 200 }, 'age in years'),
    metabolicAgeYears: readOptionalNumber(record, 'metabolicAgeYears', { min: 0, max: 200 }, 'age in years'),
    bodyFatPct: readOptionalNumber(record, 'bodyFatPct', { min: 0, max: 100 }, 'percent'),
    bodyWaterPct: readOptionalNumber(record, 'bodyWaterPct', { min: 0, max: 100 }, 'percent'),
    skeletalMuscleMassLb: readOptionalNumber(
      record,
      'skeletalMuscleMassLb',
      { min: 0, max: 2000, exclusiveMin: true },
      'mass in pounds',
    ),
    weightLb: readOptionalNumber(
      record,
      'weightLb',
      { min: 0, max: 2000, exclusiveMin: true },
      'weight in pounds',
    ),
    bodyCompositionGrade: readOptionalText(record, 'bodyCompositionGrade', 16, false),
    activityGrade: readOptionalText(record, 'activityGrade', 16, false),
    sleepGrade: readOptionalText(record, 'sleepGrade', 16, false),
    bodyFatLabel: readOptionalText(record, 'bodyFatLabel', 80, false),
    bodyWaterLabel: readOptionalText(record, 'bodyWaterLabel', 80, false),
    skeletalMuscleMassLabel: readOptionalText(record, 'skeletalMuscleMassLabel', 80, false),
    weightLabel: readOptionalText(record, 'weightLabel', 80, false),
    biologicalAgeLabel: readOptionalText(record, 'biologicalAgeLabel', 80, false),
    metabolicAgeLabel: readOptionalText(record, 'metabolicAgeLabel', 80, false),
  };
}

export function parseListLimit(raw: unknown): number {
  if (raw == null || raw === '') return DEFAULT_LIST_LIMIT;
  if (Array.isArray(raw) || (typeof raw !== 'string' && typeof raw !== 'number')) {
    fail('limit must be an integer from 1 to 200');
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIST_LIMIT) {
    fail('limit must be an integer from 1 to 200');
  }
  return n;
}

export function toPublicReading(row: StoredBodyComposition): BodyCompositionReading {
  const { userId: _userId, ...reading } = row;
  return reading;
}
