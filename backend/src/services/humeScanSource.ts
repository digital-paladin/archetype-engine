/**
 * Hume body-composition scans for weekly and monthly XP.
 *
 * PR #43 (POST /api/system/body-composition, table body_composition_readings)
 * is not on this branch. This module does not import it. When that module
 * is present at runtime, loadHumeScanSource adapts its rows. Until then the
 * loader returns null and scan awards are a no-op unless a source is registered.
 */

import { HumeScanReading } from './wearableMetricXp';

export interface HumeScanSource {
  listReadings(userId: string): Promise<HumeScanReading[]>;
}

let registered: HumeScanSource | null = null;

export function setHumeScanSource(next: HumeScanSource | null): void {
  registered = next;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Map a PR #43 body_composition reading (camelCase or the store's row) onto
 * the fields the trend and scan awards read. The idempotency key is the app
 * record. An explicit proof field wins when a later migration adds one.
 */
export function adaptBodyCompositionReading(row: Record<string, unknown>): HumeScanReading | null {
  const source = text(row.source);
  const measuredAt = text(row.measuredAt) ?? text(row.measured_at);
  if (!source || !measuredAt) return null;
  const proofRef = text(row.proofRef) ?? text(row.proof_ref) ?? text(row.proofReference) ?? text(row.proof_reference);
  const appRecordId = text(row.appRecordId)
    ?? text(row.app_record_id)
    ?? text(row.idempotencyKey)
    ?? text(row.idempotency_key);
  return {
    source,
    measuredAt,
    proofRef,
    appRecordId,
    skeletalMuscleMassLb: num(row.skeletalMuscleMassLb ?? row.skeletal_muscle_mass_lb),
    bodyFatPct: num(row.bodyFatPct ?? row.body_fat_pct),
    weightLb: num(row.weightLb ?? row.weight_lb),
    fatMassLb: num(row.fatMassLb ?? row.fat_mass_lb),
    fasted: bool(row.fasted),
  };
}

interface BodyCompositionListModule {
  getBodyCompositionStore?: () => {
    list: (userId: string, limit: number) => Promise<Array<Record<string, unknown>>>;
  };
}

export async function loadHumeScanSource(): Promise<HumeScanSource | null> {
  if (registered) return registered;
  try {
    // Variable path so this file still typechecks before PR #43 is merged.
    const moduleName = './bodyComposition.store';
    const loaded = require(moduleName) as BodyCompositionListModule;
    if (typeof loaded.getBodyCompositionStore !== 'function') return null;
    return {
      async listReadings(userId: string): Promise<HumeScanReading[]> {
        const rows = await loaded.getBodyCompositionStore!().list(userId, 200);
        return rows
          .map(row => adaptBodyCompositionReading(row))
          .filter((row): row is HumeScanReading => row !== null);
      },
    };
  } catch {
    return null;
  }
}
