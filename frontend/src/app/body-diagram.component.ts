import { Component, OnInit, OnDestroy, OnChanges, Input, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BodyStatusService } from './body-status.service';
import { BodyStatus, BodyPart, StatusType, bodyPartLabel } from './body-status.interface';
import { BodyStatusModalComponent } from './body-status-modal.component';
import { Subscription } from 'rxjs';

/**
 * Health-tab body status manager. Logging happens by tapping a region on the
 * 3D character (or + ADD, which opens the same modal). The flat SVG silhouette
 * that used to own the tap zones has been retired; this panel keeps the
 * summary, filters, and Active Conditions list.
 */
@Component({
  selector: 'app-body-diagram',
  standalone: true,
  imports: [CommonModule, BodyStatusModalComponent],
  template: `
    <section class="eso-panel bs-panel">

      <div class="bs-header">
        <h3 class="eso-panel-title">Body Status</h3>
        <div class="bs-header-actions">
          <div class="bs-filter-tabs">
            <button type="button" class="bs-filter-tab" [class.bs-ft-active]="activeFilter === 'all'"     (click)="activeFilter = 'all'">All</button>
            <button type="button" class="bs-filter-tab" [class.bs-ft-active]="activeFilter === 'injury'"  (click)="activeFilter = 'injury'">🤕 Injury</button>
            <button type="button" class="bs-filter-tab" [class.bs-ft-active]="activeFilter === 'illness'" (click)="activeFilter = 'illness'">🤒 Illness</button>
            <button type="button" class="bs-filter-tab" [class.bs-ft-active]="activeFilter === 'disease'" (click)="activeFilter = 'disease'">🦠 Disease</button>
          </div>
          <button type="button" class="bs-add-btn" (click)="showAddModal()">+ ADD</button>
        </div>
      </div>

      <div class="bs-summary">
        <div class="bs-badge" [class.bs-badge-on]="summary.injuries  > 0">
          <span class="bs-badge-icon">🤕</span>
          <span class="bs-badge-count">{{ summary.injuries }}</span>
          <span class="bs-badge-lbl">Injuries</span>
        </div>
        <div class="bs-badge" [class.bs-badge-on]="summary.illnesses > 0">
          <span class="bs-badge-icon">🤒</span>
          <span class="bs-badge-count">{{ summary.illnesses }}</span>
          <span class="bs-badge-lbl">Illnesses</span>
        </div>
        <div class="bs-badge" [class.bs-badge-on]="summary.diseases  > 0">
          <span class="bs-badge-icon">🦠</span>
          <span class="bs-badge-count">{{ summary.diseases }}</span>
          <span class="bs-badge-lbl">Diseases</span>
        </div>
        <div class="bs-badge bs-badge-crit" [class.bs-badge-on]="summary.critical > 0">
          <span class="bs-badge-icon">⚠</span>
          <span class="bs-badge-count">{{ summary.critical }}</span>
          <span class="bs-badge-lbl">Critical</span>
        </div>
      </div>

      <p class="bs-log-hint">Tap a region on the 3D character to log a condition. Markers on the model open that condition here.</p>

      <div class="bs-conditions">
        <div class="bs-cond-header">
          <span class="bs-cond-title">ACTIVE CONDITIONS</span>
          <span class="bs-cond-count">{{ getFilteredStatuses().length }}</span>
        </div>

        <div class="bs-empty" *ngIf="activeStatuses.length === 0">
          <span class="bs-empty-icon">✅</span>
          <span>No active conditions</span>
          <span class="bs-empty-sub">Tap a body region on the character model, or use + ADD</span>
        </div>

        <div class="bs-cond-list" *ngIf="activeStatuses.length > 0">
          <div *ngFor="let status of getFilteredStatuses()"
               class="bs-cond-card"
               [class.bs-cond-sel]="selectedStatus?.id === status.id"
               (click)="selectStatus(status)">

            <div class="bs-cond-card-hdr">
              <span class="bs-cond-type-icon">{{ getStatusIcon(status.type) }}</span>
              <div class="bs-cond-info">
                <span class="bs-cond-name">{{ status.name }}</span>
                <span class="bs-cond-loc">{{ formatBodyPart(status.bodyPart) }}</span>
              </div>
              <span class="bs-sev-badge bs-sev-{{status.severity}}">{{ status.severity }}</span>
            </div>

            <p class="bs-cond-desc">{{ status.description }}</p>

            <div *ngIf="status.estimatedRecoveryDays" class="bs-recovery">
              <div class="bs-recovery-meta">
                <span class="bs-recovery-label">Recovery</span>
                <span class="bs-recovery-days">{{ getRemainingDays(status) }}d remaining</span>
              </div>
              <div class="bs-recovery-track">
                <div class="bs-recovery-fill" [style.width.%]="getRecoveryPercentage(status)"></div>
              </div>
            </div>

            <div *ngIf="status.xpPenalty" class="bs-penalty">
              <span class="bs-penalty-icon">⚠</span>
              <span class="bs-penalty-text">−{{ status.xpPenalty }}% XP on: {{ (status.impactsActions || []).join(', ') }}</span>
            </div>

            <div class="bs-cond-date">
              <span>Started {{ formatDate(status.startDate) }}</span>
              <span class="bs-cond-days-ago">({{ getDaysSince(status.startDate) }}d ago)</span>
            </div>

            <div class="bs-cond-actions" (click)="$event.stopPropagation()">
              <button type="button" class="bs-act-btn bs-act-edit"   (click)="editStatus(status)">✏ Edit</button>
              <button type="button" class="bs-act-btn bs-act-heal"   (click)="markHealed(status)">✓ Healed</button>
              <button type="button" class="bs-act-btn bs-act-remove" (click)="removeStatus(status)">✕</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <app-body-status-modal></app-body-status-modal>
  `,
  styles: [`
    :host { display: block; }
    .bs-panel {
      background: var(--eso-bg-panel, #100e07);
      border: 1px solid var(--eso-border, rgba(155,115,38,0.45));
      padding: 16px 18px;
      font-family: 'Cinzel', serif;
    }

    .bs-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      flex-wrap: wrap; gap: 8px; margin-bottom: 14px;
    }
    .bs-header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .bs-filter-tabs    { display: flex; gap: 4px; flex-wrap: wrap; }
    .bs-filter-tab {
      background: transparent;
      border: 1px solid rgba(155,115,38,0.28);
      color: var(--eso-text-dim, #a08858);
      font-size: 10px; letter-spacing: 0.5px;
      padding: 4px 9px; cursor: pointer; font-family: 'Cinzel', serif;
      transition: all 0.14s;
    }
    .bs-filter-tab:hover { border-color: rgba(201,168,76,0.5); color: var(--eso-text, #e2cfa8); }
    .bs-ft-active {
      border-color: var(--eso-gold, #c9a84c);
      color: var(--eso-gold, #c9a84c);
      background: rgba(201,168,76,0.08);
    }
    .bs-add-btn {
      background: transparent;
      border: 1px solid var(--eso-gold, #c9a84c);
      color: var(--eso-gold, #c9a84c);
      font-size: 10px; letter-spacing: 1px;
      padding: 4px 12px; cursor: pointer; font-family: 'Cinzel', serif;
      transition: all 0.14s;
    }
    .bs-add-btn:hover { background: rgba(201,168,76,0.12); }

    .bs-summary { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .bs-badge {
      flex: 1; min-width: 80px;
      display: flex; align-items: center; gap: 6px;
      background: var(--eso-bg-panel-alt, #1a1408);
      border: 1px solid rgba(155,115,38,0.22);
      padding: 8px 10px;
      opacity: 0.45; transition: all 0.2s;
    }
    .bs-badge-on   { opacity: 1; border-color: rgba(155,115,38,0.65); box-shadow: 0 0 10px rgba(201,168,76,0.07); }
    .bs-badge-crit.bs-badge-on { border-color: rgba(224,92,68,0.7); background: rgba(224,92,68,0.06); }
    .bs-badge-icon  { font-size: 18px; }
    .bs-badge-count { font-size: 20px; font-weight: 700; color: var(--eso-text-bright, #fff8e8); min-width: 18px; }
    .bs-badge-lbl   { font-size: 9px; color: var(--eso-text-dim, #a08858); letter-spacing: 1px; text-transform: uppercase; }

    .bs-log-hint {
      margin: 0 0 14px 0;
      font-size: 11px;
      color: var(--eso-text-dim, #a08858);
      font-family: sans-serif;
      font-style: italic;
    }

    .bs-conditions { display: flex; flex-direction: column; gap: 8px; }
    .bs-cond-header {
      display: flex; align-items: center; justify-content: space-between;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(155,115,38,0.20);
    }
    .bs-cond-title { font-size: 9px; letter-spacing: 2px; color: var(--eso-text-dim, #a08858); text-transform: uppercase; }
    .bs-cond-count {
      font-size: 11px; font-weight: 700;
      color: var(--eso-gold, #c9a84c);
      background: rgba(201,168,76,0.10);
      padding: 1px 7px;
      border: 1px solid rgba(201,168,76,0.25);
    }

    .bs-empty {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 32px 16px; text-align: center;
      color: var(--eso-text-dim, #a08858); font-size: 12px;
    }
    .bs-empty-icon { font-size: 28px; }
    .bs-empty-sub  { font-size: 10px; opacity: 0.65; font-family: sans-serif; font-style: italic; }

    .bs-cond-list { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 460px; }
    .bs-cond-card {
      background: var(--eso-bg-panel-alt, #1a1408);
      border: 1px solid rgba(155,115,38,0.28);
      padding: 10px 12px;
      cursor: pointer; transition: border-color 0.14s, background 0.14s;
    }
    .bs-cond-card:hover { border-color: rgba(201,168,76,0.45); background: rgba(201,168,76,0.04); }
    .bs-cond-sel        { border-color: var(--eso-gold, #c9a84c) !important; background: rgba(201,168,76,0.08) !important; }

    .bs-cond-card-hdr { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .bs-cond-type-icon { font-size: 18px; flex-shrink: 0; }
    .bs-cond-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .bs-cond-name { font-size: 12px; font-weight: 700; color: var(--eso-text, #e2cfa8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bs-cond-loc  { font-size: 9px; color: var(--eso-text-dim, #a08858); letter-spacing: 0.5px; }

    .bs-sev-badge { font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 2px 6px; border: 1px solid currentColor; flex-shrink: 0; }
    .bs-sev-minor    { color: #6fcf7d; }
    .bs-sev-moderate { color: #e6a833; }
    .bs-sev-severe   { color: #f28c28; }
    .bs-sev-critical { color: #e05c44; }

    .bs-cond-desc { font-size: 11px; color: var(--eso-text-dim, #a08858); margin: 0 0 8px 0; font-family: sans-serif; line-height: 1.4; }

    .bs-recovery { margin-bottom: 8px; }
    .bs-recovery-meta  { display: flex; justify-content: space-between; margin-bottom: 3px; }
    .bs-recovery-label { font-size: 9px; color: var(--eso-text-dim, #a08858); letter-spacing: 0.5px; text-transform: uppercase; }
    .bs-recovery-days  { font-size: 9px; color: var(--eso-text, #e2cfa8); }
    .bs-recovery-track { height: 4px; background: rgba(0,0,0,0.5); border: 1px solid rgba(155,115,38,0.2); }
    .bs-recovery-fill  { height: 100%; background: linear-gradient(90deg, var(--eso-gold, #c9a84c), #6fcf7d); transition: width 0.4s; }

    .bs-penalty {
      display: flex; align-items: center; gap: 5px;
      background: rgba(224,92,68,0.08); border-left: 2px solid #e05c44;
      padding: 4px 8px; margin-bottom: 8px;
    }
    .bs-penalty-icon { color: #e05c44; font-size: 11px; }
    .bs-penalty-text { font-size: 10px; color: var(--eso-text-dim, #a08858); font-family: sans-serif; }

    .bs-cond-date { font-size: 9px; color: rgba(160,136,88,0.65); margin-bottom: 8px; display: flex; gap: 4px; }
    .bs-cond-days-ago { opacity: 0.7; }

    .bs-cond-actions { display: flex; gap: 6px; }
    .bs-act-btn {
      background: transparent; border: 1px solid rgba(155,115,38,0.28);
      color: var(--eso-text-dim, #a08858); font-size: 10px; letter-spacing: 0.5px;
      padding: 3px 8px; cursor: pointer; font-family: 'Cinzel', serif;
      transition: all 0.14s;
    }
    .bs-act-edit:hover   { border-color: var(--eso-gold, #c9a84c); color: var(--eso-gold, #c9a84c); }
    .bs-act-heal:hover   { border-color: #6fcf7d; color: #6fcf7d; }
    .bs-act-remove:hover { border-color: #e05c44; color: #e05c44; }

    @media (max-width: 600px) {
      .bs-summary  { flex-wrap: nowrap; gap: 5px; }
      .bs-badge    { min-width: 60px; padding: 6px 7px; }
      .bs-badge-count { font-size: 16px; }
      .bs-badge-icon  { font-size: 14px; }
      .bs-cond-list   { max-height: unset; }
    }
  `]
})
export class BodyDiagramComponent implements OnInit, OnChanges, OnDestroy {
  @Input() characterLevel = 20;
  /** Set by the dashboard when a 3D-model body-status marker was clicked — highlights that status. */
  @Input() preSelectedStatusId: string | null = null;

