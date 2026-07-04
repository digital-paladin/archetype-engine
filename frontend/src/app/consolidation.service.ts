import { Injectable } from '@angular/core';

/**
 * Consolidation Service
 * Implements sleep-dependent XP confirmation system
 * Permanent XP = Pending XP × (base_consolidation_rate + nutrition_modifier + fasting_modifier)
 * Based on character-sheet.md consolidation formulas
 */

export interface SleepQuality {
  hours: number;
  fitbitScore?: number; // 0-100
  interruptions: 'none' | 'minimal' | 'some' | 'frequent';
  quality: 'excellent' | 'good' | 'fair' | 'poor';
}

export interface NutritionQuality {
  type: 'clean' | 'mixed' | 'poor';
  proteinGrams?: number;
  description: string;
}

export interface FastingStatus {
  lastMealTime: Date;
  bedtime: Date;
  hoursSinceLastMeal: number;
  isFasted: boolean; // 3+ hours
}

export interface ConsolidationResult {
  pendingXP: number;
  baseSleepRate: number; // 0.30-0.95 (30%-95%)
  nutritionModifier: number; // -0.05 to +0.05
  fastingModifier: number; // -0.05 to +0.05
  totalConsolidationRate: number; // Combined rate
  permanentXP: number;
  breakdown: string;
}

@Injectable({
  providedIn: 'root'
})
export class ConsolidationService {
  
  constructor() {}
  
  /**
   * Calculate sleep quality from inputs
   * @param hours - Sleep duration (e.g., 6.25 for 6h 15min)
   * @param fitbitScore - Optional Fitbit sleep score (0-100)
   * @param interruptions - Interruption level
   * @returns Sleep quality assessment
   */
  assessSleepQuality(
    hours: number,
    fitbitScore?: number,
    interruptions: 'none' | 'minimal' | 'some' | 'frequent' = 'minimal'
  ): SleepQuality {
    let quality: 'excellent' | 'good' | 'fair' | 'poor';
    
    // Excellent: 8+ hrs, Fitbit 85+, no interruptions
    if (hours >= 8 && (fitbitScore === undefined || fitbitScore >= 85) && interruptions === 'none') {
      quality = 'excellent';
    }
    // Good: 7-8 hrs, Fitbit 75-84, minimal interruptions
    else if (hours >= 7 && hours < 8 && (fitbitScore === undefined || fitbitScore >= 75) && 
             (interruptions === 'none' || interruptions === 'minimal')) {
      quality = 'good';
    }
    // Fair: 6-7 hrs, Fitbit 65-74, some interruptions
    else if (hours >= 6 && hours < 7 && (fitbitScore === undefined || fitbitScore >= 65)) {
      quality = 'fair';
    }
    // Poor: <6 hrs, Fitbit <65, frequent interruptions
    else {
      quality = 'poor';
    }
    
    return { hours, fitbitScore, interruptions, quality };
  }
  
  /**
   * Get base consolidation rate from sleep quality
   * @param sleepQuality - Sleep assessment result
   * @returns Base consolidation rate (0.30-0.95)
   */
  getBaseSleepRate(sleepQuality: SleepQuality): number {
    switch (sleepQuality.quality) {
      case 'excellent':
        return 0.925; // 92.5% (midpoint of 90-95%)
      case 'good':
        return 0.80; // 80% (midpoint of 75-85%)
      case 'fair':
        return 0.65; // 65% (midpoint of 60-70%)
      case 'poor':
        return 0.40; // 40% (midpoint of 30-50%)
    }
  }
  
  /**
   * Calculate nutrition modifier based on skill category
   * @param nutrition - Nutrition quality assessment
   * @param skillCategory - Skill type (affects modifier logic)
   * @param previousDaysNutrition - Array of nutrition types for past 2 days (for cognitive skills)
   * @returns Modifier value (-0.05 to +0.05)
   */
  getNutritionModifier(
    nutrition: NutritionQuality,
    skillCategory: 'warrior' | 'cognitive' | 'sage',
    previousDaysNutrition: ('clean' | 'mixed' | 'poor')[] = []
  ): number {
    // Sage: No nutrition modifier
    if (skillCategory === 'sage') {
      return 0;
    }
    
    // Warrior: Single-day impact (post-workout nutrition affects muscle protein synthesis)
    if (skillCategory === 'warrior') {
      if (nutrition.type === 'clean') return 0.05;
      if (nutrition.type === 'mixed') return 0;
      if (nutrition.type === 'poor') return -0.05;
    }
    
    // Cognitive (Developer/Redteamer/Artist): 3-day rolling average
    if (skillCategory === 'cognitive') {
      const allDays = [...previousDaysNutrition, nutrition.type];
      const recentDays = allDays.slice(-3); // Last 3 days max
      
      // Single poor meal: -2% (minimal impact)
      if (recentDays.length === 1 && recentDays[0] === 'poor') {
        return -0.02;
      }
      
      // 2 consecutive poor days: -3%
      const poorCount = recentDays.filter(n => n === 'poor').length;
      if (recentDays.length === 2 && poorCount === 2) {
        return -0.03;
      }
      
      // 3+ consecutive poor days: Full -5%
      if (recentDays.length >= 3 && poorCount === 3) {
        return -0.05;
      }
      
      // 3-day clean average: +5%
      const cleanCount = recentDays.filter(n => n === 'clean').length;
      if (recentDays.length === 3 && cleanCount === 3) {
        return 0.05;
      }
      
      // Mixed: 0% (baseline)
      return 0;
    }
    
    return 0;
  }
  
