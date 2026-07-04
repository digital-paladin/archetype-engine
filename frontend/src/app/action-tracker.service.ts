import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, interval } from 'rxjs';
import { map } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { EventQueue } from 'rot-js';
import { XpCalculationService, XPCalculation } from './xp-calculation.service';
import { ConsolidationService, ConsolidationResult } from './consolidation.service';
import { LevelProgressionService, LevelUpResult } from './level-progression.service';
import { environment } from '../environments/environment';

export interface ActiveAction {
  type: 'prayer' | 'workout' | 'coding' | 'redteam' | 'artist' | 'lab' | 'meal' | 'water' | 'fasting';
  activityKey: string; // Key for xp-calculation.service (e.g., 'coding-routine', 'htb-medium')
  skillId?: string;    // Specific skill from skill-tree.data (e.g., 'rt-xss', 'mma-jab')
  startTime: Date;
  duration: number; // seconds elapsed
  animation: string; // Mixamo animation to loop
  quest?: string; // Associated quest (e.g., "IQ-8525")
  targetResult: string; // Desired outcome
  attempts: number; // Failed attempts counter
  status: 'in-progress' | 'completed' | 'failed';
  intensity: 'routine' | 'moderate' | 'complex'; // Intensity tier
  bonusKeys: string[]; // Bonus keys to apply on completion
  xpCalculated?: XPCalculation; // Calculated XP (after completion)
  xpConsolidated?: ConsolidationResult; // Consolidated XP (after sleep)
}

export interface MilestoneAlert {
  type: '15-min' | '30-min' | '1-hr' | '2-hr';
  message: string;
  elapsed: number;    // seconds elapsed when milestone fired
  xpSoFar: number;   // pending XP earned so far in the session
}

const MILESTONES: Array<{ elapsedSecs: number; type: MilestoneAlert['type']; message: string }> = [
  { elapsedSecs: 900,  type: '15-min', message: '⚡ 15 min — hold the line, Paladin.' },
  { elapsedSecs: 1800, type: '30-min', message: '🔥 30 min of discipline locked in!' },
  { elapsedSecs: 3600, type: '1-hr',   message: '🏆 1 hour deep — Warrior state achieved.' },
  { elapsedSecs: 7200, type: '2-hr',   message: '💎 Deep Work mastery — 2 hours conquered.' },
];

