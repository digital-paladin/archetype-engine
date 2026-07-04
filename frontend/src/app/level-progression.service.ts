import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/**
 * Level Progression Service
 * Implements Digital Paladin multi-class leveling system
 * Formula: XP_to_level = 100 × (level^1.5)
 * Based on character-sheet.md level progression formulas
 */

export interface SkillClass {
  id: string;
  name: string;
  icon: string;
  currentLevel: number;
  currentXP: number;
  xpForCurrentLevel: number; // XP needed to reach current level
  xpForNextLevel: number; // XP needed to reach next level
  progressToNextLevel: number; // 0-100%
  tier: 'novice' | 'competent' | 'expert' | 'world-class';
  totalHoursEstimate: number; // Estimated hours invested
}

export interface LevelUpResult {
  classId: string;
  className: string;
  oldLevel: number;
  newLevel: number;
  overflowXP: number;
  tierChange: string | null; // e.g., "Novice → Competent"
  multiLevelGain: boolean; // True if gained 2+ levels at once
}

export interface CharacterProgress {
  classes: { [classId: string]: SkillClass };
  totalXPAllClasses: number;
  highestLevel: number;
  overallTier: string;
}

@Injectable({
  providedIn: 'root'
})
export class LevelProgressionService {
  
  // Observable state for character progress
  private progressSubject = new BehaviorSubject<CharacterProgress>(this.getInitialProgress());
  public progress$: Observable<CharacterProgress> = this.progressSubject.asObservable();
  
  constructor() {
    this.loadFromStorage();
  }
  
  /**
   * Calculate XP required for a specific level
   * Formula: XP_to_level = 100 × (level^1.5)
   * @param level - Target level (1-40+)
   * @returns XP needed to reach that level from previous level
   */
  calculateXPForLevel(level: number): number {
    if (level <= 1) return 0;
    return Math.floor(100 * Math.pow(level, 1.5));
  }
  
  /**
   * Calculate cumulative XP needed to reach a level from level 1
   * @param level - Target level
   * @returns Total XP from level 1 to target level
   */
  calculateCumulativeXP(level: number): number {
    let total = 0;
    for (let i = 2; i <= level; i++) {
      total += this.calculateXPForLevel(i);
    }
    return total;
  }
  
  /**
   * Get level tier based on level number
   * Levels 1-10: Novice, 11-20: Competent, 21-30: Expert, 31+: World-Class
   */
  getLevelTier(level: number): 'novice' | 'competent' | 'expert' | 'world-class' {
    if (level <= 10) return 'novice';
    if (level <= 20) return 'competent';
    if (level <= 30) return 'expert';
    return 'world-class';
  }
  
  /**
   * Estimate total hours invested based on level
   * Uses character-sheet.md progression interpretation
   */
  estimateTotalHours(level: number): number {
    if (level <= 10) {
      // Novice: ~1,500 hours total for levels 1-10
      return Math.floor((level / 10) * 1500);
    } else if (level <= 20) {
      // Competent: ~9,000 hours cumulative by level 20
      return 1500 + Math.floor(((level - 10) / 10) * 7500);
    } else if (level <= 30) {
      // Expert: ~25,000 hours cumulative by level 30
      return 9000 + Math.floor(((level - 20) / 10) * 16000);
    } else {
      // World-Class: 50,000+ hours
      return 25000 + Math.floor((level - 30) * 2500);
    }
  }
  
  /**
   * Add XP to a skill class and check for level-up
   * @param classId - Skill class identifier
   * @param xpGained - Permanent XP to add
   * @returns LevelUpResult if leveled up, null otherwise
   */
  addXP(classId: string, xpGained: number): LevelUpResult | null {
    const progress = this.progressSubject.value;
    const skillClass = progress.classes[classId];
    
    if (!skillClass) {
      throw new Error(`Unknown skill class: ${classId}`);
    }
    
    // Add XP
    skillClass.currentXP += xpGained;
    
    // Check for level-up (possibly multiple levels)
    const levelUpResult = this.checkLevelUp(skillClass);
    
    // Update progress
    this.updateProgress(progress);
    this.saveToStorage();
    
    return levelUpResult;
  }
  
  /**
   * Check if skill class should level up (handles overflow XP)
   * @param skillClass - Skill class to check
   * @returns LevelUpResult if leveled up, null otherwise
   */
  private checkLevelUp(skillClass: SkillClass): LevelUpResult | null {
    const xpNeededForNext = this.calculateXPForLevel(skillClass.currentLevel + 1);
    
    if (skillClass.currentXP < xpNeededForNext) {
      // No level-up, just update progress percentage
      skillClass.progressToNextLevel = Math.min(100, (skillClass.currentXP / xpNeededForNext) * 100);
      return null;
    }
    
    // Level up!
    const oldLevel = skillClass.currentLevel;
    const oldTier = this.getLevelTier(oldLevel);
    let levelsGained = 0;
    
    // Handle potential multiple level-ups from overflow XP
    while (skillClass.currentXP >= this.calculateXPForLevel(skillClass.currentLevel + 1)) {
      const xpForNextLevel = this.calculateXPForLevel(skillClass.currentLevel + 1);
      skillClass.currentXP -= xpForNextLevel; // Consume XP for level
      skillClass.currentLevel++;
      levelsGained++;
      
      // Safety check: prevent infinite loop
      if (levelsGained > 10) {
        console.warn('Prevented excessive level gain (>10 levels at once)');
        break;
      }
    }
    
    const newLevel = skillClass.currentLevel;
    const newTier = this.getLevelTier(newLevel);
    
    // Update skill class metadata
    skillClass.xpForCurrentLevel = this.calculateXPForLevel(newLevel);
    skillClass.xpForNextLevel = this.calculateXPForLevel(newLevel + 1);
    skillClass.progressToNextLevel = (skillClass.currentXP / skillClass.xpForNextLevel) * 100;
    skillClass.tier = newTier;
    skillClass.totalHoursEstimate = this.estimateTotalHours(newLevel);
    
    const tierChange = oldTier !== newTier ? `${oldTier} → ${newTier}` : null;
    
    return {
      classId: skillClass.id,
      className: skillClass.name,
      oldLevel,
      newLevel,
      overflowXP: skillClass.currentXP,
      tierChange,
      multiLevelGain: levelsGained > 1
    };
  }
  
