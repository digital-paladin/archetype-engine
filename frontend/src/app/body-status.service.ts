import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { BodyStatus, BodyPart, StatusType, Severity } from './body-status.interface';
import { environment } from '../environments/environment';

/** Raw shape returned by GET/POST /api/body-status (snake_case DB row). */
interface BodyStatusRow {
  id: string;
  body_part: string;
  type: string;
  severity: string;
  name: string;
  description?: string;
  start_date: string;
  estimated_recovery_days?: number;
  notes?: string;
  impacts_actions?: string[];
  xp_penalty?: number;
}

@Injectable({
  providedIn: 'root'
})
export class BodyStatusService {
  private statuses$ = new BehaviorSubject<BodyStatus[]>([]);
  private http = inject(HttpClient);

  constructor() {
    this.loadFromStorage();
    // Backend is now source of truth — refresh immediately on top of the
    // localStorage cache so the UI paints instantly, then updates when the
    // network response lands.
    this.syncFromJournal();
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

    const localId = status.id;
    const currentStatuses = this.statuses$.value;
    this.statuses$.next([status, ...currentStatuses]);
    this.saveToStorage();

    console.log(`[BodyStatus] Added: ${name} (${bodyPart}, ${severity})`);

    // Best-effort backend persistence — UI already updated optimistically above.
    this.http.post<{ success: boolean; status: BodyStatusRow }>(
      `${environment.apiUrl}/api/body-status`,
      {
        bodyPart, type, severity, name, description,
        startDate: status.startDate.toISOString(),
        estimatedRecoveryDays, notes, impactsActions, xpPenalty,
      },
    ).subscribe({
      // Swap the client-generated id for the server-assigned one so later
      // updateStatus()/removeStatus() calls actually target the real row.
      next: (res) => {
        if (res.success && res.status?.id) {
          this.replaceLocalId(localId, res.status.id);
        }
      },
      error: (err) => console.warn('[BodyStatus] Backend add failed (kept local-only):', err),
    });
  }

  updateStatus(id: string, updates: Partial<BodyStatus>): void {
    const statuses = this.statuses$.value;
    const updatedStatuses = statuses.map(s => 
      s.id === id ? { ...s, ...updates } : s
    );

    this.statuses$.next(updatedStatuses);
    this.saveToStorage();

    console.log(`[BodyStatus] Updated: ${id}`);

    this.http.patch(`${environment.apiUrl}/api/body-status/${id}`, {
      bodyPart: updates.bodyPart,
      type: updates.type,
      severity: updates.severity,
      name: updates.name,
      description: updates.description,
      estimatedRecoveryDays: updates.estimatedRecoveryDays,
      notes: updates.notes,
      impactsActions: updates.impactsActions,
      xpPenalty: updates.xpPenalty,
    }).subscribe({
      error: (err) => console.warn('[BodyStatus] Backend update failed (kept local-only):', err),
    });
  }

  removeStatus(id: string): void {
    const statuses = this.statuses$.value;
    const filtered = statuses.filter(s => s.id !== id);

    this.statuses$.next(filtered);
    this.saveToStorage();

    console.log(`[BodyStatus] Removed: ${id}`);

    this.http.delete(`${environment.apiUrl}/api/body-status/${id}`).subscribe({
      error: (err) => console.warn('[BodyStatus] Backend remove failed (kept local-only):', err),
    });
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

  getColorForStatus(type: StatusType, severity: Severity): string {
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

  /** Client-generated ids (see generateId) vs. server-assigned UUIDs from body_status. */
  private isLocalOnlyId(id: string): boolean {
    return id.startsWith('status-');
  }

  /** Swaps a client-generated temp id for the real server-assigned UUID once the POST resolves. */
  private replaceLocalId(oldId: string, newId: string): void {
    const statuses = this.statuses$.value.map(s => (s.id === oldId ? { ...s, id: newId } : s));
    this.statuses$.next(statuses);
    this.saveToStorage();
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
   * Refreshes all body-status entries from the backend (source of truth —
   * Supabase-backed `body_status` table, replacing the old
   * GET /api/character/injuries stub that always returned []). Called on
   * service init and can be called again to force a manual refresh.
   * localStorage remains a read-through cache for instant paint / offline use.
   */
  syncFromJournal(): void {
    this.http.get<{ success: boolean; statuses: BodyStatusRow[] }>(`${environment.apiUrl}/api/body-status`)
      .subscribe({
        next: (res) => {
          if (!res.success || !res.statuses) return;

          const statuses: BodyStatus[] = res.statuses.map((row) => ({
            id: row.id,
            bodyPart: row.body_part as BodyPart,
            type: row.type as StatusType,
            severity: row.severity as Severity,
            name: row.name,
            description: row.description ?? '',
            startDate: new Date(row.start_date),
            estimatedRecoveryDays: row.estimated_recovery_days ?? undefined,
            notes: row.notes ?? undefined,
            color: this.getColorForStatus(row.type as StatusType, row.severity as Severity),
            impactsActions: row.impacts_actions ?? [],
            xpPenalty: row.xp_penalty ?? 0,
          }));

          // Preserve any status that never made it to the backend yet (e.g. added
          // while offline — still carries a client-generated 'status-…' id rather
          // than a server UUID) instead of silently dropping it on refresh.
          const unsynced = this.statuses$.value.filter(s => this.isLocalOnlyId(s.id));
          this.statuses$.next([...statuses, ...unsynced]);
          this.saveToStorage();
          console.log(`[BodyStatus] Synced ${statuses.length} statuses from backend (${unsynced.length} pending local-only)`);
        },
        error: (err) => { console.warn('[BodyStatus] Backend sync failed (kept local cache):', err); }
      });
  }
}
