import { getDataService } from './data/dataService';
import { BodyStatusRow, IDataService } from './data/IDataService';

/**
 * "Active" (not yet auto-healed) filtering mirrors the frontend's
 * BodyStatusService.isHealed(): no estimated_recovery_days → never
 * auto-heals; otherwise active while daysSinceStart < estimated_recovery_days.
 * Kept in the service layer (not stored as a DB column) so the healed/active
 * boundary is computed once and can't drift between rows.
 */
export function isBodyStatusHealed(row: Pick<BodyStatusRow, 'start_date' | 'estimated_recovery_days'>): boolean {
  if (!row.estimated_recovery_days) return false;
  const daysSinceStart = Math.floor(
    (Date.now() - new Date(row.start_date).getTime()) / (1000 * 60 * 60 * 24),
  );
  return daysSinceStart >= row.estimated_recovery_days;
}

/** Max active severity → XP penalty %, used by both xp-penalty-wire and vitality-injury-dent. */
export const BODY_STATUS_VITALITY_PENALTY: Record<BodyStatusRow['severity'], number> = {
  minor:    0,
  moderate: 5,
  severe:   15,
  critical: 25,
};

export async function getActiveBodyStatuses(
  userId: string,
  db: IDataService = getDataService(),
): Promise<BodyStatusRow[]> {
  const all = await db.getBodyStatuses(userId);
  return all.filter(row => !isBodyStatusHealed(row));
}

/**
 * Highest active severity's vitality penalty (not cumulative — matches the
 * frontend's "take max, don't stack" XP-penalty pattern). Returns 0 if no
 * active statuses.
 */
export function maxVitalityPenalty(activeStatuses: BodyStatusRow[]): number {
  if (activeStatuses.length === 0) return 0;
  return Math.max(...activeStatuses.map(s => BODY_STATUS_VITALITY_PENALTY[s.severity] ?? 0));
}
