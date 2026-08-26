import { CharacterStats, XPHistoryEntry } from './data/IDataService';
import { parseSystemAlerts } from '../parser/analyticsParser';

/** Matches xpThresholdForLevel in character.routes.ts */
export function xpThresholdForLevel(level: number): number {
  return Math.max(100, Math.round(836 * level));
}

export function earnedAtDay(earnedAt: string | Date | number): string {
  return String(earnedAt).slice(0, 10);
}

export function buildAnalyticsFromDb(
  history: XPHistoryEntry[],
  stats: CharacterStats[],
  maxEntries: number,
) {
  const dayMap = new Map<string, Record<string, number>>();
  for (const entry of history) {
    const day = earnedAtDay(entry.earned_at);
    if (!dayMap.has(day)) dayMap.set(day, {});
    const cm = dayMap.get(day)!;
    cm[entry.class_name] = (cm[entry.class_name] ?? 0) + (entry.xp_confirmed ?? 0);
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

  const classMap: Record<string, { totalXP: number; days: Set<string> }> = {};
  for (const entry of history) {
    const cls = entry.class_name;
    const day = earnedAtDay(entry.earned_at);
    if (!classMap[cls]) classMap[cls] = { totalXP: 0, days: new Set() };
    classMap[cls].totalXP += entry.xp_confirmed ?? 0;
    classMap[cls].days.add(day);
  }
  const projections: Record<string, {
    totalXP: number;
    daysTracked: number;
    avgDailyXP: number;
    avgWeeklyXP: number;
    projected6mo: number;
    projected12mo: number;
  }> = {};
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

  return {
    recentEntries,
    timeToLevel,
    projections,
    systemAlerts: parseSystemAlerts(recentEntries),
  };
}
