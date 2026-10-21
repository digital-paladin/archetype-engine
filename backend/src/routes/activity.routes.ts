import { Router, Request, Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { XpCalculatorService } from '../services/xpCalculator.service';
import { pushLog, getLogs, mergeActivityFeed, toActivityFeedEntry } from '../services/activityLogStore';
import { recordActivitySession, applyCourageFlag } from '../services/courage.service';
import { getDataService } from '../services/data/dataService';
import { getActiveBodyStatuses } from '../services/bodyStatus.service';
import {
  isRecoveryQuestType, validateRecoveryActivity, localDate, CLAIM_DATE_TAG,
  isRealIsoDate, mergeActivityLogs,
} from '../services/recoveryQuests.service';
import { persistClassXpAwards, toCanonicalClassName } from '../services/xpAward.service';
import { emitToUser } from '../realtime/userEmit';
import { ActivityWhenError, resolveActivityWhen } from '../services/activityOccurredAt';

/**
 * Recent activity_log window used to see training logged on a claimed day.
 * One-time recovery rows are loaded in full via getActivitiesByTypePrefix,
 * so an old X-ray step is still visible after this window scrolls off.
 */
const RECOVERY_LOG_LOOKBACK = 2000;

const router = Router();

// Initialize services
const xpCalculator = new XpCalculatorService();

/**
 * Configure Socket.IO instance for real-time updates
 */
let io: SocketIOServer;
export function setSocketIO(socketInstance: SocketIOServer) {
  io = socketInstance;
}

/**
 * POST /api/activities
 * Log a new activity and return XP gained
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { activityType, duration, notes: rawNotes, xp: clientXp, clientDate, courageFlag, courageNote } = req.body;
    console.log(`[ACTIVITY] POST /api/activities — type=${activityType} duration=${duration ?? '—'}min xp=${clientXp ?? 'auto'} date=${clientDate ?? 'server'} courageFlag=${!!courageFlag}`);

    // Validate required fields
    if (!activityType || typeof activityType !== 'string') {
      return res.status(400).json({ 
        error: 'activityType is required and must be a string' 
      });
    }

    const userId = (req as any).userId as string | undefined;

    // ── Recovery & Consistency quests: server-validated, flat server XP ──────
    const isRecovery = isRecoveryQuestType(activityType);
    let notes = rawNotes;
    if (isRecovery) {
      if (!userId) {
        return res.status(401).json({ error: 'Recovery quests require a signed-in user' });
      }
      // A provided clientDate that isn't a real day must not fall through to
      // "today" — 2026-09-31 overflows onto a Thursday and would farm Rest Day Kept.
      const providedDate = typeof clientDate === 'string' ? clientDate.trim() : undefined;
      let claimDate: string;
      if (providedDate === undefined || providedDate === '') {
        claimDate = localDate(new Date().toISOString());
      } else if (isRealIsoDate(providedDate)) {
        claimDate = providedDate;
      } else {
        return res.status(409).json({
          error: 'Claim date must be a real calendar day (YYYY-MM-DD)',
          activityType,
        });
      }
      const db = getDataService();
      const [recent, recoveryHistory] = await Promise.all([
        db.getActivityLog(userId, RECOVERY_LOG_LOOKBACK),
        db.getActivitiesByTypePrefix(userId, 'recovery-'),
      ]);
      const log = mergeActivityLogs(recoveryHistory, recent);
      const check = validateRecoveryActivity(activityType, claimDate, log);
      if (!check.ok) {
        console.log(`[ACTIVITY] Recovery quest rejected — ${activityType} ${claimDate}: ${check.reason}`);
        return res.status(409).json({ error: check.reason, activityType, date: claimDate });
      }
      const userNotes = typeof rawNotes === 'string' ? rawNotes.trim() : '';
      notes = userNotes ? `${CLAIM_DATE_TAG(claimDate)} ${userNotes}` : CLAIM_DATE_TAG(claimDate);
    }

    // Compute per-class XP breakdown (multi-class activities award XP to several classes).
    const xpAwards = xpCalculator.getMultiClassXP(activityType, duration);
    const totalServerXp = xpAwards.reduce((s, a) => s + a.xp, 0);

    // Use client-supplied XP when provided (frontend has the authoritative calculation);
    // fall back to server-side estimate for legacy/manual calls. Recovery quests
    // always use the server's flat values so they can't be inflated client-side.
    const rawXp = (!isRecovery && typeof clientXp === 'number' && clientXp > 0)
      ? Math.round(clientXp)
      : totalServerXp;
    const category = xpCalculator.getCategoryFromActivity(activityType);

    // For single-class activities, if the client's authoritative XP differs from
    // the server's flat config-based estimate (e.g. crafting recipes send a
    // per-recipe xpReward that the activityXP config entry doesn't know about —
    // confirmed cause of Survivalist "wilderness-craft" always persisting a flat
    // 20 XP to character_stats regardless of what the UI displayed/logged), use
    // the reconciled `rawXp` as that one award's baseline too, before any
    // body-status penalty below. Multi-class activities keep the server's
    // per-class breakdown since redistributing an arbitrary clientXp across
    // several classes isn't well-defined.
    const reconciledXpAwards = (xpAwards.length === 1 && rawXp !== totalServerXp)
      ? [{ class: xpAwards[0].class, xp: rawXp }]
      : xpAwards;

    // ── Body-status XP penalty (previously dead code — BodyStatusService.getXPPenaltyForAction()
    // was unit-tested but never wired into a real activity-logging path). Take the max active
    // xp_penalty among statuses whose impacts_actions includes this activityType — highest wins,
    // not cumulative, matching the frontend's own rule. Applied here, before both persistence and
    // the response, so the DB value and what the client sees never drift apart. ──
    let xpPenaltyPct = 0;
    if (userId) {
      try {
        const activeBodyStatuses = await getActiveBodyStatuses(userId);
        const matching = activeBodyStatuses.filter(s => s.impacts_actions?.includes(activityType));
        if (matching.length > 0) {
          xpPenaltyPct = Math.max(...matching.map(s => s.xp_penalty ?? 0));
        }
      } catch (bsErr) {
        console.warn('[ACTIVITY] Body-status penalty lookup failed (defaulting to 0%):',
          bsErr instanceof Error ? bsErr.message : bsErr);
      }
    }
    const penaltyMultiplier = (100 - xpPenaltyPct) / 100;
    const xp = Math.round(rawXp * penaltyMultiplier);
    // Same multiplier applied on top of the client/server reconciliation above, so the
    // response and the per-class Supabase writes below (character_stats) both stay
    // reconciled with the top-level `xp` the client sees.
    const finalXpAwards = reconciledXpAwards.map(a => ({ ...a, xp: Math.round(a.xp * penaltyMultiplier) }));
    if (xpPenaltyPct > 0) {
      console.log(`[ACTIVITY] Body-status XP penalty applied: -${xpPenaltyPct}% (${rawXp} → ${xp})`);
    }

    // Occurred time is resolved after XP math and before any write. A bad
    // date is a 400 and does not touch the log. Today (UTC or Chicago) and
    // an omitted date stay on the request clock; a past day is stored on
    // that day. See activityOccurredAt.ts for the 90-day / 15-minute rules.
    const { date, occurredAt, startTime } = req.body;
    let when;
    try {
      when = resolveActivityWhen({ occurredAt, startTime, date, clientDate });
    } catch (whenErr) {
      if (whenErr instanceof ActivityWhenError) {
        return res.status(400).json({ error: whenErr.message });
      }
      throw whenErr;
    }

    // ── Courage XP calculation (session bonus + optional flag) ──────────────
    const sessionCourageXP = recordActivitySession(activityType);
    const flagCourageXP    = courageFlag === true ? applyCourageFlag(activityType, courageNote, when.date) : 0;
    const courageXPAwarded = sessionCourageXP + flagCourageXP;

    // Push to in-memory log and emit real-time update
    const source = activityType.startsWith('Combo:') ? 'combo' as const : 'skill' as const;
    const logEntry = pushLog({
      activityType, xp, duration, notes, category, source,
      timestamp: when.loggedAt,
      courageFlag: courageFlag === true || undefined,
      courageNote: courageNote || undefined,
      courageXPAwarded: courageXPAwarded > 0 ? courageXPAwarded : undefined,
    });
    emitToUser(io, userId, 'activity-logged', logEntry);

    // ── Supabase writes (non-blocking — failure must not block the HTTP response) ──
    if (userId) {
      const dateStr = when.date;
      setImmediate(async () => {
        try {
          const db   = getDataService();

          // 1. Persist activity entry to Supabase activity_log.
          // logged_at is the resolved activity time, so per-day windows count it on when.date.
          await db.logActivity(userId, {
            activity_type:  activityType,
            class_name:     toCanonicalClassName(category),
            duration_hours: duration ? +(duration / 60).toFixed(2) : undefined,
            xp_awarded:     xp,
            notes:          notes || undefined,
            logged_at:      when.loggedAt,
          });

          // 2. Apply XP through the shared character_stats path (also used by System quests).
          await persistClassXpAwards(
            userId,
            finalXpAwards.map(award => ({ className: award.class, xp: award.xp })),
            {
              onLevelUp: ({ className, newLevel }) => {
                emitToUser(io, userId, 'level-up', { class: className, newLevel, date: dateStr });
                console.log(`[ACTIVITY] 🎉 Level-up! ${className} → L${newLevel}`);
              },
            },
          );
        } catch (dbErr) {
          // Upgraded from console.warn: this write happens after the HTTP response
          // has already been sent, so a swallowed failure here is otherwise
          // completely invisible — the user sees "+N XP" in the UI while
          // character_stats silently never receives it. Log loudly with full
          // context and notify any connected client so the discrepancy is at
          // least observable in real time instead of only discoverable by
          // noticing a class is stuck at a level it should have passed.
          const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
          console.error(
            `[ACTIVITY] ❌ Supabase write FAILED for user=${userId} activityType=${activityType} ` +
            `xp=${xp} awards=${JSON.stringify(finalXpAwards)} — character_stats NOT updated:`,
            errMsg,
          );
          emitToUser(io, userId, 'activity-write-failed', { activityType, xp, awards: finalXpAwards, error: errMsg });
        }
      });
    }

    // Return success response
    res.json({
      success: true,
      xp,
      category,
      activityType,
      duration,
      xpAwards: finalXpAwards,
      date: when.date,
      occurredAt: when.occurredAt,
      loggedAt: when.loggedAt,
      message: `Activity logged successfully! +${xp} XP`,
      ...(xpPenaltyPct > 0 && { xpPenaltyPct }),
      ...(courageXPAwarded > 0 && { courageXPAwarded, courageMessage: `+${courageXPAwarded} Courage XP earned!` }),
    });

  } catch (error) {
    console.error('❌ Error logging activity:', error);
    res.status(500).json({
      error: 'Failed to log activity',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

const DEFAULT_ACTIVITY_LIMIT = 200;
const MAX_ACTIVITY_LIMIT = 200;

/**
 * GET /api/activities
 * Persistent activity_log for the signed-in user, newest first.
 * Optional `date=YYYY-MM-DD` limits the list to that UTC day.
 * Optional `limit` (1–200, default 200).
 * In-memory consume/water rows (not stored in activity_log) are merged in.
 * A failed database read falls back to the in-memory list.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId?: string }).userId;
    const dateQuery = typeof req.query.date === 'string' ? req.query.date.trim() : undefined;
    if (dateQuery && !/^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    let limit = DEFAULT_ACTIVITY_LIMIT;
    if (req.query.limit != null && req.query.limit !== '') {
      const parsed = Number(req.query.limit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ACTIVITY_LIMIT) {
        return res.status(400).json({
          error: `limit must be an integer from 1 to ${MAX_ACTIVITY_LIMIT}`,
        });
      }
      limit = parsed;
    }

    const memory = getLogs().filter(entry => !dateQuery || entry.timestamp.slice(0, 10) === dateQuery);
    if (!userId) {
      return res.json(memory.slice(0, limit));
    }

    try {
      const rows = await getDataService().getActivityLog(userId, limit, dateQuery);
      const persisted = rows.map((row, index) => toActivityFeedEntry(row, index));
      return res.json(mergeActivityFeed(persisted, memory, limit));
    } catch (dbErr) {
      console.error(
        '[ACTIVITY] GET persistent log failed, falling back to in-memory:',
        dbErr instanceof Error ? dbErr.message : dbErr,
      );
      return res.json(memory.slice(0, limit));
    }
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch activities',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/activities/types
 * Get list of available activity types with XP values
 */
router.get('/types', (req: Request, res: Response) => {
  try {
    const types = xpCalculator.getActivityTypes();
    res.json(types);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch activity types',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/activities/calculate-xp
 * Calculate XP for a specific activity (preview before logging)
 */
router.get('/calculate-xp', (req: Request, res: Response) => {
  try {
    const activityType = req.query.type as string;
    const duration = req.query.duration ? parseInt(req.query.duration as string) : undefined;

    if (!activityType) {
      return res.status(400).json({ 
        error: 'activityType query parameter is required' 
      });
    }

    const xp = xpCalculator.calculateXP(activityType, duration);
    const category = xpCalculator.getCategoryFromActivity(activityType);

    res.json({
      activityType,
      category,
      xp,
      duration: duration || 0
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to calculate XP',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as activityRouter };
