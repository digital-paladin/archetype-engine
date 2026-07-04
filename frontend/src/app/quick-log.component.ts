import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

interface ActivityType {
  type: string;
  category: string;
  baseXP: number;
}

@Component({
  selector: 'app-quick-log',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="quick-log-container">
      <h3>Quick Log Activity</h3>
      
      <form (ngSubmit)="logActivity()" #logForm="ngForm">
        <div class="form-group">
          <label for="activityType">Activity Type</label>
          <select 
            id="activityType"
            [(ngModel)]="activityType" 
            name="type"
            required
            (change)="onActivityTypeChange()"
          >
            <option value="" disabled>Select activity...</option>
            <optgroup label="RedTeam">
              <option value="redteam-lab">Lab Completion</option>
              <option value="redteam-ctf">CTF Challenge</option>
              <option value="redteam-training">Training/Study</option>
            </optgroup>
            <optgroup label="Developer">
              <option value="dev-story">Developer Story Work</option>
              <option value="dev-bug-fix">Developer Bug Fix</option>
              <option value="personal-project">Personal Project</option>
            </optgroup>
            <optgroup label="Warrior">
              <option value="workout-strength">Strength Training</option>
              <option value="workout-cardio">Cardio</option>
              <option value="workout-mobility">Mobility/Stretching</option>
            </optgroup>
            <optgroup label="Artist">
              <option value="art-drawing">Drawing/Design</option>
              <option value="art-music">Music Practice</option>
              <option value="art-writing">Creative Writing</option>
            </optgroup>
            <optgroup label="Financial">
              <option value="financial-study">Financial Study</option>
              <option value="financial-project">Financial Project</option>
            </optgroup>
          </select>
        </div>

        <div class="form-group">
          <label for="duration">Duration (minutes)</label>
          <input 
            type="number" 
            id="duration"
            [(ngModel)]="duration" 
            name="duration"
            placeholder="Optional"
            min="0"
            (input)="updateXpPreview()"
          >
        </div>

        <div class="form-group">
          <label for="notes">Notes</label>
          <textarea 
            id="notes"
            [(ngModel)]="notes" 
            name="notes"
            placeholder="Optional notes..."
            rows="3"
          ></textarea>
        </div>

        <div class="xp-preview" *ngIf="xpPreview() > 0">
          <span class="xp-label">XP Preview:</span>
          <span class="xp-value">+{{ displayXp() }} XP</span>
          <span class="xp-rested" *ngIf="_xpMultiplier() > 1">✨ Rested Bonus ({{ _xpMultiplier() }}x)</span>
        </div>

        <div class="form-actions">
          <button 
            type="submit" 
            [disabled]="!activityType || isLogging()"
            class="btn-primary"
          >
            {{ isLogging() ? 'Logging...' : 'Log Activity' }}
          </button>
          <button 
            type="button"
            (click)="clearForm()"
            class="btn-secondary"
          >
            Clear
          </button>
        </div>

        <div class="status-message" *ngIf="statusMessage()">
          <span [ngClass]="statusClass()">{{ statusMessage() }}</span>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .quick-log-container {
      padding: 0;
      background: transparent;
    }

    /* hide internal h3 — parent panel title covers this */
    h3 { display: none; }

    .form-group { margin-bottom: 12px; }

    label {
      display: block;
      margin-bottom: 4px;
      font-family: 'Cinzel', 'Palatino Linotype', serif;
      font-size: 10px;
      font-weight: 600;
      color: #a08858;
      letter-spacing: 1.8px;
      text-transform: uppercase;
    }

    select, input, textarea {
      width: 100%;
      padding: 8px 10px;
      background: #090705;
      border: 1px solid rgba(110,82,28,0.40);
      color: #e2cfa8;
      font-family: 'Open Sans', sans-serif;
      font-size: 13px;
      box-sizing: border-box;
      transition: border-color 0.2s;
      border-radius: 0;
    }
    select option { background: #120e07; color: #e2cfa8; }
    select optgroup { background: #0d0a06; color: #a08858; }

    select:focus, input:focus, textarea:focus {
      outline: none;
      border-color: rgba(155,115,38,0.90);
      box-shadow: 0 0 0 2px rgba(201,168,76,0.10);
    }

    .xp-preview {
      padding: 10px 12px;
      background: rgba(0,0,0,0.40);
      border: 1px solid rgba(155,115,38,0.40);
      margin-bottom: 14px;
      text-align: center;
    }
    .xp-label {
      font-family: 'Cinzel', serif;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #a08858;
      margin-right: 8px;
    }
    .xp-value {
      color: #f2c96a;
      font-size: 18px;
      font-weight: 700;
      text-shadow: 0 0 10px rgba(201,168,76,0.35);
    }
    .xp-rested {
      display: block;
      font-size: 10px;
      color: #f5c842;
      letter-spacing: 1px;
      margin-top: 4px;
      text-shadow: 0 0 8px rgba(245,200,66,0.5);
      animation: rested-pulse 1.8s ease-in-out infinite;
    }
    @keyframes rested-pulse {
      0%, 100% { opacity: 0.8; }
      50% { opacity: 1; }
    }

    .form-actions { display: flex; gap: 8px; }

    button {
      flex: 1;
      padding: 9px 14px;
      border: 1px solid;
      font-family: 'Cinzel', serif;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.2s;
      border-radius: 0;
    }

    .btn-primary {
      background: linear-gradient(180deg, rgba(55,38,10,0.92) 0%, rgba(20,14,4,0.96) 100%);
      border-color: rgba(155,115,38,0.65);
      color: #c9a84c;
    }
    .btn-primary:hover:not(:disabled) {
      border-color: #c9a84c;
      color: #f2c96a;
      box-shadow: 0 0 14px rgba(201,168,76,0.20);
    }
    .btn-primary:disabled { opacity: 0.38; cursor: not-allowed; }

    .btn-secondary {
      background: rgba(18,14,7,0.80);
      border-color: rgba(80,60,18,0.40);
      color: #6a5030;
    }
    .btn-secondary:hover {
      border-color: rgba(120,90,30,0.65);
      color: #a08858;
    }

    .status-message {
      margin-top: 10px; padding: 8px 10px;
      text-align: center; font-size: 12px; font-weight: 600;
    }
    .status-success {
      background: rgba(18,52,18,0.30);
      border: 1px solid rgba(38,120,38,0.40);
      color: #70c070;
    }
    .status-error {
      background: rgba(55,14,14,0.30);
      border: 1px solid rgba(160,28,28,0.40);
      color: #ff8080;
    }
  `]
})
export class QuickLogComponent {
  @Output() logged = new EventEmitter<{ xp: number; activityType: string }>();

  /** Injected by parent when a Rested XP buff is active (e.g. 1.5 after 7+ hrs sleep). */
  _xpMultiplier = signal(1);
  @Input() set xpMultiplier(v: number) { this._xpMultiplier.set(v ?? 1); }

  activityType = '';
  duration: number | null = null;
  notes = '';

  xpPreview = signal(0);
  /** XP preview adjusted by the active rested multiplier — shown in UI and sent to backend. */
  displayXp  = computed(() => Math.round(this.xpPreview() * this._xpMultiplier()));

  isLogging    = signal(false);
  statusMessage = signal('');
  statusClass   = signal('');

  constructor(private http: HttpClient) {}

  onActivityTypeChange() {
    this.updateXpPreview();
  }

  updateXpPreview() {
    if (!this.activityType) {
      this.xpPreview.set(0);
      return;
    }

    const duration = this.duration || undefined;
    const url = `${environment.apiUrl}/api/activities/calculate-xp?type=${this.activityType}${duration ? `&duration=${duration}` : ''}`;

    this.http.get<{ xp: number }>(url).subscribe({
      next: (response) => {
        this.xpPreview.set(response.xp);
      },
      error: (err) => {
        console.error('Failed to calculate XP preview:', err);
        this.xpPreview.set(0);
      }
    });
  }

  logActivity() {
    if (!this.activityType) {
      return;
    }

    this.isLogging.set(true);
    this.statusMessage.set('');

    const payload: Record<string, unknown> = {
      activityType: this.activityType,
      duration: this.duration || undefined,
      notes: this.notes || undefined
    };
    // When a rested multiplier is active, send the pre-multiplied XP so the backend
    // uses this value directly (it accepts clientXp when provided).
    if (this.displayXp() > 0) {
      payload['xp'] = this.displayXp();
    }

    this.http.post<{ success: boolean; xp: number; message: string }>(
      `${environment.apiUrl}/api/activities`,
      payload
    ).subscribe({
      next: (response) => {
        this.isLogging.set(false);
        this.statusMessage.set(response.message);
        this.statusClass.set('status-success');

        // Emit event for parent component
        this.logged.emit({
          xp: response.xp,
          activityType: this.activityType
        });

        // Clear form after 2 seconds
        setTimeout(() => {
          this.clearForm();
          this.statusMessage.set('');
        }, 2000);
      },
      error: (err) => {
        this.isLogging.set(false);
        this.statusMessage.set('Failed to log activity. Please try again.');
        this.statusClass.set('status-error');
        console.error('Failed to log activity:', err);
      }
    });
  }

  clearForm() {
    this.activityType = '';
    this.duration = null;
    this.notes = '';
    this.xpPreview.set(0);
    this.statusMessage.set('');
  }
}
