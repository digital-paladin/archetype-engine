import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BodyStatusService } from './body-status.service';
import { BodyStatus, BodyPart, StatusType, Severity, BodyPartLocation } from './body-status.interface';
import { Subscription } from 'rxjs';

// Local type used only for zone-colour lookup (avoids importing Severity externally)
type SeverityRank = 'minor' | 'moderate' | 'severe' | 'critical';

@Component({
  selector: 'app-body-diagram',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="eso-panel bs-panel">

      <!-- ── Header ─────────────────────────────────────────────── -->
      <div class="bs-header">
        <h3 class="eso-panel-title">Body Status</h3>
        <div class="bs-header-actions">
          <div class="bs-filter-tabs">
            <button class="bs-filter-tab" [class.bs-ft-active]="activeFilter === 'all'"     (click)="activeFilter = 'all'">All</button>
            <button class="bs-filter-tab" [class.bs-ft-active]="activeFilter === 'injury'"  (click)="activeFilter = 'injury'">🤕 Injury</button>
            <button class="bs-filter-tab" [class.bs-ft-active]="activeFilter === 'illness'" (click)="activeFilter = 'illness'">🤒 Illness</button>
            <button class="bs-filter-tab" [class.bs-ft-active]="activeFilter === 'disease'" (click)="activeFilter = 'disease'">🦠 Disease</button>
          </div>
          <button class="bs-add-btn" (click)="showAddModal()">+ ADD</button>
        </div>
      </div>

      <!-- ── Summary Strip ──────────────────────────────────────── -->
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

      <!-- ── Two-pane body ──────────────────────────────────────── -->
      <div class="bs-body">

        <!-- LEFT: SVG body map -->
        <div class="bs-map-wrap">
          <div class="bs-map-label">TAP ZONE TO LOG</div>
          <svg class="bs-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
            <!-- Silhouette outlines (decorative) -->
            <ellipse cx="50" cy="9"  rx="5.5" ry="6"   fill="rgba(201,168,76,0.04)" stroke="rgba(201,168,76,0.18)" stroke-width="0.5"/>
            <rect x="47" y="15" width="6"  height="5"  rx="1" fill="rgba(201,168,76,0.04)" stroke="rgba(201,168,76,0.12)" stroke-width="0.4"/>
            <rect x="38" y="20" width="24" height="28" rx="2" fill="rgba(201,168,76,0.04)" stroke="rgba(201,168,76,0.15)" stroke-width="0.4"/>
            <rect x="25" y="22" width="12" height="36" rx="3" fill="rgba(201,168,76,0.04)" stroke="rgba(201,168,76,0.12)" stroke-width="0.4"/>
            <rect x="63" y="22" width="12" height="36" rx="3" fill="rgba(201,168,76,0.04)" stroke="rgba(201,168,76,0.12)" stroke-width="0.4"/>
            <rect x="39" y="50" width="10" height="44" rx="3" fill="rgba(201,168,76,0.04)" stroke="rgba(201,168,76,0.12)" stroke-width="0.4"/>
            <rect x="51" y="50" width="10" height="44" rx="3" fill="rgba(201,168,76,0.04)" stroke="rgba(201,168,76,0.12)" stroke-width="0.4"/>
            <!-- Interactive zone circles -->
            <g *ngFor="let loc of bodyPartLocations; trackBy: trackByBodyPart"
               (click)="selectBodyPart(loc.bodyPart)"
               style="cursor:pointer">
              <circle
                [attr.cx]="loc.x"
                [attr.cy]="loc.y"
                r="3.5"
                [attr.fill]="getZoneFill(loc.bodyPart)"
                [attr.stroke]="getZoneStroke(loc.bodyPart)"
                stroke-width="0.8"
                [class.bs-zone-hit]="hasStatus(loc.bodyPart)">
              </circle>
            </g>
          </svg>
        </div>

        <!-- RIGHT: Active conditions list -->
        <div class="bs-conditions">
          <div class="bs-cond-header">
            <span class="bs-cond-title">ACTIVE CONDITIONS</span>
            <span class="bs-cond-count">{{ getFilteredStatuses().length }}</span>
          </div>

          <div class="bs-empty" *ngIf="activeStatuses.length === 0">
            <span class="bs-empty-icon">✅</span>
            <span>No active conditions</span>
            <span class="bs-empty-sub">Tap a body zone to log an injury, illness, or disease</span>
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
                <button class="bs-act-btn bs-act-edit"   (click)="editStatus(status)">✏ Edit</button>
                <button class="bs-act-btn bs-act-heal"   (click)="markHealed(status)">✓ Healed</button>
                <button class="bs-act-btn bs-act-remove" (click)="removeStatus(status)">✕</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Add / Edit Modal ───────────────────────────────────────── -->
    <div class="bs-modal-overlay" *ngIf="showModal" (click)="closeModal()">
      <div class="bs-modal" (click)="$event.stopPropagation()">
        <div class="bs-modal-hdr">
          <span class="bs-modal-title">{{ editingStatus ? 'EDIT CONDITION' : 'LOG CONDITION' }}</span>
          <button class="bs-modal-close" (click)="closeModal()">✕</button>
        </div>
        <div class="bs-modal-form">
          <div class="bs-field">
            <label class="bs-field-lbl">Body Part</label>
            <select class="bs-field-ctrl" [(ngModel)]="modalData.bodyPart">
              <option *ngFor="let part of availableBodyParts" [value]="part.value">{{ part.label }}</option>
            </select>
          </div>
          <div class="bs-field-row">
            <div class="bs-field">
              <label class="bs-field-lbl">Type</label>
              <select class="bs-field-ctrl" [(ngModel)]="modalData.type">
                <option value="injury">🤕 Injury</option>
                <option value="illness">🤒 Illness</option>
                <option value="disease">🦠 Disease</option>
              </select>
            </div>
            <div class="bs-field">
              <label class="bs-field-lbl">Severity</label>
              <select class="bs-field-ctrl" [(ngModel)]="modalData.severity">
                <option value="minor">Minor</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
                <option value="critical">⚠ Critical</option>
              </select>
            </div>
          </div>
          <div class="bs-field">
            <label class="bs-field-lbl">Name</label>
            <input class="bs-field-ctrl" [(ngModel)]="modalData.name" placeholder="e.g., Shoulder strain" />
          </div>
          <div class="bs-field">
            <label class="bs-field-lbl">Description</label>
            <textarea class="bs-field-ctrl bs-field-ta" [(ngModel)]="modalData.description"
              placeholder="Symptoms, how it happened..." rows="3"></textarea>
          </div>
          <div class="bs-field-row">
            <div class="bs-field">
              <label class="bs-field-lbl">Recovery Days</label>
              <input class="bs-field-ctrl" type="number" [(ngModel)]="modalData.estimatedRecoveryDays" placeholder="e.g., 7" />
            </div>
            <div class="bs-field">
              <label class="bs-field-lbl">XP Penalty (%)</label>
              <input class="bs-field-ctrl" type="number" [(ngModel)]="modalData.xpPenalty" placeholder="0–100" min="0" max="100" />
            </div>
          </div>
          <div class="bs-field">
            <label class="bs-field-lbl">Impacts Actions (comma-separated)</label>
            <input class="bs-field-ctrl" [(ngModel)]="modalData.impactsActionsStr" placeholder="e.g., workout, coding" />
          </div>
          <div class="bs-field">
            <label class="bs-field-lbl">Notes</label>
            <textarea class="bs-field-ctrl bs-field-ta" [(ngModel)]="modalData.notes"
              placeholder="Treatment, medications, notes..." rows="2"></textarea>
          </div>
        </div>
        <div class="bs-modal-footer">
          <button class="bs-modal-confirm" (click)="confirmModal()">{{ editingStatus ? '💾 Update' : '➕ Add' }}</button>
          <button class="bs-modal-cancel"  (click)="closeModal()">Cancel</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* ── ESO Body Status Panel ───────────────────────────────────── */
    :host { display: block; }
    .bs-panel {
      background: var(--eso-bg-panel, #100e07);
      border: 1px solid var(--eso-border, rgba(155,115,38,0.45));
      padding: 16px 18px;
      font-family: 'Cinzel', serif;
    }

    /* ── Header ─────────────────────────────────────────────────── */
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

    /* ── Summary Strip ───────────────────────────────────────────── */
    .bs-summary { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
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

    /* ── Two-pane layout ─────────────────────────────────────────── */
    .bs-body { display: flex; gap: 18px; align-items: flex-start; }

    /* ── LEFT: SVG body map ──────────────────────────────────────── */
    .bs-map-wrap {
      flex-shrink: 0; width: 160px;
      display: flex; flex-direction: column; align-items: center; gap: 6px;
    }
    .bs-map-label {
      font-size: 8px; letter-spacing: 1.5px; color: var(--eso-text-dim, #a08858);
      text-transform: uppercase; opacity: 0.6;
    }
    .bs-svg {
      width: 140px; height: 280px;
      background: rgba(0,0,0,0.25);
      border: 1px solid rgba(155,115,38,0.20);
    }
    .bs-zone-hit { animation: bs-zone-pulse 2s ease-in-out infinite; }
    @keyframes bs-zone-pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.55; }
    }

    /* ── RIGHT: Conditions list ──────────────────────────────────── */
    .bs-conditions { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
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

    /* ── Modal ───────────────────────────────────────────────────── */
    .bs-modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.72);
      display: flex; align-items: center; justify-content: center;
      z-index: 3000;
    }
    .bs-modal {
      background: var(--eso-bg-panel, #100e07);
      border: 1px solid rgba(201,168,76,0.45);
      width: 90%; max-width: 440px;
      max-height: 88vh; overflow-y: auto;
      padding: 20px 22px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7);
    }
    .bs-modal-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .bs-modal-title { font-size: 12px; letter-spacing: 2px; color: var(--eso-gold, #c9a84c); text-transform: uppercase; }
    .bs-modal-close { background: transparent; border: none; color: var(--eso-text-dim, #a08858); font-size: 14px; cursor: pointer; padding: 0; transition: color 0.14s; }
    .bs-modal-close:hover { color: #e05c44; }

    .bs-modal-form  { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
    .bs-field       { display: flex; flex-direction: column; gap: 4px; }
    .bs-field-row   { display: flex; gap: 10px; }
    .bs-field-row .bs-field { flex: 1; }
    .bs-field-lbl   { font-size: 9px; letter-spacing: 1px; color: var(--eso-text-dim, #a08858); text-transform: uppercase; }
    .bs-field-ctrl  {
      background: rgba(0,0,0,0.45); border: 1px solid rgba(201,168,76,0.28);
      color: var(--eso-text, #e2cfa8); font-size: 12px; font-family: 'Cinzel', serif;
      padding: 7px 10px; outline: none; transition: border-color 0.14s;
    }
    .bs-field-ctrl:focus { border-color: rgba(201,168,76,0.65); }
    .bs-field-ta    { resize: vertical; min-height: 60px; }
    select.bs-field-ctrl option { background: #1a1408; color: #e2cfa8; }

    .bs-modal-footer   { display: flex; gap: 8px; }
    .bs-modal-confirm  {
      flex: 1; background: var(--eso-gold, #c9a84c); border: none;
      color: #12100a; font-size: 12px; letter-spacing: 1px; font-weight: 700;
      padding: 10px 16px; cursor: pointer; font-family: 'Cinzel', serif;
      transition: background 0.14s;
    }
    .bs-modal-confirm:hover { background: var(--eso-gold-bright, #f2c96a); }
    .bs-modal-cancel   {
      flex: 0 0 90px; background: rgba(255,255,255,0.06);
      border: 1px solid rgba(155,115,38,0.3);
      color: var(--eso-text-dim, #a08858); font-size: 12px;
      padding: 10px; cursor: pointer; font-family: 'Cinzel', serif;
      transition: background 0.14s;
    }
    .bs-modal-cancel:hover { background: rgba(255,255,255,0.10); }

    /* ── Mobile ──────────────────────────────────────────────────── */
    @media (max-width: 600px) {
      .bs-body     { flex-direction: column; }
      .bs-map-wrap { width: 100%; }
      .bs-svg      { width: 100%; height: 220px; }
      .bs-summary  { flex-wrap: nowrap; gap: 5px; }
      .bs-badge    { min-width: 60px; padding: 6px 7px; }
      .bs-badge-count { font-size: 16px; }
      .bs-badge-icon  { font-size: 14px; }
      .bs-cond-list   { max-height: unset; }
      .bs-field-row   { flex-direction: column; }
    }
  `]
})
export class BodyDiagramComponent implements OnInit, OnDestroy {
  @Input() characterLevel = 20;

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

  showModal = false;
  editingStatus: BodyStatus | null = null;
  modalData: any = this.getEmptyModalData();

  bodyPartLocations: BodyPartLocation[] = [
    // Head & Neck
    { bodyPart: 'head', x: 50, y: 10, label: 'Head' },
    { bodyPart: 'neck', x: 50, y: 18, label: 'Neck' },
    
    // Shoulders
    { bodyPart: 'left-shoulder', x: 38, y: 24, label: 'Left Shoulder' },
    { bodyPart: 'right-shoulder', x: 62, y: 24, label: 'Right Shoulder' },
    
    // Arms
    { bodyPart: 'left-upper-arm', x: 32, y: 32, label: 'Left Upper Arm' },
    { bodyPart: 'right-upper-arm', x: 68, y: 32, label: 'Right Upper Arm' },
    { bodyPart: 'left-forearm', x: 28, y: 44, label: 'Left Forearm' },
    { bodyPart: 'right-forearm', x: 72, y: 44, label: 'Right Forearm' },
    { bodyPart: 'left-hand', x: 24, y: 54, label: 'Left Hand' },
    { bodyPart: 'right-hand', x: 76, y: 54, label: 'Right Hand' },
    
    // Torso
    { bodyPart: 'chest', x: 50, y: 32, label: 'Chest' },
    { bodyPart: 'abdomen', x: 50, y: 44, label: 'Abdomen' },
    { bodyPart: 'back-upper', x: 50, y: 28, label: 'Upper Back' },
    { bodyPart: 'back-lower', x: 50, y: 48, label: 'Lower Back' },
    
    // Hips & Legs
    { bodyPart: 'left-hip', x: 44, y: 54, label: 'Left Hip' },
    { bodyPart: 'right-hip', x: 56, y: 54, label: 'Right Hip' },
    { bodyPart: 'left-thigh', x: 44, y: 64, label: 'Left Thigh' },
    { bodyPart: 'right-thigh', x: 56, y: 64, label: 'Right Thigh' },
    { bodyPart: 'left-knee', x: 44, y: 74, label: 'Left Knee' },
    { bodyPart: 'right-knee', x: 56, y: 74, label: 'Right Knee' },
    { bodyPart: 'left-calf', x: 44, y: 82, label: 'Left Calf' },
    { bodyPart: 'right-calf', x: 56, y: 82, label: 'Right Calf' },
    { bodyPart: 'left-ankle', x: 44, y: 90, label: 'Left Ankle' },
    { bodyPart: 'right-ankle', x: 56, y: 90, label: 'Right Ankle' },
    { bodyPart: 'left-foot', x: 44, y: 96, label: 'Left Foot' },
    { bodyPart: 'right-foot', x: 56, y: 96, label: 'Right Foot' }
  ];

  availableBodyParts = this.bodyPartLocations.map(loc => ({
    value: loc.bodyPart,
    label: loc.label
  }));

  private subscription: Subscription | null = null;

  constructor(private bodyStatusService: BodyStatusService) {}

  ngOnInit(): void {
    this.subscription = this.bodyStatusService.getStatuses().subscribe(statuses => {
      this.activeStatuses = this.bodyStatusService.getActiveStatuses();
      this.summary = this.bodyStatusService.getSummary();
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

  trackByBodyPart(_index: number, loc: BodyPartLocation): string {
    return loc.bodyPart;
  }

  getZoneFill(bodyPart: BodyPart): string {
    const statuses = this.bodyStatusService.getStatusesByBodyPart(bodyPart);
    if (statuses.length === 0) return 'rgba(201,168,76,0.12)';
    const worst = statuses.reduce((a, b) => {
      const rank: Record<SeverityRank, number> = { minor: 1, moderate: 2, severe: 3, critical: 4 };
      return rank[a.severity as SeverityRank] >= rank[b.severity as SeverityRank] ? a : b;
    });
    const fills: Record<SeverityRank, string> = {
      minor:    'rgba(230,168,51,0.55)',
      moderate: 'rgba(242,140,40,0.65)',
      severe:   'rgba(224,92,68,0.70)',
      critical: 'rgba(204,0,0,0.80)'
    };
    return fills[worst.severity as SeverityRank];
  }

  getZoneStroke(bodyPart: BodyPart): string {
    const statuses = this.bodyStatusService.getStatusesByBodyPart(bodyPart);
    if (statuses.length === 0) return 'rgba(201,168,76,0.35)';
    const worst = statuses.reduce((a, b) => {
      const rank: Record<SeverityRank, number> = { minor: 1, moderate: 2, severe: 3, critical: 4 };
      return rank[a.severity as SeverityRank] >= rank[b.severity as SeverityRank] ? a : b;
    });
    const strokes: Record<SeverityRank, string> = {
      minor:    '#e6a833',
      moderate: '#f28c28',
      severe:   '#e05c44',
      critical: '#cc0000'
    };
    return strokes[worst.severity as SeverityRank];
  }

  getBodyPartLocation(bodyPart: BodyPart): BodyPartLocation {
    return this.bodyPartLocations.find(loc => loc.bodyPart === bodyPart) || 
      { bodyPart, x: 50, y: 50, label: bodyPart };
  }

  hasStatus(bodyPart: BodyPart): boolean {
    return this.bodyStatusService.getStatusesByBodyPart(bodyPart).length > 0;
  }

  selectBodyPart(bodyPart: BodyPart): void {
    this.modalData.bodyPart = bodyPart;
    this.showAddModal();
  }

  selectStatus(status: BodyStatus): void {
    this.selectedStatus = status;
  }

  showAddModal(): void {
    this.editingStatus = null;
    this.showModal = true;
  }

  editStatus(status: BodyStatus): void {
    this.editingStatus = status;
    this.modalData = {
      bodyPart: status.bodyPart,
      type: status.type,
      severity: status.severity,
      name: status.name,
      description: status.description,
      estimatedRecoveryDays: status.estimatedRecoveryDays,
      notes: status.notes,
      impactsActionsStr: status.impactsActions?.join(', ') || '',
      xpPenalty: status.xpPenalty
    };
    this.showModal = true;
  }

  closeModal(): void {
    this.showModal = false;
    this.editingStatus = null;
    this.modalData = this.getEmptyModalData();
  }

  confirmModal(): void {
    if (!this.modalData.name || !this.modalData.description) {
      alert('Please fill in name and description');
      return;
    }

    const impactsActions = this.modalData.impactsActionsStr
      ? this.modalData.impactsActionsStr.split(',').map((s: string) => s.trim())
      : undefined;

    if (this.editingStatus) {
      this.bodyStatusService.updateStatus(this.editingStatus.id, {
        bodyPart: this.modalData.bodyPart,
        type: this.modalData.type,
        severity: this.modalData.severity,
        name: this.modalData.name,
        description: this.modalData.description,
        estimatedRecoveryDays: this.modalData.estimatedRecoveryDays || undefined,
        notes: this.modalData.notes || undefined,
        impactsActions,
        xpPenalty: this.modalData.xpPenalty || undefined
      });
    } else {
      this.bodyStatusService.addStatus(
        this.modalData.bodyPart,
        this.modalData.type,
        this.modalData.severity,
        this.modalData.name,
        this.modalData.description,
        this.modalData.estimatedRecoveryDays || undefined,
        this.modalData.notes || undefined,
        impactsActions,
        this.modalData.xpPenalty || undefined
      );
    }

    this.closeModal();
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

  onCharacterClick(event: MouseEvent): void {
    // Handle clicks on character display area
    console.log('[BodyDiagram] Clicked character area');
  }

  onClose(): void {
    console.log('[BodyDiagram] Close requested');
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
    return this.bodyPartLocations.find(loc => loc.bodyPart === bodyPart)?.label || bodyPart;
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

  private getEmptyModalData(): any {
    return {
      bodyPart: 'chest',
      type: 'injury',
      severity: 'minor',
      name: '',
      description: '',
      estimatedRecoveryDays: null,
      notes: '',
      impactsActionsStr: '',
      xpPenalty: null
    };
  }
}
