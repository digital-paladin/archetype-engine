import { Injectable } from '@angular/core';

/**
 * XP Calculation Service
 * Implements Archetype Engine character-sheet.md XP formulas
 * Base Formula: Pending XP = (hours × base_rate × intensity_multiplier) + bonuses
 */

export interface ActivityType {
  name: string;
  baseRate: number; // XP per hour
  category: 'developer' | 'redteamer' | 'warrior' | 'sage' | 'artist' | 'survivalist' | 'financial';
}

export interface IntensityTier {
  name: string;
  multiplier: number;
  description: string;
  weeklyPercentage: number; // Expected % per Pareto principle
}

export interface XPBonus {
  name: string;
  xp: number;
  category?: string;
}

export interface XPCalculation {
  hours: number;
  baseRate: number;
  intensityMultiplier: number;
  baseXP: number; // hours × base_rate × intensity
  bonuses: XPBonus[];
  totalBonusXP: number;
  pendingXP: number; // base + bonuses
  category: string;
}

@Injectable({
  providedIn: 'root'
})
export class XpCalculationService {
  
  // Activity base rates (XP per hour)
  private readonly activityRates: { [key: string]: ActivityType } = {
    // Developer
    'coding-routine': { name: 'Routine Coding', baseRate: 10, category: 'developer' },
    'coding-complex': { name: 'Complex Debugging', baseRate: 15, category: 'developer' },
    'coding-architecture': { name: 'Architecture Design', baseRate: 20, category: 'developer' },
    'code-review-doing': { name: 'Code Review (Doing)', baseRate: 5, category: 'developer' },
    'code-review-addressing': { name: 'Code Review (Addressing)', baseRate: 10, category: 'developer' },
    'meetings-active': { name: 'Meetings (Active)', baseRate: 5, category: 'developer' },
    'meetings-passive': { name: 'Meetings (Passive)', baseRate: 3, category: 'developer' },
    'learning-tech': { name: 'Learning New Tech', baseRate: 12, category: 'developer' },
    
    // Redteamer
    'htb-easy': { name: 'HTB Easy Box', baseRate: 10, category: 'redteamer' },
    'htb-medium': { name: 'HTB Medium Box', baseRate: 15, category: 'redteamer' },
    'htb-hard': { name: 'HTB Hard Box', baseRate: 20, category: 'redteamer' },
    'ctf-practice': { name: 'CTF Practice', baseRate: 12, category: 'redteamer' },
    'ctf-live': { name: 'CTF Live Competition', baseRate: 15, category: 'redteamer' },
    'portswigger-labs': { name: 'PortSwigger Labs', baseRate: 10, category: 'redteamer' },
    'exploit-dev': { name: 'Exploit Development', baseRate: 18, category: 'redteamer' },
    
    // Warrior
    'workout-strength': { name: 'Strength Training', baseRate: 15, category: 'warrior' },
    'workout-cardio': { name: 'Cardio', baseRate: 10, category: 'warrior' },
    'mma-class': { name: 'MMA Class', baseRate: 20, category: 'warrior' },
    'swimming': { name: 'Swimming', baseRate: 12, category: 'warrior' },
    'sparring': { name: 'Sparring', baseRate: 25, category: 'warrior' },
    
    // Sage
    'prayer': { name: 'Prayer/Meditation', baseRate: 5, category: 'sage' },
    'bible-study': { name: 'Bible Study', baseRate: 8, category: 'sage' },
    'sermon': { name: 'Sermon/Teaching', baseRate: 10, category: 'sage' },
    'spiritual-warfare': { name: 'Spiritual Warfare', baseRate: 12, category: 'sage' },
    
    // Artist
    'music-practice': { name: 'Music Practice', baseRate: 10, category: 'artist' },
    'songwriting': { name: 'Songwriting', baseRate: 12, category: 'artist' },
    'production': { name: 'Music Production', baseRate: 15, category: 'artist' },
    'performance': { name: 'Performance', baseRate: 20, category: 'artist' },
    
    // Survivalist (Phase-locked)
    'survival-training': { name: 'Survival Training', baseRate: 15, category: 'survivalist' },
    
    // Financial Strategist (Phase-locked)
    'trading-backtest': { name: 'Strategy Backtesting', baseRate: 12, category: 'financial' },
    'trading-live': { name: 'Live Trading', baseRate: 15, category: 'financial' }
  };
  
