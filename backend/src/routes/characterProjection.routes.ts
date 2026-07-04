
// characterProjection.routes.ts
// Route to serve XP projection analytics

import { Router, Request, Response } from 'express';
import * as path from 'path';
import { XPProjectionService, XPProjection } from '../services/xpProjection.service';
import { getSupabaseAdmin } from '../lib/supabase';
import { getDataService } from '../services/data/dataService';

const router = Router();

// Adjust this path as needed for your deployment
export const CHARACTER_SHEET_PATH = process.env.CHARACTER_FILE_PATH || path.resolve(__dirname, '../../character-progression/character-sheet.md');

// Endpoint: /api/vitality-status - returns current vitality, status, sleep debt, trend, and flag
router.get('/vitality-status', async (req: Request, res: Response) => {
  try {
    // DB-first: character_profile (populated by POST /api/consolidation/run)
    const userId = (req as any).userId as string | undefined;
    if (userId) {
      const db = getDataService();
      const profile = await db.getCharacterProfile(userId).catch(() => null);
      if (profile?.sleep_debt !== undefined) {
        const sleepDebt = profile.sleep_debt as number;
        const vitality  = (profile.vitality as number) ??
          (sleepDebt > 5 ? Math.round(Math.max(0, 100 - (sleepDebt - 5) * 3) * 10) / 10 : 100);
        const status = vitality >= 80 ? 'Peak Condition ✅'
          : vitality >= 60 ? 'Normal ✅'
          : vitality >= 30 ? 'Fatigued ⚠️'
          : 'Exhausted 🔴';
        console.log(`[VITALITY] DB — vitality: ${vitality}, sleepDebt: ${sleepDebt}, trend: ${profile.sleep_trend}`);
        return res.json({
          current:   vitality,
          status,
          sleepDebt,
          trend:     profile.sleep_trend ?? 'Stable',
          flag:      '',
        });
      }
    }
    // File fallback (CHARACTER_FILE_PATH still available)
    console.log(`[VITALITY] Reading from: ${CHARACTER_SHEET_PATH}`);
    const content = require('fs').readFileSync(CHARACTER_SHEET_PATH, 'utf-8');
    console.log(`[VITALITY] File loaded: ${content.length} chars`);
    // Extract Vitality Pool (Current), Status, Sleep Debt, Trend, and any status flag
    // Example lines:
    // **Current:** 78.3/100
    // **Status:** Normal ✅
    // **Sleep Debt:** 12.23 hrs
    // **Trend:** Decreased ⬇️ (-1.5 from yesterday, hard cap active)
    // **Flag:** Fatigued, Peak Condition, etc. (optional)
    const vitalityMatch = content.match(/\*\*Current:\*\*\s*([\d.]+)\/100/);
    const statusMatch = content.match(/\*\*Status:\*\*\s*([\w ]+)/);
    let sleepDebtMatch = content.match(/\*\*Sleep Debt:\*\*\s*([\d.]+)\s*hrs/);
    let sleepDebtVal: number | null = null;
    
    const recentIndex = content.indexOf('## 📈 RECENT HISTORY');
    if (recentIndex !== -1) {
      const recentContent = content.substring(recentIndex);
      // Because it's reverse chronological, the FIRST match inside RECENT HISTORY is the most current!
      const recentMatch = recentContent.match(/(?:\*\*Sleep [Dd]ebt:\*\*|Sleep [Dd]ebt:)\s*(?:~?[\d.]+\s*(?:hrs)?\s*→\s*\*\*)?~?([\d.]+)\s*(?:hrs)?/i);
      if (recentMatch) {
        sleepDebtVal = parseFloat(recentMatch[1]);
      }
    }
    
    // Fallback to top-level if not found in recent history
    if (sleepDebtVal === null && sleepDebtMatch) {
      sleepDebtVal = parseFloat(sleepDebtMatch[1]);
    }
    
    const sleepDebt = sleepDebtVal !== null ? sleepDebtVal : 0;
    // Extract trend from the active Sleep Debt Counter section only (not docs)
    const debtCounterIdx = content.indexOf('### Sleep Debt Counter');
    console.log(`[VITALITY] '### Sleep Debt Counter' found at index: ${debtCounterIdx}`);
    const activeSection = debtCounterIdx !== -1 ? content.substring(debtCounterIdx, debtCounterIdx + 2000) : content;
    const trendMatch = activeSection.match(/\*\*Trend:\*\*\s*([^\n]+)/);
    // Look for a real status flag ONLY in the active Sleep Debt Counter section.
    // The docs section (lines ~1300-1350) also has **Flag:** template examples like
    // "Debt stuck at [X] hrs" — guard against those by checking for placeholder tokens.
    let flag = '';
    const flagMatch = activeSection.match(/\*\*Flag:\*\*\s*([^\n]+)/);
    if (flagMatch) {
      const rawFlag = flagMatch[1].trim();
      console.log(`[VITALITY] rawFlag: ${rawFlag.substring(0, 80)}`);
      // Suppress template placeholders — real flags have concrete values, not [X]/[rate]/[Tree]
      if (!rawFlag.includes('[X]') && !rawFlag.includes('[rate]') && !rawFlag.includes('[Tree')) {
        flag = rawFlag;
        console.log('[VITALITY] flag accepted');
      } else {
        console.log('[VITALITY] flag suppressed (contains placeholder token)');
      }
    } else {
      console.log('[VITALITY] no **Flag:** line found in active section');
    }
    // Fallback: If no explicit flag, check for status keywords in Status
    let status = statusMatch ? statusMatch[1].trim() : '';
    if (!flag && status && /Peak Condition|Fatigued|Exhausted|Burnout/i.test(status)) flag = status;
    // Dynamically calculate vitality from sleep debt using the formula:
    // debt > 5 hrs: min(100, 100 - (debt - 5) * 3)  |  debt <= 5 hrs: 100
    const calculatedVitality = sleepDebt > 5
      ? Math.round(Math.min(100, 100 - (sleepDebt - 5) * 3) * 10) / 10
      : 100;
    res.json({
      current: calculatedVitality,
      status: status,
      sleepDebt: sleepDebt,
      trend: trendMatch ? trendMatch[1].trim() : '',
      flag
    });
  } catch (err) {
    // File read failed — fall back to the most recent Fitbit score from Supabase.
    try {
      const userId = (req as any).userId as string;
      if (userId) {
        const { data } = await getSupabaseAdmin()
          .from('daily_journal_entries')
          .select('fitbit_score')
          .eq('user_id', userId)
          .not('fitbit_score', 'is', null)
          .order('entry_date', { ascending: false })
          .limit(1)
          .single();
        if (data?.fitbit_score !== null && data?.fitbit_score !== undefined) {
          const score = data.fitbit_score as number;
          const status = score >= 80 ? 'Peak Condition' : score >= 60 ? 'Normal' : 'Fatigued';
          return res.json({ current: score, status, sleepDebt: null, trend: '', flag: '' });
        }
      }
    } catch (_inner) { /* ignore */ }
    res.status(500).json({ error: 'Failed to parse vitality status', details: err instanceof Error ? err.message : err });
  }
});