  @ViewChild(BodyStatusModalComponent) statusModal?: BodyStatusModalComponent;

  activeStatuses: BodyStatus[] = [];
  selectedStatus: BodyStatus | null = null;
  activeFilter: 'all' | StatusType = 'all';
  summary = {
    totalActive: 0,
    injuries: 0,
    illnesses: 0,
    diseases: 0,
    critical: 0
  };

  private subscription: Subscription | null = null;

  constructor(private bodyStatusService: BodyStatusService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['preSelectedStatusId'] && !changes['preSelectedStatusId'].firstChange) {
      this.applyPreselection();
    }
  }

  ngOnInit(): void {
    this.subscription = this.bodyStatusService.getStatuses().subscribe(() => {
      this.activeStatuses = this.bodyStatusService.getActiveStatuses();
      this.summary = this.bodyStatusService.getSummary();
      this.applyPreselection();
    });

    // Sync injuries from journal (source of truth) on every open
    this.bodyStatusService.syncFromJournal();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  getFilteredStatuses(): BodyStatus[] {
    if (this.activeFilter === 'all') return this.activeStatuses;
    return this.activeStatuses.filter(s => s.type === this.activeFilter);
  }

  selectStatus(status: BodyStatus): void {
    this.selectedStatus = status;
  }

  showAddModal(): void {
    this.statusModal?.openCreate();
  }

  editStatus(status: BodyStatus): void {
    this.statusModal?.openEdit(status);
  }

  markHealed(status: BodyStatus): void {
    if (confirm(`Mark "${status.name}" as healed?`)) {
      this.bodyStatusService.markHealed(status.id);
    }
  }

  removeStatus(status: BodyStatus): void {
    if (confirm(`Remove "${status.name}" from records?`)) {
      this.bodyStatusService.removeStatus(status.id);
    }
  }

  getStatusIcon(type: StatusType): string {
    const icons = {
      injury: '🤕',
      illness: '🤒',
      disease: '🦠'
    };
    return icons[type];
  }

  formatBodyPart(bodyPart: BodyPart): string {
    return bodyPartLabel(bodyPart);
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  getDaysSince(date: Date): number {
    return this.bodyStatusService.getDaysSince(date);
  }

  getRemainingDays(status: BodyStatus): number {
    return this.bodyStatusService.getRemainingDays(status);
  }

  getRecoveryPercentage(status: BodyStatus): number {
    return this.bodyStatusService.getRecoveryPercentage(status);
  }

  private applyPreselection(): void {
    if (!this.preSelectedStatusId) return;
    const match = this.activeStatuses.find(s => s.id === this.preSelectedStatusId);
    if (!match) return;
    if (this.activeFilter !== 'all' && match.type !== this.activeFilter) {
      this.activeFilter = 'all';
    }
    this.selectStatus(match);
  }
}
