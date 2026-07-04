/**
 * Module-level write queue for journal file operations.
 *
 * Multiple concurrent route handlers (Fitbit nutrition, Fitbit vitals, action-log
 * toggles, sleep writes) all read-modify-write the same journal file. Without
 * serialization, the second writer reads stale content before the first writer's
 * changes land — silently overwriting updates (e.g. food log entry wiping hydration,
 * or an ACM checkbox change being lost because a Fitbit write started a millisecond
 * earlier with an older file snapshot).
 *
 * This queue ensures only ONE journal write runs at a time across the entire
 * Node.js process. Pure reads (GET operations that never write) are unaffected.
 *
 * Usage:
 *   import { withJournalLock } from '../services/journalLock';
 *
 *   // Wrap the entire read-modify-write sequence:
 *   await withJournalLock(() => journalWriter.fillHydrationPlaceholder(oz, date));
 *   await withJournalLock(() => updateActionLog(date, states));
 *
 *   // For multiple sequential writes in one handler, wrap them together:
 *   await withJournalLock(async () => {
 *     await journalWriter.updateSleepData(score, hours, vitality, date);
 *     await journalWriter.fillSleepPlaceholders(sleep, date);
 *   });
 */

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Serialize a journal write operation.
 *
 * The provided `fn` will not begin until all previously enqueued writes have
 * completed. Errors thrown inside `fn` are propagated to the caller but do NOT
 * stall the queue — subsequent writes proceed normally.
 */
export function withJournalLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn);
  // Absorb errors so the queue does not get stuck on a failed write
  writeQueue = result.then(
    () => {},
    () => {}
  );
  return result;
}