  /**
   * Update overall character progress metrics
   */
  private updateProgress(progress: CharacterProgress): void {
    progress.totalXPAllClasses = Object.values(progress.classes)
      .reduce((sum, cls) => sum + this.calculateCumulativeXP(cls.currentLevel) + cls.currentXP, 0);
    
    progress.highestLevel = Math.max(...Object.values(progress.classes).map(c => c.currentLevel));
    progress.overallTier = this.getLevelTier(progress.highestLevel);
    
    this.progressSubject.next(progress);
  }
  
  /**
   * Get current progress snapshot
   */
  getCurrentProgress(): CharacterProgress {
    return this.progressSubject.value;
  }
  
  /**
   * Get specific skill class
   */
  getSkillClass(classId: string): SkillClass | undefined {
    return this.progressSubject.value.classes[classId];
  }
  
  /**
   * Get all skill classes as array
   */
  getAllSkillClasses(): SkillClass[] {
    return Object.values(this.progressSubject.value.classes);
  }
  
  /**
   * Initialize character with default skill classes
   * Uses character-sheet.md current stats as baseline
   */
  private getInitialProgress(): CharacterProgress {
    const classes: { [classId: string]: SkillClass } = {
      developer: this.createSkillClass('developer', 'Web App Developer', '💻', 20, 0),
      sage: this.createSkillClass('sage', 'Sage', '📿', 26, 0),
      warrior: this.createSkillClass('warrior', 'Warrior', '⚔️', 9, 0),
      redteamer: this.createSkillClass('redteamer', 'Red Team Operator', '🔴', 11, 0),
      artist: this.createSkillClass('artist', 'Artist', '🎨', 9, 0),
      survivalist: this.createSkillClass('survivalist', 'Survivalist', '🏕️', 1, 0),
      financial: this.createSkillClass('financial', 'Financial Strategist', '💰', 1, 0)
    };
    
    return {
      classes,
      totalXPAllClasses: 0,
      highestLevel: 26,
      overallTier: 'expert'
    };
  }
  
  /**
   * Create skill class object with calculated values
   */
  private createSkillClass(
    id: string,
    name: string,
    icon: string,
    level: number,
    currentXP: number
  ): SkillClass {
    const xpForCurrentLevel = this.calculateXPForLevel(level);
    const xpForNextLevel = this.calculateXPForLevel(level + 1);
    const progressToNextLevel = (currentXP / xpForNextLevel) * 100;
    const tier = this.getLevelTier(level);
    const totalHoursEstimate = this.estimateTotalHours(level);
    
    return {
      id,
      name,
      icon,
      currentLevel: level,
      currentXP,
      xpForCurrentLevel,
      xpForNextLevel,
      progressToNextLevel,
      tier,
      totalHoursEstimate
    };
  }
  
  /**
   * Set skill class level and XP (for syncing with character-sheet.md)
   */
  setSkillClass(classId: string, level: number, currentXP: number): void {
    const progress = this.progressSubject.value;
    const skillClass = progress.classes[classId];
    
    if (!skillClass) {
      throw new Error(`Unknown skill class: ${classId}`);
    }
    
    skillClass.currentLevel = level;
    skillClass.currentXP = currentXP;
    skillClass.xpForCurrentLevel = this.calculateXPForLevel(level);
    skillClass.xpForNextLevel = this.calculateXPForLevel(level + 1);
    skillClass.progressToNextLevel = (currentXP / skillClass.xpForNextLevel) * 100;
    skillClass.tier = this.getLevelTier(level);
    skillClass.totalHoursEstimate = this.estimateTotalHours(level);
    
    this.updateProgress(progress);
    this.saveToStorage();
  }
  
  /**
   * Save character progress to localStorage
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem('character-progress', JSON.stringify(this.progressSubject.value));
    } catch (error) {
      console.error('Failed to save character progress:', error);
    }
  }
  
  /**
   * Load character progress from localStorage
   */
  private loadFromStorage(): void {
    try {
      const saved = localStorage.getItem('character-progress');
      if (saved) {
        const progress = JSON.parse(saved);
        this.progressSubject.next(progress);
      }
    } catch (error) {
      console.error('Failed to load character progress:', error);
    }
  }
  
  /**
   * Reset all progress (for testing or fresh start)
   */
  resetProgress(): void {
    this.progressSubject.next(this.getInitialProgress());
    this.saveToStorage();
  }
}
