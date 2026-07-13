import { Router, Request, Response } from 'express';
import { CharacterParser } from '../parser/characterParser';
import { parseRecentEntries, calcTimeToLevel, parseDisciplineData, parseSystemAlerts } from '../parser/analyticsParser';
import { XPProjectionService } from '../services/xpProjection.service';
import { ArchiveReaderService } from '../services/archiveReader.service';
import { getDataService } from '../services/data/dataService';
import { getSupabaseAdmin } from '../lib/supabase';
import { calculateOverallLevelInfo } from '../utils/overallLevel';

const router = Router();



/**
 * Helper function to get parser instance with correct path
 * Lazy-loads parser to ensure dotenv has loaded first
 */
function getParser(): CharacterParser {
  const CHARACTER_FILE_PATH = process.env.CHARACTER_FILE_PATH || '../character-sheet.md';
  return new CharacterParser(CHARACTER_FILE_PATH);
}

// ── Supabase skill-tree helpers ───────────────────────────────────────────────

function tierForLevel(level: number): string {
  if (level >= 40) return 'Grandmaster';
  if (level >= 30) return 'Master';
  if (level >= 20) return 'Expert';
  if (level >= 10) return 'Adept';
  if (level >= 5)  return 'Novice';
  return 'Foundation';
}

/** Approximate XP threshold to reach next level — based on L20=16,720 data point */
function xpThresholdForLevel(level: number): number {
  return Math.max(100, Math.round(836 * level));
}

function classNameToId(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('developer') || n.includes('web app')) return 'developer';
  if (n.includes('warrior'))              return 'warrior';
  if (n.includes('sage'))                 return 'sage';
  if (n.includes('artist'))               return 'artist';
  if (n.includes('red team') || n.includes('redteam') || n.includes('red-team')) return 'redteamer';
  if (n.includes('financial'))            return 'financial-strategist';
  if (n.includes('survivalist'))          return 'survivalist';
  if (n.includes('mechanical'))           return 'mechanical-engineer';
  return n.replace(/\s+/g, '-');
}

function formatClassName(name: string): string {
  // Display names must match XP-projection keys on the Character panel
  // (getDbClassStat looks up by exact name — "Redteamer", not "Red Team Operator").
  const niceName: Record<string, string> = {
    developer: 'Developer', warrior: 'Warrior', sage: 'Sage', artist: 'Artist',
    redteamer: 'Redteamer', 'financial-strategist': 'Financial Strategist',
    survivalist: 'Survivalist', 'mechanical-engineer': 'Mechanical Engineer',
  };
  return niceName[classNameToId(name)] || name;
}

/**
 * GET /api/character
 * Returns full character data
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const parser = getParser();
    const characterData = await parser.parse();
    res.json(characterData);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch character data',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/character/skill-trees
 * Returns skill tree stats. DB-first (character_stats); CharacterParser fallback.
 */
