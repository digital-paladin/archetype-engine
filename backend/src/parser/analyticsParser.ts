/**
 * analyticsParser.ts
 * Parses recent daily history entries from character-sheet.md for
 * progression analytics: per-day XP, grit scores, time-to-level.
 */

const CLASS_NAMES = [
  'Developer', 'Sage', 'Warrior', 'Redteamer', 'Artist',
  'Financial Strategist', 'Survivalist'
];
const CLASS_NAME_RE = CLASS_NAMES.map(n => n.replace(' ', '\\s+')).join('|');

// Matches: - Sage: +11 XP  or  - Warrior (Deadlift): +13 XP  or  - Financial Strategist: +5 XP
const PERM_XP_RE = new RegExp(
  `- (${CLASS_NAME_RE})(?:\\s*\\([^)]+\\))?\\s*: \\+(\\d+) XP`,
  'gm'
);

// Matches: **Grit Score:** 6/12 (50%)
const GRIT_RE = /\*\*Grit Score:\*\* \d+\/12 \((\d+\.?\d*)%\)/;

// Matches: ### Feb 27 → Feb 28, 2026 ...  (captures "Feb 27") — handles both → and -> arrow formats
const HEADER_RE = /^(### (\w{3} \d{1,2}) (?:→|->) .+)$/m;

export interface DailyEntryData {
  dateLabel: string;           // "Feb 27"
  classXP: Record<string, number>;
  totalXP: number;
  gritPct?: number;
}

export interface TimeToLevel {
  className: string;
  level: number;
  currentXP: number;
  xpNeeded: number;
  avgDailyXP: number;
  daysRemaining: number;
  projectedDate: string;      // e.g. "Sep 2026"
  isInactive: boolean;
}

/**
 * Parse recent daily entries from character-sheet content.
 * Returns entries in REVERSE chronological order (most recent first).
 */
export function parseRecentEntries(content: string, maxEntries = 30): DailyEntryData[] {
  // Find all entry header positions
  const headerGlobalRe = /^### (\w{3} \d{1,2}) (?:→|->) /gm;  // handles both Unicode → and ASCII -> formats
  const headers: Array<{ index: number; label: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerGlobalRe.exec(content)) !== null) {
    headers.push({ index: m.index, label: m[1] });
  }

  const results: DailyEntryData[] = [];
  const limit = Math.min(headers.length, maxEntries);

  for (let i = 0; i < limit; i++) {
    const start = headers[i].index;
    const end = i + 1 < headers.length ? headers[i + 1].index : content.length;
    const block = content.slice(start, end);

    // Sum permanent XP per class within this block
    const classXP: Record<string, number> = {};
    const xpRe = new RegExp(PERM_XP_RE.source, 'gm');
    let xpM: RegExpExecArray | null;
    while ((xpM = xpRe.exec(block)) !== null) {
      const cls = xpM[1].replace(/\s+/g, ' ').trim(); // normalise multi-space
      const xp = parseInt(xpM[2]);
      classXP[cls] = (classXP[cls] ?? 0) + xp;
    }

    const gritMatch = block.match(GRIT_RE);
    const totalXP = Object.values(classXP).reduce((a, b) => a + b, 0);

    results.push({
      dateLabel: headers[i].label,
      classXP,
      totalXP,
      gritPct: gritMatch ? parseFloat(gritMatch[1]) : undefined,
    });
  }

  return results; // already reverse-chrono (most recent first due to file order)
}

/**
 * Calculate time-to-next-level for each skill tree.
 * Requires skill tree data (level, currentXP, xpToNextLevel) and
 * per-class avg daily XP from XPProjectionService.
 */
