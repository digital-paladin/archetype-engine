import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BodyStatusService } from './body-status.service';
import { BODY_PART_OPTIONS, BodyPart, BodyStatus, Severity, StatusType } from './body-status.interface';

interface BodyStatusForm {
  bodyPart: BodyPart;
  type: StatusType;
  severity: Severity;
  name: string;
  description: string;
  estimatedRecoveryDays: number | null;
  notes: string;
  impactsActionsStr: string;
  xpPenalty: number | null;
}

/**
 * The add/edit condition form previously embedded in the flat SVG body map.
 * Character-region taps and the Health list both open this same modal.
 */
@Component({
  selector: 'app-body-status-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bs-modal-overlay" *ngIf="visible" (click)="close()">
      <div class="bs-modal" (click)="$event.stopPropagation()">
        <div class="bs-modal-hdr">
          <span class="bs-modal-title">{{ editingStatus ? 'EDIT CONDITION' : 'LOG CONDITION' }}</span>
          <button type="button" class="bs-modal-close" (click)="close()">✕</button>
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
          <button type="button" class="bs-modal-confirm" (click)="confirm()">{{ editingStatus ? '💾 Update' : '➕ Add' }}</button>
          <button type="button" class="bs-modal-cancel" (click)="close()">Cancel</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
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
      font-family: 'Cinzel', serif;
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
    @media (max-width: 600px) {
      .bs-field-row { flex-direction: column; }
    }
  `]
})
export class BodyStatusModalComponent {
  readonly availableBodyParts = BODY_PART_OPTIONS;

  visible = false;
  editingStatus: BodyStatus | null = null;
  modalData: BodyStatusForm = this.emptyForm();

  constructor(private bodyStatusService: BodyStatusService) {}

  /** Opens the add form, pre-filled with the tapped body region. */
  openCreate(bodyPart: BodyPart = 'chest'): void {
    this.editingStatus = null;
    this.modalData = this.emptyForm(bodyPart);
    this.visible = true;
  }

  openEdit(status: BodyStatus): void {
    this.editingStatus = status;
    this.modalData = {
      bodyPart: status.bodyPart,
      type: status.type,
      severity: status.severity,
      name: status.name,
      description: status.description,
      estimatedRecoveryDays: status.estimatedRecoveryDays ?? null,
      notes: status.notes ?? '',
      impactsActionsStr: status.impactsActions?.join(', ') || '',
      xpPenalty: status.xpPenalty ?? null,
    };
    this.visible = true;
  }

  close(): void {
    this.visible = false;
    this.editingStatus = null;
    this.modalData = this.emptyForm();
  }

  confirm(): void {
    if (!this.modalData.name || !this.modalData.description) {
      alert('Please fill in name and description');
      return;
    }

    const impactsActions = this.modalData.impactsActionsStr
      ? this.modalData.impactsActionsStr.split(',').map(part => part.trim()).filter(part => part.length > 0)
      : undefined;

    const payload = {
      bodyPart: this.modalData.bodyPart,
      type: this.modalData.type,
      severity: this.modalData.severity,
      name: this.modalData.name,
      description: this.modalData.description,
      estimatedRecoveryDays: this.modalData.estimatedRecoveryDays || undefined,
      notes: this.modalData.notes || undefined,
      impactsActions: impactsActions && impactsActions.length > 0 ? impactsActions : undefined,
      xpPenalty: this.modalData.xpPenalty || undefined,
    };

    if (this.editingStatus) {
      this.bodyStatusService.updateStatus(this.editingStatus.id, payload);
    } else {
      this.bodyStatusService.addStatus(
        payload.bodyPart,
        payload.type,
        payload.severity,
        payload.name,
        payload.description,
        payload.estimatedRecoveryDays,
        payload.notes,
        payload.impactsActions,
        payload.xpPenalty,
      );
    }

    this.close();
  }

  private emptyForm(bodyPart: BodyPart = 'chest'): BodyStatusForm {
    return {
      bodyPart,
      type: 'injury',
      severity: 'minor',
      name: '',
      description: '',
      estimatedRecoveryDays: null,
      notes: '',
      impactsActionsStr: '',
      xpPenalty: null,
    };
  }
}