router.get('/skill-trees', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    if (userId) {
      try {
        const db      = getDataService();
        const dbStats = await db.getCharacterStats(userId);
        if (dbStats.length > 0) {
          const iconMap: Record<string, string> = {
            developer: '⌨', warrior: '⚔', sage: '📖', artist: '🎨',
            redteamer: '🔴', 'financial-strategist': '📈', survivalist: '🏕', 'mechanical-engineer': '🔧',
          };
          const skillTrees = dbStats.map(stat => {
            const id  = classNameToId(stat.class_name);
            const xtn = xpThresholdForLevel(stat.level);
            return {
              id,
              name:                  formatClassName(stat.class_name),
              icon:                  iconMap[id] ?? '',
              level:                 stat.level,
              currentXP:             stat.current_xp,
              xpToNextLevel:         xtn,
              totalCareerXP:         stat.total_xp,
              percentToNext:         Math.round((stat.current_xp / Math.max(1, xtn)) * 100),
              tier:                  tierForLevel(stat.level),
              activeBuffs:           [],
              weeklyActivity:        '0 hrs/week',
              weeklyXPRate:          0,
              estimatedWeeksToLevel: 0,
              rustStatus:            'sharp' as const,
            };
          });
          console.log(`[CHARACTER /skill-trees] DB — ${dbStats.length} classes`);
          return res.json(skillTrees);
        }
      } catch (dbErr) {
        console.warn('[CHARACTER /skill-trees] DB fetch error:', dbErr instanceof Error ? dbErr.message : dbErr);
      }
    }
    // Fallback: CharacterParser (character_stats not yet seeded)
    const parser = getParser();
    const characterData = await parser.parse();
    res.json(characterData.skillTrees);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch skill trees',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/character/stats
 * Returns vitality, sleep debt, phase info, sage streak, ACM metrics, RPG stats, skill trees.
 * DB-first: reads character_stats + character_profile (populated by consolidation service).
 * Falls back to CharacterParser when DB has no data yet.
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;

    // DB-first: fetch both tables; if either errors, we fall back to CharacterParser
    let dbStats: { class_name: string; level: number; current_xp: number; total_xp: number }[] = [];
    let profile: { vitality?: number; sleep_debt?: number; sleep_trend?: string; sage_streak?: number; phase?: string; acm_metrics?: unknown; rpg_stats?: unknown } | null = null;
    if (userId) {
      try {
        const db = getDataService();
        [dbStats, profile] = await Promise.all([
          db.getCharacterStats(userId),
          db.getCharacterProfile(userId),
        ]);
      } catch (dbErr) {
        console.warn('[CHARACTER /stats] DB fetch error:', dbErr instanceof Error ? dbErr.message : dbErr);
      }
    }

    if (dbStats.length > 0) {
      const iconMap: Record<string, string> = {
        developer: '⌨', warrior: '⚔', sage: '📖', artist: '🎨',
        redteamer: '🔴', 'financial-strategist': '📈', survivalist: '🏕', 'mechanical-engineer': '🔧',
      };
      const skillTrees = dbStats.map(stat => {
        const id  = classNameToId(stat.class_name);
        const xtn = xpThresholdForLevel(stat.level);
        return {
          id,
          name:                  formatClassName(stat.class_name),
          icon:                  iconMap[id] ?? '',
          level:                 stat.level,
          currentXP:             stat.current_xp,
          xpToNextLevel:         xtn,
          totalCareerXP:         stat.total_xp,
          percentToNext:         Math.round((stat.current_xp / Math.max(1, xtn)) * 100),
          tier:                  tierForLevel(stat.level),
          activeBuffs:           [],
          weeklyActivity:        '0 hrs/week',
          weeklyXPRate:          0,
          estimatedWeeksToLevel: 0,
          rustStatus:            'sharp' as const,
        };
      });
      // Overall level = chronological age from PLAYER_BIRTH_DATE — NOT max skill-tree level.
      const overallLevelInfo = calculateOverallLevelInfo();
      console.log(`[CHARACTER /stats] DB — ${dbStats.length} classes, overall L${overallLevelInfo.level}, profile: ${profile ? 'yes' : 'no (defaults)'}`);
      return res.json({
        vitality:       profile?.vitality    ?? 100,
        sleepDebt:      profile?.sleep_debt  ?? 0,
        phase:          profile?.phase       ?? 'adept',
        sageStreak:     profile?.sage_streak ?? 0,
        acmMetrics:     profile?.acm_metrics ?? {},
        rpgStats:       profile?.rpg_stats   ?? {},
        skillTrees,
        overallLevelInfo,
      });
    }

    // Fallback: CharacterParser (character_stats not yet seeded)
    console.warn('[CHARACTER /stats] No DB stats — falling back to CharacterParser');
    const parser = getParser();
    const characterData = await parser.parse();
    res.json({
      vitality:       characterData.vitality,
      sleepDebt:      characterData.sleepDebt,
      phase:          characterData.phase,
      sageStreak:     characterData.sageStreak,
      acmMetrics:     characterData.acmMetrics,
      rpgStats:       characterData.rpgStats,
      skillTrees:     characterData.skillTrees,
      overallLevelInfo: characterData.overallLevelInfo,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/character/history
 * Returns paginated history entries (TODO Week 9-10)
 */
router.get('/history', async (req: Request, res: Response) => {
  // TODO Week 9-10: Implement history parsing
  const limit = parseInt(req.query.limit as string) || 10;
  const offset = parseInt(req.query.offset as string) || 0;

  res.json({
    message: 'History endpoint not yet implemented',
    limit,
    offset,
    data: []
  });
});

/**
 * POST /api/character/xp-update
 * For Copilot to trigger XP updates (TODO Future)
 */
router.post('/xp-update', async (req: Request, res: Response) => {
  // TODO Future: Implement Copilot integration
  res.json({
    message: 'XP update endpoint not yet implemented',
    receivedData: req.body
  });
});

/**
 * GET /api/character/analytics
 * DB-first: aggregates xp_history → recentEntries + projections + timeToLevel.
 * Falls back to file-based parsing when userId absent or DB empty.
 */
router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const daysParam  = parseInt(req.query.days as string, 10);
    const maxEntries = isNaN(daysParam) ? 90 : daysParam;
    const userId     = (req as any).userId as string;

    if (userId) {
      try {
        const db      = getDataService();
        const history = await db.getXPHistory(userId).catch(() => []);
        const stats   = await db.getCharacterStats(userId).catch(() => []);

        if (history.length > 0) {
          // ── Build recentEntries from xp_history ──────────────────────────────
          const dayMap = new Map<string, Record<string, number>>();
          for (const entry of history) {
            const day = entry.earned_at.slice(0, 10);
            if (!dayMap.has(day)) dayMap.set(day, {});
            const cm = dayMap.get(day)!;
            cm[entry.class_name] = (cm[entry.class_name] ?? 0) + entry.xp_confirmed;
          }
          const recentEntries = Array.from(dayMap.entries())
            .sort(([a], [b]) => b.localeCompare(a))
            .slice(0, maxEntries)
            .map(([dateStr, classXP]) => {
              const d = new Date(dateStr + 'T12:00:00Z');
              const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const totalXP   = Object.values(classXP).reduce((a, b) => a + b, 0);
              return { dateLabel, classXP, totalXP };
            });

          // ── Build projections from xp_history ────────────────────────────────
          const classMap: Record<string, { totalXP: number; days: Set<string> }> = {};
          for (const entry of history) {
            const cls = entry.class_name;
            const day = entry.earned_at.slice(0, 10);
            if (!classMap[cls]) classMap[cls] = { totalXP: 0, days: new Set() };
            classMap[cls].totalXP += entry.xp_confirmed;
            classMap[cls].days.add(day);
          }
          const projections: Record<string, any> = {};
          for (const [cls, data] of Object.entries(classMap)) {
            const daysTracked = Math.max(1, data.days.size);
            const avg = data.totalXP / daysTracked;
            projections[cls] = {
              totalXP:      data.totalXP,
              daysTracked,
              avgDailyXP:   Number(avg.toFixed(2)),
              avgWeeklyXP:  Number((avg * 7).toFixed(2)),
              projected6mo: Math.round(avg * 182.5),
              projected12mo: Math.round(avg * 365),
            };
          }

          // ── Build timeToLevel from character_stats + projections ──────────────
          const timeToLevel = stats.map(stat => {
            const avg      = projections[stat.class_name]?.avgDailyXP ?? 0;
            const xpNeeded = Math.max(0, xpThresholdForLevel(stat.level) - stat.current_xp);
            const days     = avg > 0 ? Math.ceil(xpNeeded / avg) : 9999;
            const projDate = new Date();
            projDate.setDate(projDate.getDate() + days);
            return {
              className:     stat.class_name,
              level:         stat.level,
              currentXP:     stat.current_xp,
              xpNeeded,
              avgDailyXP:    Number(avg.toFixed(2)),
              daysRemaining: days,
              projectedDate: days < 9999
                ? projDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                : 'N/A',
              isInactive:    avg === 0,
            };
          });

          const systemAlerts = parseSystemAlerts(recentEntries);
          console.log(`[ANALYTICS] DB — ${recentEntries.length} entries, ${timeToLevel.length} classes`);
          return res.json({
            recentEntries,
            timeToLevel,
            projections,
            disciplineSummary: {},  // acl_items not yet seeded
            systemAlerts,
          });
        }
      } catch (dbErr) {
        console.warn('[ANALYTICS] DB error, falling back to file:', dbErr instanceof Error ? dbErr.message : dbErr);
      }
    }

    // ── File fallback ────────────────────────────────────────────────────────
    const filePath = process.env.CHARACTER_FILE_PATH || '../character-sheet.md';
    console.log(`[ANALYTICS] File fallback: ${filePath}`);
    const content          = ArchiveReaderService.getFullCharacterHistory(filePath);
    const recentEntries    = parseRecentEntries(content, maxEntries);
    const parser           = getParser();
    const characterData    = await parser.parse();
    const projections      = XPProjectionService.parseXPProjections(filePath);
    const timeToLevel      = calcTimeToLevel(characterData.skillTrees, projections);
    const disciplineSummary = parseDisciplineData(content, maxEntries);
    const systemAlerts      = parseSystemAlerts(recentEntries);
    res.json({ recentEntries, timeToLevel, projections, disciplineSummary, systemAlerts });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ANALYTICS] Error:', msg);
    res.json({
      recentEntries: [],
      timeToLevel: [],
      projections: {},
      disciplineSummary: {},
      systemAlerts: [],
      _error: msg,
    });
  }
});