  // Intensity tiers (Pareto Principle: 70/20/10)
  private readonly intensityTiers: { [key: string]: IntensityTier } = {
    'routine': {
      name: 'Routine',
      multiplier: 1.0,
      description: 'Standard work, maintenance, bug fixes',
      weeklyPercentage: 70
    },
    'moderate': {
      name: 'Moderate',
      multiplier: 1.35, // Average of 1.2-1.5 range
      description: 'Learning, debugging, moderate challenges',
      weeklyPercentage: 20
    },
    'complex': {
      name: 'Complex',
      multiplier: 1.75, // Average of 1.5-2.0 range
      description: 'Architecture, hard problems, breakthroughs',
      weeklyPercentage: 10
    }
  };
  
  // Common bonuses
  private readonly commonBonuses: { [key: string]: XPBonus } = {
    'clean-sonarqube': { name: 'Clean SonarQube', xp: 2, category: 'developer' },
    'tests-written': { name: 'Tests Written', xp: 3, category: 'developer' },
    'great-review': { name: 'Great Code Review Feedback', xp: 5, category: 'developer' },
    'mentoring': { name: 'Mentoring Teammate', xp: 8, category: 'developer' },
    'production-deploy': { name: 'Production Deployment', xp: 10, category: 'developer' },
    'htb-root': { name: 'HTB Root Obtained', xp: 25, category: 'redteamer' },
    'ctf-first-blood': { name: 'CTF First Blood', xp: 50, category: 'redteamer' },
    'pr-streak-7': { name: 'Personal Record (7-day streak)', xp: 20, category: 'warrior' },
    'pr-weight': { name: 'Personal Record (Weight)', xp: 15, category: 'warrior' },
    'pr-distance': { name: 'Personal Record (Distance)', xp: 10, category: 'warrior' },
    'daily-prayer': { name: 'Daily Prayer Streak', xp: 2, category: 'sage' },
    'scripture-memory': { name: 'Scripture Memorized', xp: 10, category: 'sage' },
    'song-completed': { name: 'Song Completed', xp: 25, category: 'artist' },
    'performance-success': { name: 'Successful Performance', xp: 50, category: 'artist' }
  };
  
  constructor() {}
  
  /**
   * Calculate pending XP for an activity session
   * @param activityKey - Key from activityRates
   * @param hours - Duration in hours (e.g., 2.5 for 2h 30min)
   * @param intensityKey - Key from intensityTiers (routine/moderate/complex)
   * @param bonusKeys - Array of bonus keys from commonBonuses
   * @returns XPCalculation with breakdown
   */
  calculatePendingXP(
    activityKey: string,
    hours: number,
    intensityKey: string = 'routine',
    bonusKeys: string[] = []
  ): XPCalculation {
    const activity = this.activityRates[activityKey];
    if (!activity) {
      throw new Error(`Unknown activity: ${activityKey}`);
    }
    
    const intensity = this.intensityTiers[intensityKey];
    if (!intensity) {
      throw new Error(`Unknown intensity: ${intensityKey}`);
    }
    
    // Base XP = hours × base_rate × intensity_multiplier
    const baseXP = hours * activity.baseRate * intensity.multiplier;
    
    // Collect bonuses
    const bonuses: XPBonus[] = [];
    bonusKeys.forEach(key => {
      const bonus = this.commonBonuses[key];
      if (bonus) {
        bonuses.push(bonus);
      }
    });
    
    const totalBonusXP = bonuses.reduce((sum, bonus) => sum + bonus.xp, 0);
    const pendingXP = baseXP + totalBonusXP;
    
    return {
      hours,
      baseRate: activity.baseRate,
      intensityMultiplier: intensity.multiplier,
      baseXP: Math.round(baseXP * 100) / 100, // Round to 2 decimals
      bonuses,
      totalBonusXP,
      pendingXP: Math.round(pendingXP * 100) / 100,
      category: activity.category
    };
  }
  
