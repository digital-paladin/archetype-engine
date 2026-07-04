import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { BodyStatus, BodyPart, StatusType, Severity } from './body-status.interface';
import { environment } from '../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class BodyStatusService {
  private statuses$ = new BehaviorSubject<BodyStatus[]>([]);
  private http = inject(HttpClient);

  constructor() {
    this.loadFromStorage();
  }

  getStatuses(): Observable<BodyStatus[]> {
    return this.statuses$.asObservable();
  }

  getActiveStatuses(): BodyStatus[] {
    return this.statuses$.value.filter(s => !this.isHealed(s));
  }

  getStatusesByBodyPart(bodyPart: BodyPart): BodyStatus[] {
    return this.statuses$.value.filter(s => s.bodyPart === bodyPart && !this.isHealed(s));
  }

  addStatus(
    bodyPart: BodyPart,
    type: StatusType,
    severity: Severity,
    name: string,
    description: string,
    estimatedRecoveryDays?: number,
    notes?: string,
    impactsActions?: string[],
    xpPenalty?: number
  ): void {
    const status: BodyStatus = {
      id: this.generateId(),
      bodyPart,
      type,
      severity,
      name,
      description,
      startDate: new Date(),
      estimatedRecoveryDays,
      notes,
      color: this.getColorForStatus(type, severity),
      impactsActions,
      xpPenalty
    };

    const currentStatuses = this.statuses$.value;
    this.statuses$.next([status, ...currentStatuses]);
    this.saveToStorage();

    console.log(`[BodyStatus] Added: ${name} (${bodyPart}, ${severity})`);
  }

  updateStatus(id: string, updates: Partial<BodyStatus>): void {
    const statuses = this.statuses$.value;
    const updatedStatuses = statuses.map(s => 
      s.id === id ? { ...s, ...updates } : s
    );

    this.statuses$.next(updatedStatuses);
    this.saveToStorage();

    console.log(`[BodyStatus] Updated: ${id}`);
  }

  removeStatus(id: string): void {
    const statuses = this.statuses$.value;
    const filtered = statuses.filter(s => s.id !== id);

    this.statuses$.next(filtered);
    this.saveToStorage();

    console.log(`[BodyStatus] Removed: ${id}`);
  }

  markHealed(id: string): void {
    this.removeStatus(id);
  }

  // Check if status should be auto-healed based on recovery days
  private isHealed(status: BodyStatus): boolean {
    if (!status.estimatedRecoveryDays) return false;

    const daysSinceStart = this.getDaysSince(status.startDate);
    return daysSinceStart >= status.estimatedRecoveryDays;
  }

  getDaysSince(date: Date): number {
    const now = new Date();
    const start = new Date(date);
    const diffMs = now.getTime() - start.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  getRemainingDays(status: BodyStatus): number {
    if (!status.estimatedRecoveryDays) return 0;

    const daysSince = this.getDaysSince(status.startDate);
    const remaining = status.estimatedRecoveryDays - daysSince;
    return Math.max(0, remaining);
  }

  getRecoveryPercentage(status: BodyStatus): number {
    if (!status.estimatedRecoveryDays) return 0;

    const daysSince = this.getDaysSince(status.startDate);
    const percentage = (daysSince / status.estimatedRecoveryDays) * 100;
    return Math.min(100, Math.max(0, percentage));
  }

  // Get XP penalty for an action type
  getXPPenaltyForAction(actionType: string): number {
    const activeStatuses = this.getActiveStatuses();
    const affectingStatuses = activeStatuses.filter(s => 
      s.impactsActions?.includes(actionType)
    );

    if (affectingStatuses.length === 0) return 0;

    // Take highest penalty (not cumulative to avoid over-penalization)
    const maxPenalty = Math.max(...affectingStatuses.map(s => s.xpPenalty || 0));
    return maxPenalty;
  }

  // Get all affected actions
  getAffectedActions(): string[] {
    const activeStatuses = this.getActiveStatuses();
    const actions = new Set<string>();

    activeStatuses.forEach(s => {
      s.impactsActions?.forEach(action => actions.add(action));
    });

    return Array.from(actions);
  }

  private getColorForStatus(type: StatusType, severity: Severity): string {
    const colors = {
      injury: {
        minor: '#ff9999',      // Light red
        moderate: '#ff6666',   // Medium red
        severe: '#ff3333',     // Bright red
        critical: '#cc0000'    // Dark red
      },
      illness: {
        minor: '#ffff99',      // Light yellow
        moderate: '#ffff66',   // Medium yellow
        severe: '#ffcc00',     // Orange-yellow
        critical: '#ff9900'    // Dark orange
      },
      disease: {
        minor: '#ffcc99',      // Light orange
        moderate: '#ff9966',   // Medium orange
        severe: '#ff6633',     // Bright orange
        critical: '#ff3300'    // Red-orange
      }
    };

    return colors[type][severity];
  }

  private generateId(): string {
    return `status-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem('body-status', JSON.stringify(this.statuses$.value));
    } catch (error) {
      console.error('[BodyStatus] Failed to save:', error);
    }
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('body-status');
      if (stored) {
        const statuses = JSON.parse(stored);
        this.statuses$.next(statuses);
      }
    } catch (error) {
      console.error('[BodyStatus] Failed to load:', error);
    }
  }

  // Get summary statistics
  getSummary(): {
    totalActive: number;
    injuries: number;
    illnesses: number;
    diseases: number;
    critical: number;
  } {
    const active = this.getActiveStatuses();

    return {
      totalActive: active.length,
      injuries: active.filter(s => s.type === 'injury').length,
      illnesses: active.filter(s => s.type === 'illness').length,
      diseases: active.filter(s => s.type === 'disease').length,
      critical: active.filter(s => s.severity === 'critical').length
    };
  }

  /**
   * Fetch active injuries from the journal API and populate the body diagram.
   * Journal is the source of truth — replaces any existing journal-synced entries.
   * Manually-added entries (id not prefixed 'journal-') are preserved.
   */
  syncFromJournal(): void {
    this.http.get<{ success: boolean; injuries: any[] }>(`${environment.apiUrl}/api/character/injuries`)
      .subscribe({
        next: (res) => {
          if (!res.success || !res.injuries) return;

          // Keep manually-added statuses (those not prefixed with 'journal-')
          const manual = this.statuses$.value.filter(s => !s.id.startsWith('journal-'));

          const journalStatuses: BodyStatus[] = res.injuries.map((inj: any) => ({
            id: inj.id,
            bodyPart: inj.bodyPart as BodyPart,
            type: 'injury' as StatusType,
            severity: inj.severity as Severity,
            name: inj.name,
            description: inj.description,
            startDate: new Date(inj.onsetDate),
            estimatedRecoveryDays: inj.estimatedRecoveryDays,
            notes: inj.notes,
            color: this.getColorForStatus('injury', inj.severity as Severity),
            impactsActions: inj.impactsActions ?? [],
            xpPenalty: inj.xpPenalty ?? 0
          }));

          this.statuses$.next([...journalStatuses, ...manual]);
          this.saveToStorage();
          console.log(`[BodyStatus] Synced ${journalStatuses.length} injuries from journal`);
        },
        error: (err) => { console.warn('[BodyStatus] Journal sync failed:', err); }
      });
  }
}
