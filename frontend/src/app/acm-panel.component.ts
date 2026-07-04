import { Component, signal, inject, OnInit, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../environments/environment';
import { WillpowerService } from './willpower.service';

interface AcmStats { spiritual: number; physical: number; clarity: number; pleasure: number; }
interface AcmData {
  success:       boolean;
  date:          string;
  completedCount: number;
  itemStates:    boolean[];
  stats:         AcmStats;
  sleepVitality: number;
  sleepBonus:    number;
  anhedoniaRisk: 'Low' | 'Medium' | 'High';
}
interface HrZone { name: string; minutes: number; min: number; max: number; }

const ITEM_LABELS = [
  'Alcohol Sobriety', 'Wake Up With God', 'Physical Training',
  'Deep Work: Dev',   'Deep Work: RedTeam', 'Deep Work: Artist',
  'Deep Work: Mech',  'Fasting',            'Hydration',          'Diet Discipline',
  'Sexual Sobriety',  'Protein Goal',       'Bonfire Routine',    'Supplements',
];

const STAT_META = [
  { key: 'spiritual', label: 'Spiritual Alignment', icon: '✝', color: '#c8a84b' },
  { key: 'physical',  label: 'Physical Vitality',   icon: '⚔', color: '#e05c44' },
  { key: 'clarity',   label: 'Mental Clarity',      icon: '⚡', color: '#7b68ee' },
  { key: 'pleasure',  label: 'Pleasure Capacity',   icon: '◆', color: '#4caf6e' },
] as const;

@Component({
  selector: 'app-acm-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="acm-container">

      <!-- Loading -->
      <div *ngIf="isLoading()" class="acm-loading">
        <span class="acm-loading-icon">◈</span> Loading ACM data...
      </div>

      <ng-container *ngIf="!isLoading()">

        <!-- No data -->
        <div *ngIf="!data()" class="acm-empty">
          <span>◆</span>
          <p>No ACM data for today.</p>
          <p class="acm-empty-sub">Ensure today's journal entry exists (visit Dashboard to auto-create it).</p>
        </div>

        <ng-container *ngIf="data()">

          <!-- ── Header ── -->
          <div class="acm-header">
            <div class="acm-title-row">
              <h3 class="eso-panel-title">Action Consequence Matrix</h3>
              <span class="acm-date">{{ data()!.date }}</span>
            </div>
            <div class="acm-summary-row">
              <span class="acm-completion">{{ data()!.completedCount }}/{{ itemLabels.length }} disciplines</span>
              <span class="acm-sleep" *ngIf="data()!.sleepBonus > 0">
                💤 +{{ data()!.sleepBonus }} sleep bonus
              </span>
              <span class="acm-updating" *ngIf="isUpdating()">saving...</span>
            </div>
          </div>

          <!-- ── 4 Stat Bars ── -->
          <div class="stat-grid">
            <div *ngFor="let s of statMeta" class="stat-card">
              <div class="stat-header-row">
                <span class="stat-icon">{{ s.icon }}</span>
                <span class="stat-label">{{ s.label }}</span>
                <span class="stat-value" [style.color]="s.color">{{ statValue(s.key) }}/100</span>
              </div>
              <div class="stat-track">
                <div class="stat-fill"
                     [style.width.%]="statValue(s.key)"
                     [style.background]="s.color">
                </div>
              </div>
            </div>
          </div>

          <!-- ── Risk + XP Consolidation ── -->
          <div class="meta-row">
            <div class="risk-block">
              <span class="meta-label">Anhedonia Risk</span>
              <span class="risk-badge"
                    [style.color]="riskColor(data()!.anhedoniaRisk)"
                    [style.border-color]="riskColor(data()!.anhedoniaRisk)">
                {{ data()!.anhedoniaRisk }}
              </span>
            </div>
            <div class="con-block">
              <span class="meta-label">Est. XP Consolidation</span>
              <span class="con-value">~{{ xpConsolidation() }}%</span>
            </div>
          </div>

          <!-- ── 12 Discipline Checkboxes ── -->
          <div class="disciplines-section">
            <h4 class="disciplines-title">Daily Disciplines</h4>
            <div class="disciplines-grid">
              <button
                *ngFor="let label of itemLabels; let i = index"
                class="disc-item"
                [class.disc-checked]="data()!.itemStates[i]"
                [disabled]="isUpdating()"
                (click)="toggleItem(i)">
                <span class="disc-check">{{ data()!.itemStates[i] ? '✓' : '○' }}</span>
                <span class="disc-label">{{ label }}</span>
              </button>
            </div>
          </div>

          <!-- ── Physical Activity Breakdown ── -->
          <div class="activity-breakdown">
            <h4 class="hr-title">Physical Activity</h4>
            <div class="activity-row" *ngIf="steps()">
              <span class="ab-icon">👟</span>
              <span class="ab-label">Steps</span>
              <span class="ab-value">{{ steps()!.toLocaleString() }}</span>
            </div>
            <div class="activity-row" *ngIf="caloriesOut()">
              <span class="ab-icon">🔥</span>
              <span class="ab-label">Total Burn</span>
              <span class="ab-value">{{ caloriesOut()!.toLocaleString() }} kcal</span>
            </div>
            <div class="activity-row" *ngIf="activeZoneMins()">
              <span class="ab-icon">⚡</span>
              <span class="ab-label">Active Zone Min</span>
              <span class="ab-value"
                    [style.color]="activeZoneMins()! >= 22 ? '#4caf6e' : activeZoneMins()! >= 10 ? '#c8a84b' : '#aaa'">
                {{ activeZoneMins() }} AZM
              </span>
            </div>
            <div class="activity-row" *ngIf="lightlyActiveMins()">
              <span class="ab-icon">🚶</span>
              <span class="ab-label">Lightly Active</span>
              <span class="ab-value">{{ lightlyActiveMins() }} min</span>
            </div>
            <div class="activity-row" *ngIf="sedentaryMins()">
              <span class="ab-icon">💺</span>
              <span class="ab-label">Sedentary</span>
              <span class="ab-value"
                    [style.color]="sedentaryMins()! > 600 ? '#e05c44' : sedentaryMins()! > 480 ? '#c8a84b' : '#aaa'">
                {{ sedentaryMins() }} min
              </span>
            </div>
          </div>

          <!-- ── Heart Rate ── -->
          <div class="hr-section">
            <h4 class="hr-title">Heart Rate</h4>

            <!-- Resting HR -->
            <div class="hr-resting" *ngIf="restingHR(); else hrEmpty">
              <span class="hr-pulse">❤</span>
              <span class="hr-label">Resting HR</span>
              <span class="hr-value">{{ restingHR() }} bpm</span>
              <span class="hr-quality"
                    [style.color]="restingHR()! < 60 ? '#4caf6e' : restingHR()! < 70 ? '#c8a84b' : '#e05c44'">
                {{ restingHR()! < 60 ? 'Athletic' : restingHR()! < 70 ? 'Good' : 'Elevated' }}
              </span>
            </div>

            <!-- HR Zones -->
            <div class="hr-zones" *ngIf="heartZones().length > 0">
              <div *ngFor="let z of heartZones()" class="hr-zone">
                <span class="zone-icon">{{ zoneIcon(z.name) }}</span>
                <span class="zone-name">{{ z.name }}</span>
                <span class="zone-range">{{ z.min }}–{{ z.max }}&nbsp;bpm</span>
                <span class="zone-mins">{{ z.minutes }}&nbsp;min</span>
                <div class="zone-bar-track">
                  <div class="zone-bar-fill"
                       [style.width.%]="clamp(z.minutes / 60 * 100, 100)"
                       [style.background]="zoneColor(z.name)">
                  </div>
                </div>
              </div>
            </div>

            <!-- Re-auth prompt -->
            <ng-template #hrEmpty>
              <div class="hr-reauth">
                Heart rate data requires Fitbit re-authorization with the <code>heartrate</code> scope.<br>
                <a class="hr-reauth-link" [href]="fitbitAuthUrl" target="_blank" rel="noopener">
                  Re-authorize Fitbit →
                </a>
              </div>
            </ng-template>
          </div>

        </ng-container>
      </ng-container>
    </div>
  `,
  styles: [`
    .acm-container {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 4px 0;
    }
    /* ── Loading / Empty ── */
    .acm-loading, .acm-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 0;
      gap: 8px;
      color: #888;
      font-size: 13px;
    }
    .acm-loading-icon { font-size: 24px; margin-bottom: 4px; }
    .acm-empty > span  { font-size: 24px; }
    .acm-empty-sub { font-size: 11px; color: #555; text-align: center; }
    /* ── Header ── */
    .acm-header { display: flex; flex-direction: column; gap: 4px; }
    .acm-title-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
    }
    .acm-date { font-size: 11px; color: #777; letter-spacing: 0.06em; }
    .acm-summary-row { display: flex; gap: 12px; align-items: center; }
    .acm-completion { font-size: 12px; color: #c8a84b; }
    .acm-sleep     { font-size: 11px; color: #7b9cd4; }
    .acm-updating  { font-size: 11px; color: #888; font-style: italic; }
    /* ── 4 Stat bars ── */
    .stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .stat-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .stat-header-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    .stat-icon  { font-size: 14px; }
    .stat-label { flex: 1; color: #b0a89a; font-size: 11px; }
    .stat-value { font-size: 13px; font-weight: 600; }
    .stat-track {
      height: 6px;
      background: #2a2a4a;
      border-radius: 3px;
      overflow: hidden;
    }
    .stat-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.6s ease;
    }
    /* ── Meta: Risk + XP consolidation ── */
    .meta-row {
      display: flex;
      gap: 12px;
    }
    .risk-block, .con-block {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      padding: 8px 12px;
    }
    .meta-label { font-size: 11px; color: #888; flex: 1; }
    .risk-badge {
      font-size: 12px;
      font-weight: 700;
      border: 1px solid;
      border-radius: 12px;
      padding: 2px 10px;
      letter-spacing: 0.08em;
    }
    .con-value { font-size: 15px; font-weight: 700; color: #c8a84b; }
    /* ── Disciplines grid ── */
    .disciplines-section {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      padding: 12px;
    }
    .disciplines-title {
      font-size: 11px;
      font-weight: 600;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 0 0 10px;
    }
    .disciplines-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }
    .disc-item {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(255,255,255,0.02);
      border: 1px solid #2a2a4a;
      border-radius: 4px;
      padding: 6px 8px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      text-align: left;
      color: #888;
    }
    .disc-item:hover:not(:disabled) { background: rgba(255,255,255,0.06); border-color: #3a3a6a; }
    .disc-item:disabled { cursor: not-allowed; opacity: 0.6; }
    .disc-item.disc-checked {
      border-color: #3a5a3a;
      background: rgba(76, 175, 110, 0.08);
      color: #e0d5c0;
    }
    .disc-check {
      font-size: 13px;
      min-width: 16px;
    }
    .disc-item.disc-checked .disc-check { color: #4caf6e; }
    .disc-label { font-size: 10px; line-height: 1.3; }
    /* ── Heart Rate ── */
    .activity-breakdown {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(200,168,75,0.2);
      border-radius: 6px;
      padding: 10px 12px;
    }
    .activity-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      font-size: 0.82rem;
    }
    .activity-row:last-child { border-bottom: none; }
    .ab-icon { font-size: 1rem; min-width: 20px; }
    .ab-label { color: #9a8a6a; flex: 1; }
    .ab-value { font-weight: 600; color: #c8a84b; }
    .hr-section {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      padding: 12px;
    }
    .hr-title {
      font-size: 11px;
      font-weight: 600;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 0 0 10px;
    }
    .hr-resting {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .hr-pulse    { font-size: 16px; }
    .hr-label    { font-size: 12px; color: #888; flex: 1; }
    .hr-value    { font-size: 18px; font-weight: 700; color: #e0d5c0; }
    .hr-quality  { font-size: 11px; font-weight: 600; }
    .hr-zones    { display: flex; flex-direction: column; gap: 8px; }
    .hr-zone {
      display: grid;
      grid-template-columns: 20px 80px 90px 50px 1fr;
      align-items: center;
      gap: 8px;
      font-size: 11px;
    }
    .zone-icon  { text-align: center; }
    .zone-name  { color: #b0a89a; }
    .zone-range { color: #666; font-size: 10px; }
    .zone-mins  { color: #c8a84b; font-weight: 600; text-align: right; }
    .zone-bar-track {
      height: 5px;
      background: #2a2a4a;
      border-radius: 3px;
      overflow: hidden;
    }
    .zone-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.5s ease;
    }
    .hr-reauth {
      font-size: 11px;
      color: #666;
      line-height: 1.6;
    }
    .hr-reauth-link {
      color: #7b9cd4;
      text-decoration: none;
    }
    .hr-reauth-link:hover { text-decoration: underline; }
    code { background: rgba(255,255,255,0.08); border-radius: 3px; padding: 1px 4px; font-size: 10px; }
  `]
})
export class AcmPanelComponent implements OnInit, OnChanges {
  readonly statMeta    = STAT_META;
  readonly itemLabels  = ITEM_LABELS;
  readonly fitbitAuthUrl = `${environment.apiUrl}/api/fitbit/auth`;

  data               = signal<AcmData | null>(null);
  restingHR          = signal<number | null>(null);
  heartZones         = signal<HrZone[]>([]);
  activeZoneMins     = signal<number | null>(null);
  lightlyActiveMins  = signal<number | null>(null);
  sedentaryMins      = signal<number | null>(null);
  steps              = signal<number | null>(null);
  caloriesOut        = signal<number | null>(null);
  isLoading          = signal(true);
  isUpdating         = signal(false);

  private readonly http       = inject(HttpClient);
  private readonly willpower  = inject(WillpowerService);

  /** WP cost per discipline checked (12 items × 6 = up to 72 WP drained per full day) */
  private static readonly WP_PER_ITEM = 6;

  /** localStorage key tracking how many ACM items we've already accounted for in WP today */
  private static readonly ACM_SYNC_KEY = 'dp-wp-acm-sync';

  /** Date driven by the quests-panel date navigator. Empty string = show today. */
  @Input() selectedDate: string = '';

  get viewingDate(): string {
    return this.selectedDate || new Date().toLocaleDateString('en-CA');
  }

  get isViewingToday(): boolean {
    return this.viewingDate === new Date().toLocaleDateString('en-CA');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedDate'] && !changes['selectedDate'].firstChange) {
      this.data.set(null);
      this.restingHR.set(null);
      this.heartZones.set([]);
      this.isLoading.set(true);
      this.loadData();
    }
  }

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    const today = this.viewingDate;
    forkJoin({
      acm:        this.http.get<AcmData>(`${environment.apiUrl}/api/acm/today?date=${today}`),
      activities: this.http.get<any>(`${environment.apiUrl}/api/fitbit/activities/today?date=${today}`)
                    .pipe(catchError(() => of(null))),
      nutrition:  this.http.get<any>(`${environment.apiUrl}/api/fitbit/nutrition/today?date=${today}`)
                    .pipe(catchError(() => of(null))),
      vitals:     this.http.get<any>(`${environment.apiUrl}/api/fitbit/vitals/today?date=${today}`)
                    .pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ acm, activities, nutrition, vitals }) => {
        if (acm.success) {
          this.data.set(acm);
          if (this.isViewingToday) {
            this.syncWillpowerToAcm(acm.completedCount ?? 0);
          }
          this.autoCheckFromFitbit(acm, nutrition, vitals);
        }
        if (activities?.success) {
          this.restingHR.set(activities.restingHR ?? null);
          this.heartZones.set((activities.heartZones ?? []).filter((z: HrZone) => z.minutes > 0));
          this.activeZoneMins.set(activities.activeZoneMinutes ?? null);
          this.lightlyActiveMins.set(activities.lightlyActiveMinutes ?? null);
          this.sedentaryMins.set(activities.sedentaryMinutes ?? null);
          this.steps.set(activities.steps ?? null);
          this.caloriesOut.set(activities.caloriesOut ?? null);
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('[ACM Panel] Data load failed:', err);
        this.isLoading.set(false);
      },
    });
  }

  private autoCheckFromFitbit(acm: AcmData, nutrition: any, vitals: any): void {
    if (!this.isViewingToday) return; // Auto-check only applies to today
    const HYDRATION_IDX = 8;   // 'Hydration'
    const PROTEIN_IDX   = 11;  // 'Protein Goal' (was 12 — shifted after brush teeth removal Jun 2026)

    const indicesToCheck: number[] = [];

    // Hydration: auto-check if Fitbit water log >= 100 fl oz
    if (vitals?.success && (vitals.waterOz ?? 0) >= 100 && !acm.itemStates[HYDRATION_IDX]) {
      console.log(`[ACM Auto] ✅ Hydration goal met: ${vitals.waterOz} oz ≥ 100 oz`);
      indicesToCheck.push(HYDRATION_IDX);
    }

    // Protein: auto-check if logged protein >= 0.64g × body weight (lbs)
    if (nutrition?.success && vitals?.success && vitals.weight != null && nutrition.totals?.protein != null) {
      const proteinGoal = vitals.weight * 0.64;
      if (nutrition.totals.protein >= proteinGoal && !acm.itemStates[PROTEIN_IDX]) {
        console.log(`[ACM Auto] ✅ Protein goal met: ${nutrition.totals.protein}g ≥ ${proteinGoal.toFixed(1)}g`);
        indicesToCheck.push(PROTEIN_IDX);
      }
    }

    if (indicesToCheck.length === 0) return;

    // Batch-update both in one POST to avoid isUpdating race condition
    const newStates = [...acm.itemStates];
    indicesToCheck.forEach(i => { newStates[i] = true; });
    const newCount = newStates.filter(Boolean).length;

    this.data.update(d => d ? { ...d, itemStates: newStates, completedCount: newCount } : d);
    indicesToCheck.forEach(() => this.willpower.deplete(AcmPanelComponent.WP_PER_ITEM));
    this.saveAcmSyncBaseline(newCount);

    const today = this.viewingDate;
    this.isUpdating.set(true);
    this.http.post<any>(`${environment.apiUrl}/api/action-log`, { date: today, actionItems: newStates })
      .subscribe({
        next: () => {
          this.http.get<AcmData>(`${environment.apiUrl}/api/acm/today?date=${today}`).subscribe({
            next: (fresh) => {
              if (fresh.success) {
                this.data.set(fresh);
                this.syncWillpowerToAcm(fresh.completedCount ?? 0);
              }
              this.isUpdating.set(false);
            },
            error: () => this.isUpdating.set(false),
          });
        },
        error: (err) => {
          console.error('[ACM] autoCheckFromFitbit POST /api/action-log failed:', err);
          // Revert on failure
          this.data.update(d => d ? { ...d, itemStates: acm.itemStates, completedCount: acm.completedCount } : d);
          this.isUpdating.set(false);
        },
      });
  }

  toggleItem(index: number): void {
    const current = this.data();
    if (!current || this.isUpdating()) return;

    // Optimistic update
    const newStates = [...current.itemStates];
    newStates[index] = !newStates[index];
    this.data.update(d => d ? { ...d, itemStates: newStates, completedCount: newStates.filter(Boolean).length } : d);

    const newCount = newStates.filter(Boolean).length;

    // Willpower: checking costs WP (discipline is exhausting), unchecking restores it
    if (newStates[index]) {
      this.willpower.deplete(AcmPanelComponent.WP_PER_ITEM);
    } else {
      this.willpower.regenerate(AcmPanelComponent.WP_PER_ITEM);
    }
    // Persist the new baseline BEFORE the HTTP call so a mid-flight refresh won't double-drain
    this.saveAcmSyncBaseline(newCount);

    this.isUpdating.set(true);
    const today = this.viewingDate;

    this.http.post<any>(`${environment.apiUrl}/api/action-log`, { date: today, actionItems: newStates })
      .subscribe({
        next: () => {
          // Recompute stats from backend after toggling
          this.http.get<AcmData>(`${environment.apiUrl}/api/acm/today?date=${today}`).subscribe({
            next: (fresh) => {
              if (fresh.success) {
                this.data.set(fresh);
                // No double-drain risk: saveAcmSyncBaseline already ran before the HTTP call
                this.syncWillpowerToAcm(fresh.completedCount ?? 0);
              }
              this.isUpdating.set(false);
            },
            error: () => this.isUpdating.set(false),
          });
        },
        error: (err) => {
          console.error('[ACM] toggleItem POST /api/action-log failed:', err);
          // Revert on failure
          this.data.update(d => d ? { ...d, itemStates: current.itemStates, completedCount: current.completedCount } : d);
          this.isUpdating.set(false);
        },
      });
  }

  /**
   * On page load, drain (or regenerate) WP for the gap between what's already been
   * accounted for today (localStorage baseline) and the actual checked count from the backend.
   * Prevents WP showing 100 when items are already checked after a refresh.
   */
  private syncWillpowerToAcm(checkedCount: number): void {
    const today = new Date().toLocaleDateString('en-CA');
    let prevCount = 0;
    try {
      const raw = localStorage.getItem(AcmPanelComponent.ACM_SYNC_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.date === today) prevCount = parsed.count ?? 0;
        // Different date → treat as 0 (new day, no prior WP already drained)
      }
    } catch {}

    const deficit = checkedCount - prevCount;
    if (deficit > 0) {
      this.willpower.deplete(deficit * AcmPanelComponent.WP_PER_ITEM);
    } else if (deficit < 0) {
      // Items were unchecked in another session (e.g. different tab)
      this.willpower.regenerate(Math.abs(deficit) * AcmPanelComponent.WP_PER_ITEM);
    }
    this.saveAcmSyncBaseline(checkedCount);
  }

  private saveAcmSyncBaseline(count: number): void {
    const today = new Date().toLocaleDateString('en-CA');
    try {
      localStorage.setItem(AcmPanelComponent.ACM_SYNC_KEY, JSON.stringify({ date: today, count }));
    } catch {}
  }

  statValue(key: string): number {
    const d = this.data();
    return d ? (d.stats as any)[key] : 0;
  }

  riskColor(risk: string): string {
    if (risk === 'Low')    return '#4caf6e';
    if (risk === 'Medium') return '#f5c842';
    return '#e05c44';
  }

  zoneColor(name: string): string {
    if (name === 'Peak')   return '#e05c44';
    if (name === 'Cardio') return '#f5a623';
    return '#f5c842';
  }

  zoneIcon(name: string): string {
    if (name === 'Peak')   return '❤';
    if (name === 'Cardio') return '🧡';
    return '💛';
  }

  clamp(value: number, max: number): number {
    return Math.min(value, max);
  }

  /** Estimate XP consolidation from average ACM stat score (50% base + up to 40% bonus) */
  xpConsolidation(): number {
    const d = this.data();
    if (!d) return 50;
    const avg = (d.stats.spiritual + d.stats.physical + d.stats.clarity + d.stats.pleasure) / 4;
    return Math.round(50 + (avg / 100) * 40);
  }
}