export interface ActionHistory {
  action: ActiveAction;
  completedAt: Date;
  totalDuration: number; // seconds
  successful: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ActionTrackerService {
  private currentAction$ = new BehaviorSubject<ActiveAction | null>(null);
  private actionHistory$ = new BehaviorSubject<ActionHistory[]>([]);
  private milestoneAlerts$ = new Subject<MilestoneAlert>();
  private timerInterval: any;
  /** rot.js EventQueue — holds ordered milestone payloads, drained as elapsed time crosses each gate */
  private milestoneQueue!: EventQueue;
  private nextMilestoneIdx = 0;

  constructor(
    private xpCalc: XpCalculationService,
    private consolidation: ConsolidationService,
    private levelProg: LevelProgressionService,
    private http: HttpClient
  ) {
    this.loadHistoryFromStorage();
  }

  getCurrentAction(): Observable<ActiveAction | null> {
    return this.currentAction$.asObservable();
  }

  getActionHistory(): Observable<ActionHistory[]> {
    return this.actionHistory$.asObservable();
  }

  startAction(
    type: ActiveAction['type'],
    activityKey: string,
    animation: string,
    targetResult: string,
    intensity: 'routine' | 'moderate' | 'complex' = 'routine',
    quest?: string,
    bonusKeys: string[] = [],
    skillId?: string
  ): void {
    // Stop current action if any
    if (this.currentAction$.value) {
      this.cancelAction();
    }

    const action: ActiveAction = {
      type,
      activityKey,
      skillId,
      startTime: new Date(),
      duration: 0,
      animation,
      quest,
      targetResult,
      attempts: 0,
      status: 'in-progress',
      intensity,
      bonusKeys
    };

    this.currentAction$.next(action);
    this.populateMilestoneQueue();

    // Start timer (updates every second)
    this.timerInterval = setInterval(() => {
      const current = this.currentAction$.value;
      if (current) {
        const elapsed = Math.floor((Date.now() - current.startTime.getTime()) / 1000);
        this.currentAction$.next({
          ...current,
          duration: elapsed
        });
        this.processQueue(elapsed, current);
      }
    }, 1000);

    console.log(`[Action Tracker] Started: ${type} (${activityKey}) - ${intensity} intensity - ${targetResult}`);
  }

  completeAction(): ActiveAction | null {
    const action = this.currentAction$.value;
    if (!action) return null;

    // Stop timer
    this.stopTimer();

    // Calculate XP based on duration, intensity, and bonuses
    const hours = action.duration / 3600; // Convert seconds to hours
    const xpCalculation = this.xpCalc.calculatePendingXP(
      action.activityKey,
      hours,
      action.intensity,
      action.bonusKeys
    );

    // Mark as completed with XP calculation
    const completedAction: ActiveAction = {
      ...action,
      status: 'completed',
      xpCalculated: xpCalculation
    };

    // Add to history
    this.addToHistory(completedAction, true);

    // Log to journal via backend
    this.logActivityToJournal(completedAction);

    // Clear current action
    this.currentAction$.next(null);

    console.log(`[Action Tracker] Completed: ${action.type} - ${this.formatDuration(action.duration)} - ${xpCalculation.pendingXP.toFixed(2)} Pending XP`);
    console.log(`[Action Tracker] XP Breakdown:`, xpCalculation);

    return completedAction;
  }

  failAction(): void {
    const action = this.currentAction$.value;
    if (!action) return;

    // Increment failed attempts
    const failedAction: ActiveAction = {
      ...action,
      attempts: action.attempts + 1,
      status: 'failed'
    };

    // Add to history
    this.addToHistory(failedAction, false);

    // Clear current action
    this.currentAction$.next(null);

    // Stop timer
    this.stopTimer();

    console.log(`[Action Tracker] Failed: ${action.type} - Attempt ${failedAction.attempts}`);
  }

  cancelAction(): void {
    const action = this.currentAction$.value;
    if (!action) return;

    console.log(`[Action Tracker] Cancelled: ${action.type} - ${action.duration}s`);

    // Stop timer
    this.stopTimer();

    // Clear current action (don't add to history for cancellations)
    this.currentAction$.next(null);
  }

  retryAction(): void {
    const action = this.currentAction$.value;
    if (!action) return;

    // Increment attempts counter
    this.currentAction$.next({
      ...action,
      attempts: action.attempts + 1,
      startTime: new Date(), // Reset start time
      duration: 0
    });

    console.log(`[Action Tracker] Retry: ${action.type} - Attempt ${action.attempts + 1}`);
  }

  getMilestoneAlerts(): Observable<MilestoneAlert> {
    return this.milestoneAlerts$.asObservable();
  }

  private populateMilestoneQueue(): void {
    this.milestoneQueue = new EventQueue();
    this.nextMilestoneIdx = 0;
    // Add each milestone with its relative time delta from the previous milestone.
    // EventQueue uses relative offsets — each event time is relative to the previous event.
    let prevSecs = 0;
    for (const m of MILESTONES) {
      this.milestoneQueue.add(m, m.elapsedSecs - prevSecs);
      prevSecs = m.elapsedSecs;
    }
  }

  private processQueue(elapsed: number, action: ActiveAction): void {
    while (
      this.milestoneQueue &&
      this.nextMilestoneIdx < MILESTONES.length &&
      elapsed >= MILESTONES[this.nextMilestoneIdx].elapsedSecs
    ) {
      // Drain the next milestone from the EventQueue (maintains ordered payload delivery).
      const milestone = this.milestoneQueue.get() as typeof MILESTONES[0];
      if (!milestone) break;

      const hours = elapsed / 3600;
      let xpSoFar = 0;
      try {
        xpSoFar = this.xpCalc.calculatePendingXP(action.activityKey, hours, action.intensity, []).pendingXP;
      } catch { /* unknown activityKey — leave xpSoFar as 0 */ }

      this.milestoneAlerts$.next({ type: milestone.type, message: milestone.message, elapsed, xpSoFar });
      console.log(`[Action Tracker] Milestone: ${milestone.type} — ${milestone.message} | +${xpSoFar.toFixed(1)} XP so far`);
      this.nextMilestoneIdx++;
    }
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.milestoneQueue?.clear();
    this.nextMilestoneIdx = 0;
  }

  private addToHistory(action: ActiveAction, successful: boolean): void {
    const historyEntry: ActionHistory = {
      action: { ...action },
      completedAt: new Date(),
      totalDuration: action.duration,
      successful
    };

    const currentHistory = this.actionHistory$.value;
    const updatedHistory = [historyEntry, ...currentHistory].slice(0, 50); // Keep last 50

    this.actionHistory$.next(updatedHistory);
    this.saveHistoryToStorage(updatedHistory);
  }

  private logActivityToJournal(action: ActiveAction): void {
    const durationMinutes = action.duration > 0 ? Math.round(action.duration / 60) : undefined;
    const pendingXp = action.xpCalculated?.pendingXP;
    const body: { activityType: string; duration?: number; notes?: string; xp?: number; clientDate?: string } = {
      activityType: action.targetResult || action.activityKey,
      ...(durationMinutes !== undefined && { duration: durationMinutes }),
      ...(action.skillId && { notes: action.skillId }),
      ...(pendingXp !== undefined && { xp: pendingXp }),
      clientDate: new Date().toLocaleDateString('en-CA')
    };

    this.http.post(`${environment.apiUrl}/api/activities`, body).subscribe({
      next: () => console.log(`[Action Tracker] Journal logged: ${body.activityType}`),
      error: err => console.error('[Action Tracker] Journal log failed:', err)
    });
  }

  private saveHistoryToStorage(history: ActionHistory[]): void {
    try {
      localStorage.setItem('action-tracker-history', JSON.stringify(history));
    } catch (error) {
      console.error('[Action Tracker] Failed to save history:', error);
    }
  }

  private loadHistoryFromStorage(): void {
    try {
      const stored = localStorage.getItem('action-tracker-history');
      if (stored) {
        const history = JSON.parse(stored);
        this.actionHistory$.next(history);
      }
    } catch (error) {
      console.error('[Action Tracker] Failed to load history:', error);
    }
  }

  // Helper: Format duration as HH:MM:SS
  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  }

