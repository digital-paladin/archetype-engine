import { Router, Request, Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { XpCalculatorService } from '../services/xpCalculator.service';
import { pushLog, getLogs } from '../services/activityLogStore';
import { recordActivitySession, applyCourageFlag } from '../services/courage.service';
import { getDataService } from '../services/data/dataService';

const router = Router();

/**
 * Maps raw category names (from getCategoryFromActivity) and multi-class award names
 * (from multiClassXP entries, which use PascalCase) to canonical DB class_name values.
 */
function toCanonicalClassName(rawClass: string): string {
  const map: Record<string, string> = {
    developer:              'Developer',
    warrior:                'Warrior',
    sage:                   'Sage',
    artist:                 'Artist',
    redteam:                'Redteamer',
    redteamer:              'Redteamer',
    financial:              'Financial Strategist',
    'financial-strategist': 'Financial Strategist',
    survivalist:            'Survivalist',
    prayer:                 'Sage',   // prayer activities map to Sage XP
    general:                'Sage',   // fallback
    // PascalCase pass-through (from multiClassXP entries)
    Developer:              'Developer',
    Warrior:                'Warrior',
    Sage:                   'Sage',
    Artist:                 'Artist',
    Redteamer:              'Redteamer',
    'Financial Strategist': 'Financial Strategist',
    Survivalist:            'Survivalist',
  };
  return map[rawClass] ?? (rawClass.charAt(0).toUpperCase() + rawClass.slice(1));
}

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
    const { activityType, duration, notes, xp: clientXp, clientDate, courageFlag, courageNote } = req.body;
    console.log(`[ACTIVITY] POST /api/activities — type=${activityType} duration=${duration ?? '—'}min xp=${clientXp ?? 'auto'} date=${clientDate ?? 'server'} courageFlag=${!!courageFlag}`);

    // Validate required fields
    if (!activityType || typeof activityType !== 'string') {
      return res.status(400).json({ 
        error: 'activityType is required and must be a string' 
      });
    }

    // Compute per-class XP breakdown (multi-class activities award XP to several classes).
    const xpAwards = xpCalculator.getMultiClassXP(activityType, duration);
    const totalServerXp = xpAwards.reduce((s, a) => s + a.xp, 0);

    // Use client-supplied XP when provided (frontend has the authoritative calculation);
    // fall back to server-side estimate for legacy/manual calls.
    const xp = (typeof clientXp === 'number' && clientXp > 0)
      ? Math.round(clientXp)
      : totalServerXp;
    const category = xpCalculator.getCategoryFromActivity(activityType);

    // ── Courage XP calculation (session bonus + optional flag) ──────────────
    const sessionCourageXP = recordActivitySession(activityType);
    const flagCourageXP    = courageFlag === true ? applyCourageFlag(activityType, courageNote) : 0;
    const courageXPAwarded = sessionCourageXP + flagCourageXP;

    // Push to in-memory log and emit real-time update
    const source = activityType.startsWith('Combo:') ? 'combo' as const : 'skill' as const;
    const logEntry = pushLog({
      activityType, xp, duration, notes, category, source,
      courageFlag: courageFlag === true || undefined,
      courageNote: courageNote || undefined,
      courageXPAwarded: courageXPAwarded > 0 ? courageXPAwarded : undefined,
    });
    if (io) {
      io.emit('activity-logged', logEntry);
    }

    // ── Supabase writes (non-blocking — failure must not block the HTTP response) ──
    const userId = (req as any).userId as string | undefined;
    if (userId) {
      const dateStr = clientDate || new Date().toLocaleDateString('en-CA');
      setImmediate(async () => {
        try {
          const db   = getDataService();
          const calc = new XpCalculatorService();

          // 1. Persist activity entry to Supabase activity_log
          await db.logActivity(userId, {
            activity_type:  activityType,
            class_name:     toCanonicalClassName(category),
            duration_hours: duration ? +(duration / 60).toFixed(2) : undefined,
            xp_awarded:     xp,
            notes:          notes || undefined,
            logged_at:      new Date().toISOString(),
          });

          // 2. Apply XP to character_stats for each awarded class
          const allStats = await db.getCharacterStats(userId);
          for (const award of xpAwards) {
            const canonClass = toCanonicalClassName(award.class);
            const current    = allStats.find(s => s.class_name === canonClass);
            const lvl        = current?.level ?? 1;
            const currXP     = current?.current_xp ?? 0;
            const totalXP    = current?.total_xp ?? 0;

            const { newLevel, newCurrentXP, leveledUp } = calc.applyXPGain(lvl, currXP, award.xp);

            await db.upsertCharacterStats(userId, {
              class_name: canonClass,
              level:      newLevel,
              current_xp: newCurrentXP,
              total_xp:   totalXP + award.xp,
            });

            if (leveledUp && io) {
              io.emit('level-up', { class: canonClass, newLevel, date: dateStr });
              console.log(`[ACTIVITY] 🎉 Level-up! ${canonClass} → L${newLevel}`);
            }
          }
        } catch (dbErr) {
          console.warn('[ACTIVITY] Supabase write failed (non-blocking):',
            dbErr instanceof Error ? dbErr.message : dbErr);
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
      xpAwards,
      message: `Activity logged successfully! +${xp} XP`,
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

/**
 * GET /api/activities
 * Return the in-memory activity log (most-recent-first)
 */
router.get('/', (req: Request, res: Response) => {
  res.json(getLogs());
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