  /**
   * Calculate fasting modifier
   * @param fasting - Fasting status assessment
   * @returns Modifier value (-0.05 to +0.05)
   */
  getFastingModifier(fasting: FastingStatus): number {
    // Fasted bedtime (3+ hrs): +5%
    if (fasting.isFasted) {
      return 0.05;
    }
    
    // Heavy meal before bed (<1 hr): -5%
    if (fasting.hoursSinceLastMeal < 1) {
      return -0.05;
    }
    
    // Fed bedtime (1-3 hrs): 0% (baseline)
    return 0;
  }
  
  /**
   * Calculate fasting status from timestamps
   * @param lastMealTime - Time of last meal
   * @param bedtime - Bedtime timestamp
   * @returns Fasting assessment
   */
  assessFasting(lastMealTime: Date, bedtime: Date): FastingStatus {
    const hoursSinceLastMeal = (bedtime.getTime() - lastMealTime.getTime()) / (1000 * 60 * 60);
    const isFasted = hoursSinceLastMeal >= 3;
    
    return {
      lastMealTime,
      bedtime,
      hoursSinceLastMeal: Math.round(hoursSinceLastMeal * 100) / 100,
      isFasted
    };
  }
  
  /**
   * Calculate permanent XP from pending XP using full consolidation formula
   * @param pendingXP - Pending XP from activity
   * @param sleepQuality - Sleep quality assessment
   * @param nutrition - Nutrition quality
   * @param fasting - Fasting status
   * @param skillCategory - Skill category (affects nutrition modifier logic)
   * @param previousDaysNutrition - Past 2 days nutrition (for cognitive skills)
   * @returns Consolidation result with breakdown
   */
  consolidateXP(
    pendingXP: number,
    sleepQuality: SleepQuality,
    nutrition: NutritionQuality,
    fasting: FastingStatus,
    skillCategory: 'warrior' | 'cognitive' | 'sage',
    previousDaysNutrition: ('clean' | 'mixed' | 'poor')[] = []
  ): ConsolidationResult {
    const baseSleepRate = this.getBaseSleepRate(sleepQuality);
    const nutritionModifier = this.getNutritionModifier(nutrition, skillCategory, previousDaysNutrition);
    const fastingModifier = this.getFastingModifier(fasting);
    
    const totalConsolidationRate = baseSleepRate + nutritionModifier + fastingModifier;
    const permanentXP = pendingXP * totalConsolidationRate;
    
    // Build breakdown string
    const breakdown = this.buildBreakdown(
      pendingXP,
      baseSleepRate,
      nutritionModifier,
      fastingModifier,
      totalConsolidationRate,
      permanentXP,
      sleepQuality,
      nutrition,
      fasting,
      skillCategory
    );
    
    return {
      pendingXP,
      baseSleepRate,
      nutritionModifier,
      fastingModifier,
      totalConsolidationRate,
      permanentXP: Math.round(permanentXP * 100) / 100,
      breakdown
    };
  }
  
  /**
   * Build human-readable breakdown of consolidation calculation
   */
  private buildBreakdown(
    pendingXP: number,
    baseSleepRate: number,
    nutritionModifier: number,
    fastingModifier: number,
    totalRate: number,
    permanentXP: number,
    sleepQuality: SleepQuality,
    nutrition: NutritionQuality,
    fasting: FastingStatus,
    skillCategory: string
  ): string {
    const lines: string[] = [];
    
    lines.push(`Pending XP: ${pendingXP.toFixed(2)}`);
    lines.push('');
    lines.push('Consolidation Breakdown:');
    lines.push(`  Sleep (${sleepQuality.hours}h, ${sleepQuality.quality}): ${(baseSleepRate * 100).toFixed(1)}%`);
    
    if (skillCategory !== 'sage') {
      const nutritionSign = nutritionModifier >= 0 ? '+' : '';
      lines.push(`  Nutrition (${nutrition.type}): ${nutritionSign}${(nutritionModifier * 100).toFixed(1)}%`);
    } else {
      lines.push(`  Nutrition: N/A (Sage activities not affected by food quality)`);
    }
    
    const fastingSign = fastingModifier >= 0 ? '+' : '';
    lines.push(`  Fasting (${fasting.hoursSinceLastMeal.toFixed(1)}h since meal): ${fastingSign}${(fastingModifier * 100).toFixed(1)}%`);
    lines.push('');
    lines.push(`Total Rate: ${(totalRate * 100).toFixed(1)}%`);
    lines.push(`Permanent XP: ${pendingXP.toFixed(2)} × ${totalRate.toFixed(3)} = ${permanentXP.toFixed(2)}`);
    
    return lines.join('\n');
  }
  
  /**
   * Quick consolidation with typical values (for testing)
   */
  quickConsolidate(
    pendingXP: number,
    sleepHours: number = 6.25,
    nutritionType: 'clean' | 'mixed' | 'poor' = 'mixed',
    hoursAfterMeal: number = 3
  ): ConsolidationResult {
    const sleepQuality = this.assessSleepQuality(sleepHours);
    const nutrition: NutritionQuality = {
      type: nutritionType,
      description: nutritionType === 'clean' ? 'High protein, whole foods' : 
                   nutritionType === 'mixed' ? 'Balanced with some treats' : 
                   'Low protein, processed foods'
    };
    const now = new Date();
    const bedtime = new Date(now);
    const lastMeal = new Date(bedtime.getTime() - (hoursAfterMeal * 60 * 60 * 1000));
    const fasting = this.assessFasting(lastMeal, bedtime);
    
    return this.consolidateXP(
      pendingXP,
      sleepQuality,
      nutrition,
      fasting,
      'cognitive' // Default to cognitive
    );
  }
}