/**
 * GET /api/character/injuries
 * Returns active injuries. Injury tracking will move to a dedicated Supabase table (Sprint 11).
 */
router.get('/injuries', (_req: Request, res: Response) => {
  res.json({ success: true, injuries: [] });
});

/**
 * GET /api/character/quest-lines
 * Returns the Paladin's Arc quest lines and Grand Convergence.
 * DB-first (quest_lines + grand_convergence tables); CharacterParser fallback.
 */
router.get('/quest-lines', async (_req: Request, res: Response) => {
  try {
    const userId = (_req as any).userId as string;
    if (userId) {
      try {
        const db = getDataService();
        const [dbQuestLines, dbGrandConvergence] = await Promise.all([
          db.getQuestLines(userId),
          db.getGrandConvergence(userId),
        ]);
        if (dbQuestLines.length > 0) {
          const questLines = dbQuestLines.map(ql => ({
            id:               ql.id ?? '',
            number:           ql.quest_number ?? 0,
            name:             ql.name,
            icon:             ql.icon ?? '',
            class:            ql.class_name ?? '',
            statusText:       ql.status_text ?? '',
            statusEmoji:      ql.status_emoji ?? '',
            tagline:          ql.tagline ?? '',
            chapters:         (ql.chapters ?? []) as Array<{ chapter: string; milestone: string; status: string; statusIcon: string }>,
            currentXpDrivers: ql.current_xp_drivers ?? '',
            unlocks:          ql.unlocks ?? '',
          }));
          const conditions   = (dbGrandConvergence?.conditions ?? []) as Array<{ condition: string; questLine: string; complete: boolean }>;
          const grandConvergence = dbGrandConvergence
            ? { conditions, allComplete: conditions.every(c => c.complete) }
            : null;
          console.log(`[CHARACTER /quest-lines] DB — ${questLines.length} quest lines`);
          return res.json({ questLines, grandConvergence });
        }
      } catch (dbErr) {
        console.warn('[CHARACTER /quest-lines] DB fetch error:', dbErr instanceof Error ? dbErr.message : dbErr);
      }
    }
    // Fallback: CharacterParser
    const parser = getParser();
    const characterData = await parser.parse();
    res.json({
      questLines:       characterData.questLines ?? [],
      grandConvergence: characterData.grandConvergence ?? null,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch quest lines',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/character/quest-lines/seed
 * One-time seed: reads quest lines from CharacterParser and writes to DB.
 * Call this once after creating the quest_lines + grand_convergence tables.
 */
router.post('/quest-lines/seed', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const parser        = getParser();
    const characterData = await parser.parse();
    const questLines    = (characterData.questLines ?? []) as Array<{
      id: string; number: number; name: string; icon: string; class: string;
      statusText: string; statusEmoji: string; tagline: string;
      chapters: Array<{ chapter: string; milestone: string; status: string; statusIcon: string }>;
      currentXpDrivers: string; unlocks: string;
    }>;
    const grandConvergence = characterData.grandConvergence as {
      conditions: Array<{ condition: string; questLine: string; complete: boolean }>;
      allComplete: boolean;
    } | null;

    const db = getDataService();
    const rows = questLines.map((ql, idx) => ({
      quest_number:      ql.number,
      name:              ql.name,
      icon:              ql.icon,
      class_name:        ql.class,
      status_text:       ql.statusText,
      status_emoji:      ql.statusEmoji,
      tagline:           ql.tagline,
      chapters:          ql.chapters,
      current_xp_drivers: ql.currentXpDrivers,
      unlocks:           ql.unlocks,
      sort_order:        idx,
    }));
    await db.upsertQuestLines(userId, rows as any);
    if (grandConvergence) {
      await db.upsertGrandConvergence(userId, { conditions: grandConvergence.conditions });
    }

    console.log(`[CHARACTER /quest-lines/seed] Seeded ${rows.length} quest lines for user ${userId}`);
    res.json({ success: true, seeded: rows.length });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to seed quest lines',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/character/amcc
 *
 * Computes a 30-day rolling aMCC (anterior mid-cingulate cortex) development estimate.
 * The aMCC grows when you do something you don't want to do — resistance override is the
 * training stimulus. Only the 6 weight-2 ACM items (genuine Nen-style restrictions) are
 * counted; execution-discipline items (hydration, protein, supplements) do not qualify.
 *
 * HIGH_RESISTANCE_INDICES = [0, 1, 2, 3, 10, 12]
 *   0: Alcohol abstention   1: Wake Up With God   2: Physical Training
 *   3: Deep Work: Dev      10: Sexual discipline  12: Pre-Sleep Bonfire
 *
 * Score = (totalHighResistanceChecks / 180) × 100  (180 = 6 items × 30 days)
 * Tiers: 0–39 Atrophying | 40–59 Baseline | 60–79 Developing | 80–94 Hardened | 95–100 Elite
 */
router.get('/amcc', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const supabase = getSupabaseAdmin();
    const HIGH_RESISTANCE_INDICES = [0, 1, 2, 3, 10, 12];
    const WINDOW_DAYS  = 30;
    const MAX_POSSIBLE = HIGH_RESISTANCE_INDICES.length * WINDOW_DAYS; // 180

    const today     = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - (WINDOW_DAYS - 1));
    const startStr = startDate.toISOString().slice(0, 10);
    const endStr   = today.toISOString().slice(0, 10);

    // Step 1 — get journal entry IDs for this user in the date window
    const { data: journals, error: je } = await supabase
      .from('daily_journal_entries')
      .select('id, entry_date')
      .eq('user_id', userId)
      .gte('entry_date', startStr)
      .lte('entry_date', endStr);
    if (je) throw new Error(je.message);

    const journalIds = (journals ?? []).map(j => j.id as string);
    const dateById   = Object.fromEntries((journals ?? []).map(j => [j.id as string, j.entry_date as string]));

    // Step 2 — count completed high-resistance ACM items across those entries
    const dayMap: Record<string, number> = {};
    let totalChecks = 0;

    if (journalIds.length > 0) {
      const { data: entries, error: ae } = await supabase
        .from('acm_entries')
        .select('journal_entry_id, item_index, completed')
        .in('journal_entry_id', journalIds)
        .in('item_index', HIGH_RESISTANCE_INDICES)
        .eq('completed', true);
      if (ae) throw new Error(ae.message);

      for (const row of (entries ?? [])) {
        const dateStr = dateById[row.journal_entry_id as string]?.slice(0, 10) ?? '';
        if (dateStr) dayMap[dateStr] = (dayMap[dateStr] ?? 0) + 1;
        totalChecks++;
      }
    }

    const score = Math.round((totalChecks / MAX_POSSIBLE) * 100);
    const tier  =
      score >= 95 ? 'Elite'       :
      score >= 80 ? 'Hardened'    :
      score >= 60 ? 'Developing'  :
      score >= 40 ? 'Baseline'    : 'Atrophying';

    const descriptions: Record<string, string> = {
      Elite:      'Netero-tier daily activation. Structural density near ceiling.',
      Hardened:   'High resistance override rate. Significant structural development occurring.',
      Developing: 'Regular activation. Measurable aMCC growth in progress.',
      Baseline:   'Maintenance level. No significant growth or decay.',
      Atrophying: 'Consistent avoidance. Structural regression risk.',
    };

    // Build 30-day sparkline (resistance checks per day, 0–6 each)
    const sparkline: Array<{ date: string; checks: number; pct: number }> = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      const d       = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const checks  = dayMap[dateStr] ?? 0;
      sparkline.push({
        date:   d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        checks,
        pct:    Math.round((checks / HIGH_RESISTANCE_INDICES.length) * 100),
      });
    }

    console.log(`[AMCC] user=${userId} score=${score} tier=${tier} checks=${totalChecks}/${MAX_POSSIBLE}`);
    res.json({ success: true, score, tier, description: descriptions[tier], totalChecks, maxPossible: MAX_POSSIBLE, sparkline });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[AMCC] Error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

export { router as characterRouter };
