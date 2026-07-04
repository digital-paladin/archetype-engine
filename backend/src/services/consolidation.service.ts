/**
 * ConsolidationService
 *
 * End-of-day sleep consolidation:
 *   confirmed_xp = pending_xp × consolidationMultiplier × fitbitModifier
 *
 * "Pending XP" is the raw XP earned from activities for the day (from Supabase activity_log).
 * "Confirmed XP" is what gets permanently banked (after sleep quality multiplier).
 * The bonus = confirmed − pending is applied on top of what activity.routes.ts already
 * credited to character_stats — so this adds ONLY the bonus delta.
 */

import { getDataService } from './data/dataService';
import { getSupabaseAdmin } from '../lib/supabase';
import { XpCalculatorService } from './xpCalculator.service';

export interface ConsolidationClassResult {
  className:   string;
  pendingXP:   number;   // raw XP from today's activities
  bonusXP:     number;   // extra XP from consolidation multiplier
  confirmedXP: number;   // pendingXP + bonusXP
  newLevel:    number;
  leveledUp:   boolean;
}

export interface ConsolidationResult {
  date:              string;
  streakDays:        number;
  streakTier:        string;
  fitbitScore:       number | null;
  consolidationPct:  number;
  aclBonus:          number;
  classes:           ConsolidationClassResult[];
  totalPending:      number;
  totalConfirmed:    number;
}

export class ConsolidationService {
  private readonly calc = new XpCalculatorService();

