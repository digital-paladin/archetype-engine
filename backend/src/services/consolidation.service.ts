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
import { syncSleepDebtFromJournal } from './sleepDebt.service';
import {
  consolidationUserIds,
  DEFAULT_CONSOLIDATION_STREAK_DAYS,
  previousUtcDate,
  xpHistoryCoversDate,
} from './consolidationSchedule';

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
  skippedXp:         boolean;
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

    const { data: existingHist, error: histErr } = await supabase
      .from('xp_history')
      .select('earned_at')
      .eq('user_id', userId)
      .eq('earned_at', date)
      .limit(1);
    if (histErr) throw new Error(`xp_history lookup: ${histErr.message}`);
    const skippedXp = xpHistoryCoversDate(
      (existingHist ?? []).map(r => String(r.earned_at)),
      date,
    );

    const classResults: ConsolidationClassResult[] = [];

    if (skippedXp) {
      console.log(`[CONSOLIDATION] ${date} already in xp_history — skip bonus XP`);
    } else {
    // 5. Load current character_stats to apply bonus XP correctly
    const allStats = await db.getCharacterStats(userId);

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
    } // end skip-XP else

    // 8. Sleep debt: 14-day rolling deficit sum from journal nights. Do not default missing hours to 7.5.
    const debtSync = await syncSleepDebtFromJournal(userId, db);
    await db.upsertCharacterProfile(userId, { sage_streak: streakDays });
    console.log(
      `[CONSOLIDATION] character_profile updated — vitality: ${debtSync?.vitality ?? 'n/a'}, ` +
      `sleepDebt: ${debtSync?.sleepDebt ?? 'n/a'}, trend: ${debtSync?.sleepTrend ?? 'n/a'}`,
    );

    return {
      date,
      streakDays,
      streakTier:       tierName,
      fitbitScore,
      consolidationPct,
      aclBonus:         skippedXp ? 0 : aclBonus,
      classes:          classResults,
      totalPending:     classResults.reduce((s, r) => s + r.pendingXP,   0),
      totalConfirmed:   classResults.reduce((s, r) => s + r.confirmedXP, 0),
      skippedXp,
    };
  }

  /**
   * Nightly job: consolidate the UTC date that just ended for every player
   * (character_profile ∪ character_stats ∪ OWNER, minus DEMO).
   */
  async runDailyUtc(now = new Date()): Promise<{
    date: string;
    users: number;
    ok: number;
    skippedXp: number;
    failed: number;
  }> {
    const date = previousUtcDate(now);
    const supabase = getSupabaseAdmin();
    const db = getDataService();

    const [{ data: profiles, error: pErr }, { data: stats, error: sErr }] = await Promise.all([
      supabase.from('character_profile').select('user_id'),
      supabase.from('character_stats').select('user_id'),
    ]);
    if (pErr) throw new Error(`character_profile list: ${pErr.message}`);
    if (sErr) throw new Error(`character_stats list: ${sErr.message}`);

    const userIds = consolidationUserIds(
      (profiles ?? []).map(r => r.user_id as string),
      (stats ?? []).map(r => r.user_id as string),
      {
        ownerUserId: process.env.OWNER_USER_ID?.trim(),
        demoUserId: process.env.DEMO_USER_ID?.trim(),
      },
    );

    let ok = 0;
    let skippedXp = 0;
    let failed = 0;
    for (const userId of userIds) {
      try {
        const profile = await db.getCharacterProfile(userId).catch(() => null);
        const streakDays = Number(profile?.sage_streak) > 0
          ? Number(profile?.sage_streak)
          : DEFAULT_CONSOLIDATION_STREAK_DAYS;
        const result = await this.runForUser(userId, date, streakDays);
        ok += 1;
        if (result.skippedXp) skippedXp += 1;
        console.log(
          `[CONSOLIDATION] cron ${date} user=${userId.slice(0, 8)}… ` +
          `pending=${result.totalPending} confirmed=${result.totalConfirmed}` +
          (result.skippedXp ? ' (xp skipped)' : ''),
        );
      } catch (err) {
        failed += 1;
        console.error(
          `[CONSOLIDATION] cron ${date} user=${userId.slice(0, 8)}… failed: ` +
          `${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return { date, users: userIds.length, ok, skippedXp, failed };
  }
}