export function calcTimeToLevel(
  skillTrees: Array<{ id: string; name: string; level: number; currentXP: number; xpToNextLevel: number }>,
  projections: Record<string, { avgDailyXP: number }>
): TimeToLevel[] {
  const today = new Date();

  return skillTrees.map(tree => {
    const xpNeeded = Math.max(0, tree.xpToNextLevel - tree.currentXP);
    const proj = projections[tree.name];
    const avgDailyXP = proj?.avgDailyXP ?? 0;
    const isInactive = avgDailyXP === 0;

    let daysRemaining = Infinity;
    let projectedDate = 'Unknown';

    if (!isInactive && xpNeeded > 0) {
      daysRemaining = Math.ceil(xpNeeded / avgDailyXP);
      const target = new Date(today.getTime() + daysRemaining * 86_400_000);
      projectedDate = target.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } else if (xpNeeded === 0) {
      projectedDate = 'Already at max';
      daysRemaining = 0;
    }

    return {
      className: tree.name,
      level: tree.level,
      currentXP: tree.currentXP,
      xpNeeded,
      avgDailyXP,
      daysRemaining: isFinite(daysRemaining) ? daysRemaining : -1,
      projectedDate,
      isInactive,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sage Paladin Discipline Tracking
// Each daily entry's Grit Score is parsed for the key indulgence items.
// ─────────────────────────────────────────────────────────────────────────────

export interface DayDisciplineData {
  dateLabel: string;
  breaches: {
    alcohol: boolean;   // ❌ Abstained from undisciplined alcohol
    lust:    boolean;   // ❌ Abstained from undisciplined sexual
    diet:    boolean;   // ❌ Dr. Alfred Diet Plan (overall)
    sweets:  boolean;   // diet fail + sweets keyword in description
    redMeat: boolean;   // diet fail + red meat keyword in description
    other:   boolean;   // diet fail with no specific keyword matched
  };
  indulgenceCount: number; // count of (alcohol + lust + diet) breaches
}

export interface DisciplineSummary {
  entries:           DayDisciplineData[];
  alcoholPassRate:   number;   // 0-100 %
  lustPassRate:      number;
  dietPassRate:      number;
  sweetsBreachCount: number;
  redMeatBreachCount: number;
  otherBreachCount:  number;
  disciplineScore:   number;   // weighted composite 0-100
  alcoholStreak:     number;   // consecutive clean days (most recent)
  lustStreak:        number;
  dietStreak:        number;
  mixingEvents:      number;   // days with 2+ main breaches
}

// Handles:
//   ✅/❌ Abstained from undisciplined alcohol   (standard)
//   ✅/❌ Abstained from alcohol                  (short form — some Feb entries)
//   [ ] / [x] Abstained from alcohol             (checkbox format — treat as unlogged)
const ALCOHOL_DISC_RE  = /^- ([✅❌]|\[[ x]\]) Abstained from (?:undisciplined )?alcohol/m;
const LUST_DISC_RE     = /^- ([✅❌]|\[[ x]\]) Abstained from (?:undisciplined )?sexual/m;
const DIET_DISC_RE     = /^- ([✅❌]|\[[ x]\]) Dr\.?\s*Alfred Diet Plan(.*)/m;
const SWEETS_DISC_RE   = /biscotti|dessert|candy|sweet|chocolate|cookie|cake|soda|junk food|donut|brownie|muffin/i;
const RED_MEAT_DISC_RE = /\bred meat\b|birria|brisket|pastrami|sausage|pepperoni|\bbeef\b|\bsteak\b|\bburger\b|\bribs\b/i;

function parseBreachesFromBlock(block: string): DayDisciplineData['breaches'] {
  const gritIdx = block.indexOf('**Grit Score:**');
  const section = gritIdx >= 0 ? block.slice(gritIdx) : block;

  const aM = ALCOHOL_DISC_RE.exec(section);
  const lM = LUST_DISC_RE.exec(section);
  const dM = DIET_DISC_RE.exec(section);

  // '[ ]' or '[x]' → unlogged day → treat as neither pass nor fail (false = no breach)
  const isUnlogged = (marker: string) => marker === '[ ]' || marker === '[x]';

  const alcohol = aM ? (isUnlogged(aM[1]) ? false : aM[1] === '❌') : false;
  const lust    = lM ? (isUnlogged(lM[1]) ? false : lM[1] === '❌') : false;
  const diet    = dM ? (isUnlogged(dM[1]) ? false : dM[1] === '❌') : false;

  let sweets = false;
  let redMeat = false;
  let other = false;

  if (diet && dM) {
    const detail = dM[2] ?? '';
    sweets  = SWEETS_DISC_RE.test(detail);
    redMeat = RED_MEAT_DISC_RE.test(detail);
    other   = !sweets && !redMeat; // diet fail with no specific keyword
  }

  return { alcohol, lust, diet, sweets, redMeat, other };
}

// ─────────────────────────────────────────────────────────────────────────────
// System Health Alerts
// Detect class monoculture and dark-day patterns from recent parsed entries.
// entries[] is assumed REVERSE chronological (most recent first).
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'warning' | 'critical';

export interface SystemAlert {
  type: 'class-monoculture' | 'class-dark';
  severity: AlertSeverity;
  message: string;
  affectedClass: string;
  detail: string;
}

/** Returns active system health alerts based on last 28+ days of entries. */
export function parseSystemAlerts(entries: DailyEntryData[]): SystemAlert[] {
  const alerts: SystemAlert[] = [];
  if (entries.length === 0) return alerts;

  // Guard: only fire alerts for known class names — prevents spec/placeholder text leaking through
  const VALID_CLASSES = new Set(CLASS_NAMES);

  const MONOCULTURE_THRESHOLD = 0.60; // single class earning ≥60% of weekly XP
  const MONOCULTURE_WEEKS     = 4;    // alert fires after this many consecutive dominant weeks
  const DARK_WARNING_DAYS     = 14;   // warning threshold
  const DARK_CRITICAL_DAYS    = 21;   // critical threshold

  // ── 1. Class monoculture (rolling 7-day buckets, oldest-to-newest order) ──
  const weekBuckets: DailyEntryData[][] = [];
  // entries[0] = most recent; bucket them 7 at a time
  for (let i = 0; i < entries.length; i += 7) {
    weekBuckets.push(entries.slice(i, i + 7));
  }

  const allClasses = new Set<string>();
  entries.forEach(e => Object.keys(e.classXP).forEach(c => allClasses.add(c)));

  allClasses.forEach(cls => {
    // Skip if class name isn't a real known class (prevents spec placeholder text from firing)
    if (!VALID_CLASSES.has(cls)) return;
    let consecutiveDominant = 0;
    let totalPct = 0;
    for (const week of weekBuckets) {
      const weekTotal = week.reduce((s, e) => s + e.totalXP, 0);
      if (weekTotal === 0) continue;
      const clsXP = week.reduce((s, e) => s + (e.classXP[cls] ?? 0), 0);
      if (clsXP / weekTotal >= MONOCULTURE_THRESHOLD) {
        consecutiveDominant++;
        totalPct += clsXP / weekTotal;
      } else {
        break; // must be consecutive starting from most recent
      }
    }
    if (consecutiveDominant >= MONOCULTURE_WEEKS) {
      const avgPct = Math.round((totalPct / consecutiveDominant) * 100);
      alerts.push({
        type: 'class-monoculture',
        severity: 'warning',
        affectedClass: cls,
        message: `⚠️ CLASS BALANCE ALERT: ${cls} dominant for ${consecutiveDominant} consecutive weeks (avg ${avgPct}% of XP). Run Class Diversity Audit?`,
        detail: `Secondary classes (RedTeam/Artist/FinStrat) are being crowded out. Target: no class >60% of weekly XP.`,
      });
    }
  });

  // ── 2. Dark classes: secondary classes inactive too long ────────────────
  const SECONDARY_CLASSES = ['Redteamer', 'Artist', 'Financial Strategist'];
  SECONDARY_CLASSES.forEach(cls => {
    const lastActiveIdx = entries.findIndex(e => (e.classXP[cls] ?? 0) > 0);
    const daysSince = lastActiveIdx === -1 ? entries.length : lastActiveIdx;
    if (daysSince >= DARK_WARNING_DAYS) {
      const severity: AlertSeverity = daysSince >= DARK_CRITICAL_DAYS ? 'critical' : 'warning';
      const icon = severity === 'critical' ? '🔴' : '⚠️';
      alerts.push({
        type: 'class-dark',
        severity,
        affectedClass: cls,
        message: `${icon} DARK CLASS: ${cls} inactive for ~${daysSince} days. Rust threshold: 14 days.`,
        detail: `Schedule at least 1 session this week to prevent level rust decay.`,
      });
    }
  });

  return alerts;
}

/** Parse up to maxEntries daily blocks for discipline breach data. */
export function parseDisciplineData(content: string, maxEntries = 30): DisciplineSummary {
  const headerGlobalRe = /^### (\w{3} \d{1,2}) (?:→|->) /gm;  // handles both Unicode → and ASCII -> formats
  const headers: Array<{ index: number; label: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerGlobalRe.exec(content)) !== null) {
    headers.push({ index: m.index, label: m[1] });
  }

  const entries: DayDisciplineData[] = [];
  const limit = Math.min(headers.length, maxEntries);

  for (let i = 0; i < limit; i++) {
    const start = headers[i].index;
    const end   = i + 1 < headers.length ? headers[i + 1].index : content.length;
    const block = content.slice(start, end);

    const breaches = parseBreachesFromBlock(block);
    const indulgenceCount = [breaches.alcohol, breaches.lust, breaches.diet].filter(Boolean).length;
    entries.push({ dateLabel: headers[i].label, breaches, indulgenceCount });
  }

  const n = entries.length || 1;
  const alcoholBreaches    = entries.filter(e => e.breaches.alcohol).length;
  const lustBreaches       = entries.filter(e => e.breaches.lust).length;
  const dietBreaches       = entries.filter(e => e.breaches.diet).length;
  const sweetsBreachCount  = entries.filter(e => e.breaches.sweets).length;
  const redMeatBreachCount = entries.filter(e => e.breaches.redMeat).length;
  const otherBreachCount   = entries.filter(e => e.breaches.other).length;
  const mixingEvents       = entries.filter(e => e.indulgenceCount >= 2).length;

  const alcoholPassRate = Math.round((1 - alcoholBreaches / n) * 100);
  const lustPassRate    = Math.round((1 - lustBreaches / n) * 100);
  const dietPassRate    = Math.round((1 - dietBreaches / n) * 100);

  // Weighted composite: alcohol 35% + lust 30% + diet 35%
  const disciplineScore = Math.round(
    alcoholPassRate * 0.35 + lustPassRate * 0.30 + dietPassRate * 0.35
  );

  function streak(key: keyof DayDisciplineData['breaches']): number {
    let s = 0;
    for (const e of entries) { if (!e.breaches[key]) s++; else break; }
    return s;
  }

  return {
    entries,
    alcoholPassRate,
    lustPassRate,
    dietPassRate,
    sweetsBreachCount,
    redMeatBreachCount,
    otherBreachCount,
    disciplineScore,
    alcoholStreak: streak('alcohol'),
    lustStreak:    streak('lust'),
    dietStreak:    streak('diet'),
    mixingEvents,
  };
}