  /**
   * Run sleep consolidation for a user on a given date.
   *
   * @param userId     Supabase user UUID
   * @param date       ISO date string "YYYY-MM-DD" (defaults to today)
   * @param streakDays Consecutive active days (drives consolidation tier)
   */
  async runForUser(
    userId:     string,
    date:       string,
    streakDays: number,
  ): Promise<ConsolidationResult> {
    const db       = getDataService();
    const supabase = getSupabaseAdmin();

    // 1. Sum today's pending XP per class from activity_log
    const { data: actLogs, error: actErr } = await supabase
      .from('activity_log')
      .select('class_name, xp_awarded')
      .eq('user_id', userId)
      .gte('logged_at', `${date}T00:00:00Z`)
      .lte('logged_at', `${date}T23:59:59Z`);

    if (actErr) throw new Error(`activity_log query: ${actErr.message}`);

    const pendingMap: Record<string, number> = {};
    for (const row of (actLogs ?? [])) {
      const cls = row.class_name as string;
      pendingMap[cls] = (pendingMap[cls] ?? 0) + (row.xp_awarded as number);
    }

    // 2. Get fitbit_score from daily_journal_entries
    const journalEntry = await db.getJournalEntry(userId, date);
    const fitbitScore  = journalEntry?.fitbit_score ?? null;

    // 3. Get ACM checked-item count for the date
    const acmEntries      = await db.getACMEntries(userId, date);
    const checkedAclCount = acmEntries.filter(e => e.completed).length;
    const aclBonus        = this.calc.getAclBonus(checkedAclCount);

    // 4. Compute consolidation parameters
    const { tierName } = this.calc.calculateConfirmedXP(0, streakDays, fitbitScore);
    const consolidationPct = Math.round(
      this.calc.getConsolidationMultiplier(streakDays) *
      this.calc.getFitbitModifier(fitbitScore) * 100
    );

    // 5. Load current character_stats to apply bonus XP correctly
    const allStats = await db.getCharacterStats(userId);

    const classResults: ConsolidationClassResult[] = [];

    for (const [className, pendingXP] of Object.entries(pendingMap)) {
      const { bonusXP } = this.calc.calculateConfirmedXP(pendingXP, streakDays, fitbitScore);
      const confirmedXP = pendingXP + bonusXP;

      // Apply ONLY the bonus delta (activity.routes.ts already credited pendingXP)
      const current = allStats.find(s => s.class_name === className);
      const lvl     = current?.level     ?? 1;
      const currXP  = current?.current_xp ?? 0;
      const totalXP = current?.total_xp   ?? 0;

      const { newLevel, newCurrentXP, leveledUp } =
        this.calc.applyXPGain(lvl, currXP, bonusXP);

      await db.upsertCharacterStats(userId, {
        class_name: className,
        level:      newLevel,
        current_xp: newCurrentXP,
        total_xp:   totalXP + bonusXP,
      });

      // 6. Upsert xp_history row for the date
      await supabase.from('xp_history').upsert(
        {
          user_id:           userId,
          earned_at:         date,
          class_name:        className,
          xp_pending:        pendingXP,
          xp_confirmed:      confirmedXP,
          consolidation_pct: consolidationPct,
          fitbit_score:      fitbitScore,
          streak_days:       streakDays,
          notes:             `ACL bonus: +${aclBonus} (${checkedAclCount}/15 items)`,
        },
        { onConflict: 'user_id,earned_at,class_name' },
      );

      classResults.push({ className, pendingXP, bonusXP, confirmedXP, newLevel, leveledUp });
    }

    // 7. Distribute ACL bonus XP equally across all active classes (if any)
    if (aclBonus > 0 && classResults.length > 0) {
      const bonusPerClass = Math.round(aclBonus / classResults.length);
      for (const r of classResults) {
        const current = allStats.find(s => s.class_name === r.className);
        const lvl     = current?.level     ?? r.newLevel;
        const currXP  = current?.current_xp ?? 0;
        const totalXP = current?.total_xp   ?? 0;

        const { newLevel, newCurrentXP } =
          this.calc.applyXPGain(lvl, currXP, bonusPerClass);

        await db.upsertCharacterStats(userId, {
          class_name: r.className,
          level:      newLevel,
          current_xp: newCurrentXP,
          total_xp:   totalXP + bonusPerClass,
        });

        r.confirmedXP += bonusPerClass;
        r.bonusXP     += bonusPerClass;
        r.newLevel     = newLevel;
      }
    }

    // 8. Compute sleep_debt / vitality and persist to character_profile
    const prevProfile    = await db.getCharacterProfile(userId);
    const sleepHours     = journalEntry?.sleep_hours ?? 7.5;
    const fitbitQuality  = (fitbitScore ?? 90) / 100;
    let sleepDebt        = prevProfile?.sleep_debt ?? 0;
    if (sleepHours < 7.5) {
      sleepDebt += (7.5 - sleepHours);
    } else {
      const surplus  = sleepHours - 7.5;
      const tierMax  = sleepDebt > 10 ? 1.0 : sleepDebt > 5 ? 0.75 : 0.5;
      sleepDebt = Math.max(0, sleepDebt - Math.min(surplus * 0.5 * fitbitQuality, tierMax));
    }
    sleepDebt = Math.round(sleepDebt * 100) / 100;
    const vitality       = sleepDebt > 5
      ? Math.round(Math.max(0, 100 - (sleepDebt - 5) * 3) * 10) / 10
      : 100;
    const prevSleepDebt  = prevProfile?.sleep_debt ?? sleepDebt;
    const sleepTrend     = sleepDebt > prevSleepDebt + 0.05 ? 'Increased'
      : sleepDebt < prevSleepDebt - 0.05 ? 'Decreased' : 'Stable';

    await db.upsertCharacterProfile(userId, {
      vitality,
      sleep_debt:  sleepDebt,
      sleep_trend: sleepTrend,
      sage_streak: streakDays,
    });
    console.log(`[CONSOLIDATION] character_profile updated — vitality: ${vitality}, sleepDebt: ${sleepDebt}, trend: ${sleepTrend}`);

    return {
      date,
      streakDays,
      streakTier:       tierName,
      fitbitScore,
      consolidationPct,
      aclBonus,
      classes:          classResults,
      totalPending:     classResults.reduce((s, r) => s + r.pendingXP,   0),
      totalConfirmed:   classResults.reduce((s, r) => s + r.confirmedXP, 0),
    };
  }
}