router.get('/xp-projection', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    if (userId) {
      const db = getDataService();
      const history = await db.getXPHistory(userId).catch(() => []);
      if (history.length > 0) {
        const classMap: Record<string, { totalXP: number; days: Set<string> }> = {};
        for (const entry of history) {
          const cls  = entry.class_name;
          const day  = entry.earned_at.slice(0, 10);
          if (!classMap[cls]) classMap[cls] = { totalXP: 0, days: new Set() };
          classMap[cls].totalXP += entry.xp_confirmed;
          classMap[cls].days.add(day);
        }
        const projections: XPProjection = {};
        for (const [cls, data] of Object.entries(classMap)) {
          const daysTracked  = Math.max(1, data.days.size);
          const avgDailyXP   = data.totalXP / daysTracked;
          projections[cls]   = {
            totalXP:      data.totalXP,
            daysTracked,
            avgDailyXP:   Number(avgDailyXP.toFixed(2)),
            avgWeeklyXP:  Number((avgDailyXP * 7).toFixed(2)),
            projected6mo: Math.round(avgDailyXP * 182.5),
            projected12mo: Math.round(avgDailyXP * 365),
          };
        }
        console.log(`[PROJECTION /xp-projection] DB — ${Object.keys(projections).length} classes`);
        return res.json(projections);
      }
    }
    // Fallback: file
    const projections = XPProjectionService.parseXPProjections(CHARACTER_SHEET_PATH);
    res.json(projections);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute XP projections', details: err instanceof Error ? err.message : err });
  }
});