  /**
   * Get all available activities grouped by category
   */
  getActivitiesByCategory(): { [category: string]: ActivityType[] } {
    const grouped: { [category: string]: ActivityType[] } = {};
    
    Object.values(this.activityRates).forEach(activity => {
      if (!grouped[activity.category]) {
        grouped[activity.category] = [];
      }
      grouped[activity.category].push(activity);
    });
    
    return grouped;
  }
  
  /**
   * Get intensity tier options
   */
  getIntensityTiers(): IntensityTier[] {
    return Object.values(this.intensityTiers);
  }
  
  /**
   * Get common bonuses by category
   */
  getBonusesByCategory(category?: string): XPBonus[] {
    const bonuses = Object.values(this.commonBonuses);
    if (!category) return bonuses;
    return bonuses.filter(b => b.category === category);
  }
  
  /**
   * Validate weekly intensity distribution (Pareto 70/20/10 audit)
   * @param weeklyActivities - Array of intensity keys from past week
   * @returns Audit result with recommendations
   */
  auditWeeklyIntensity(weeklyActivities: string[]): {
    routine: number;
    moderate: number;
    complex: number;
    routinePercent: number;
    moderatePercent: number;
    complexPercent: number;
    isInflated: boolean;
    recommendation: string;
  } {
    const total = weeklyActivities.length;
    if (total === 0) {
      return {
        routine: 0,
        moderate: 0,
        complex: 0,
        routinePercent: 0,
        moderatePercent: 0,
        complexPercent: 0,
        isInflated: false,
        recommendation: 'No activities logged this week'
      };
    }
    
    const counts = {
      routine: weeklyActivities.filter(i => i === 'routine').length,
      moderate: weeklyActivities.filter(i => i === 'moderate').length,
      complex: weeklyActivities.filter(i => i === 'complex').length
    };
    
    const percents = {
      routinePercent: Math.round((counts.routine / total) * 100),
      moderatePercent: Math.round((counts.moderate / total) * 100),
      complexPercent: Math.round((counts.complex / total) * 100)
    };
    
    // Flag if >50% logged as "Complex" (intensity inflation)
    const isInflated = percents.complexPercent > 50;
    
    let recommendation = '';
    if (isInflated) {
      recommendation = '⚠️ Intensity inflation detected (>50% complex). Aim for 70% routine, 20% moderate, 10% complex.';
    } else if (percents.complexPercent > 30) {
      recommendation = '⚠️ High complex percentage. Review classifications - are all truly breakthrough work?';
    } else {
      recommendation = '✅ Intensity distribution looks realistic.';
    }
    
    return {
      ...counts,
      ...percents,
      isInflated,
      recommendation
    };
  }
  
  /**
   * Calculate story point difficulty multiplier for Developer activities
   * Activates Month 2+ (Dec 17, 2025+)
   */
  getStoryPointMultiplier(storyPoints: number): {
    multiplier: number;
    bonusXP: number;
    bonusName: string | null;
  } {
    if (storyPoints === 1) {
      return { multiplier: 0.8, bonusXP: 0, bonusName: null };
    } else if (storyPoints >= 2 && storyPoints <= 3) {
      return { multiplier: 1.0, bonusXP: 0, bonusName: null };
    } else if (storyPoints === 5) {
      return { multiplier: 1.3, bonusXP: 0, bonusName: null };
    } else if (storyPoints === 8) {
      return { multiplier: 1.6, bonusXP: 0, bonusName: null };
    } else if (storyPoints >= 13) {
      return { multiplier: 2.0, bonusXP: 50, bonusName: 'Dragon Slayer' };
    }
    
    return { multiplier: 1.0, bonusXP: 0, bonusName: null };
  }
}