  // Get total time spent on activity type today
  getTodayTimeByType(type: ActiveAction['type']): number {
    const history = this.actionHistory$.value;
    const today = new Date().toDateString();

    return history
      .filter(entry => 
        entry.action.type === type && 
        new Date(entry.completedAt).toDateString() === today &&
        entry.successful
      )
      .reduce((total, entry) => total + entry.totalDuration, 0);
  }

  // Get success rate for activity type
  getSuccessRate(type: ActiveAction['type']): number {
    const history = this.actionHistory$.value;
    const typeHistory = history.filter(entry => entry.action.type === type);

    if (typeHistory.length === 0) return 0;

    const successful = typeHistory.filter(entry => entry.successful).length;
    return Math.round((successful / typeHistory.length) * 100);
  }

  /**
   * Consolidate pending XP with sleep + nutrition + fasting
   * Call this when logging sleep for the day
   * @param action - Completed action with XP calculation
   * @param sleepHours - Hours of sleep (e.g., 6.25 for 6h 15min)
   * @param nutritionType - Food quality
   * @param hoursAfterMeal - Hours between last meal and bedtime
   * @param skillCategory - Skill type (affects nutrition modifier)
   * @returns Consolidation result
   */
  consolidateActionXP(
    action: ActiveAction,
    sleepHours: number,
    nutritionType: 'clean' | 'mixed' | 'poor',
    hoursAfterMeal: number,
    skillCategory: 'warrior' | 'cognitive' | 'sage'
  ): ConsolidationResult | null {
    if (!action.xpCalculated) {
      console.warn('[Action Tracker] Cannot consolidate - no XP calculation found');
      return null;
    }

    const sleepQuality = this.consolidation.assessSleepQuality(sleepHours);
    const nutrition = {
      type: nutritionType,
      description: nutritionType === 'clean' ? 'High protein, whole foods' :
                   nutritionType === 'mixed' ? 'Balanced with some treats' :
                   'Low protein, processed foods'
    };
    const now = new Date();
    const bedtime = new Date(now);
    const lastMeal = new Date(bedtime.getTime() - (hoursAfterMeal * 60 * 60 * 1000));
    const fasting = this.consolidation.assessFasting(lastMeal, bedtime);

    const consolidationResult = this.consolidation.consolidateXP(
      action.xpCalculated.pendingXP,
      sleepQuality,
      nutrition,
      fasting,
      skillCategory
    );

    console.log(`[Action Tracker] Consolidated XP:`, consolidationResult);

    return consolidationResult;
  }

  /**
   * Add consolidated XP to character's skill class
   * @param skillClassId - Skill class to add XP to (e.g., 'developer', 'warrior')
   * @param permanentXP - Consolidated XP from consolidateActionXP
   * @returns Level-up result if character leveled up
   */
  addXPToCharacter(skillClassId: string, permanentXP: number): LevelUpResult | null {
    const levelUpResult = this.levelProg.addXP(skillClassId, permanentXP);

    if (levelUpResult) {
      console.log(`[Action Tracker] 🎉 LEVEL UP!`, levelUpResult);
    }

    return levelUpResult;
  }

  /**
   * Get current character progress
   */
  getCharacterProgress() {
    return this.levelProg.getCurrentProgress();
  }

  /**
   * Get XP calculation service (for UI to show activity rates)
   */
  getXPService() {
    return this.xpCalc;
  }
}
