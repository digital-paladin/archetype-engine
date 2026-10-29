import { randomUUID } from 'crypto';
import {
  BodyCompositionDraft,
  BodyCompositionReading,
  StoredBodyComposition,
  parseBodyCompositionBody,
  parseListLimit,
  toPublicReading,
} from '../domain/bodyComposition';
import { getBodyCompositionStore } from './bodyComposition.store';

export interface LogBodyCompositionResult {
  reading: BodyCompositionReading;
  idempotentReplay: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

/**
 * Insert one scale reading. A repeated idempotency key returns the original
 * row and does not apply the second payload. No XP is awarded.
 */
export async function logBodyComposition(userId: string, body: unknown): Promise<LogBodyCompositionResult> {
  const draft: BodyCompositionDraft = parseBodyCompositionBody(body);
  const readings = getBodyCompositionStore();
  const existing = await readings.findByIdempotency(userId, draft.idempotencyKey);
  if (existing) return { reading: toPublicReading(existing), idempotentReplay: true };

  const row: StoredBodyComposition = {
    ...draft,
    id: randomUUID(),
    userId,
    createdAt: new Date().toISOString(),
  };

  try {
    const saved = await readings.insert(row);
    return { reading: toPublicReading(saved), idempotentReplay: false };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const replay = await readings.findByIdempotency(userId, draft.idempotencyKey);
      if (replay) return { reading: toPublicReading(replay), idempotentReplay: true };
    }
    throw err;
  }
}

/** Newest measured_at first. `limit` defaults to 50 and caps at 200. */
export async function listBodyComposition(userId: string, limitRaw: unknown): Promise<BodyCompositionReading[]> {
  const limit = parseListLimit(limitRaw);
  const rows = await getBodyCompositionStore().list(userId, limit);
  return rows.map(toPublicReading);
}