// New endpoint: /api/xp-gains - returns recent XP changes
router.get('/xp-gains', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    if (userId) {
      const db      = getDataService();
      const history = await db.getXPHistory(userId, 100).catch(() => []);
      if (history.length > 0) {
        const gains = history
          .map(e => ({
            className: e.class_name,
            amount:    e.xp_confirmed,
            date:      e.earned_at.slice(0, 10),
          }))
          .sort((a, b) => b.date.localeCompare(a.date));
        console.log(`[PROJECTION /xp-gains] DB — ${gains.length} entries`);
        return res.json(gains);
      }
    }
    // Fallback: parse file
    const content = require('fs').readFileSync(CHARACTER_SHEET_PATH, 'utf-8');
    const gainRegex = /- (\w+): [^*]+→ \*\*(\d+) XP\*\*.*?\(date: (\d{4}-\d{2}-\d{2})\)/g;
    const gains = [];
    let match;
    while ((match = gainRegex.exec(content)) !== null) {
      gains.push({ className: match[1], amount: parseInt(match[2], 10), date: match[3] });
    }
    gains.sort((a, b) => b.date.localeCompare(a.date));
    res.json(gains);
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse XP gains', details: err instanceof Error ? err.message : err });
  }
});
// Endpoint: /api/quest-log - returns structured quest log (DB-first from journal_quest_activities)
router.get('/quest-log', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    if (userId) {
      const { data, error } = await getSupabaseAdmin()
        .from('journal_quest_activities')
        .select('class_name, field_label, content, entry_date')
        .eq('user_id', userId)
        .order('entry_date', { ascending: false })
        .limit(50);
      if (!error && data && data.length > 0) {
        // Group by class_name for the most recent entry date
        const latestDate = data[0].entry_date;
        const latestRows = data.filter((r: any) => r.entry_date === latestDate);
        const classMap: Record<string, string[]> = {};
        for (const row of latestRows) {
          const cls = row.class_name as string;
          if (!classMap[cls]) classMap[cls] = [];
          if (row.content && row.content !== '[To be logged]') {
            classMap[cls].push(row.content as string);
          }
        }
        const quests = Object.entries(classMap).map(([className, activities]) => ({ className, activities }));
        console.log(`[PROJECTION /quest-log] DB — ${quests.length} classes for ${latestDate}`);
        return res.json({ quests });
      }
    }
    // Fallback: parse file
    try {
      const content = require('fs').readFileSync(CHARACTER_SHEET_PATH, 'utf-8');
      const questSectionMatch = content.match(/\*\*Quest Activities:\*\*[\r\n]+([\s\S]+?)(?:\n\*\*|\n#|\n---|\n\s*\n|$)/);
      if (!questSectionMatch) return res.json({ quests: [] });
      const questSection = questSectionMatch[1];
      const questBlocks = questSection.split(/\*\*([\w .()/-]+):\*\*/g).slice(1);
      const quests = [];
      for (let i = 0; i < questBlocks.length; i += 2) {
        const className = questBlocks[i].trim();
        const details   = questBlocks[i + 1] ? questBlocks[i + 1].trim() : '';
        const activities = details.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
        quests.push({ className, activities });
      }
      return res.json({ quests });
    } catch {
      return res.json({ quests: [] });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse quest log', details: err instanceof Error ? err.message : err });
  }
});

export default router;
