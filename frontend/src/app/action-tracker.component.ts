import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActionTrackerService, ActiveAction, MilestoneAlert } from './action-tracker.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-action-tracker',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="action-tracker-overlay" *ngIf="currentAction">
      <div class="action-card">
        <div class="action-header">
          <div class="action-icon">{{ getActionIcon(currentAction.type) }}</div>
          <div class="action-info">
            <h3>{{ getActionTitle(currentAction.type) }}</h3>
            <p class="target-result">{{ currentAction.targetResult }}</p>
            <p class="quest-link" *ngIf="currentAction.quest">Quest: {{ currentAction.quest }}</p>
          </div>
          <button class="close-btn" (click)="onCancel()" title="Cancel">✕</button>
        </div>

        <div class="action-timer">
          <div class="timer-display">{{ formatDuration(currentAction.duration) }}</div>
          <div class="timer-label">Duration</div>
        </div>

        <div class="action-stats">
          <div class="stat">
            <span class="stat-label">Attempts:</span>
            <span class="stat-value">{{ currentAction.attempts }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Pending XP:</span>
            <span class="stat-value xp-value">+{{ (currentAction.xpCalculated?.pendingXP?.toFixed(1) ?? '?') }} XP</span>
          </div>
        </div>

        <div class="action-buttons">
          <button class="btn btn-success" (click)="onComplete()">
            ✓ Complete
          </button>
          <button class="btn btn-warning" (click)="onFail()">
            ✗ Failed
          </button>
          <button class="btn btn-secondary" (click)="onRetry()">
            ↻ Retry
          </button>
        </div>

        <div class="animation-status">
          <div class="animation-indicator"></div>
          <span>Animation looping: {{ currentAction.animation }}</span>
        </div>
      </div>
    </div>

    <!-- rot.js EventQueue milestone toasts -->
    <div class="milestone-toast-list">
      <div *ngFor="let m of visibleMilestones" class="milestone-toast">
        <span class="milestone-icon">🏅</span>
        <div class="milestone-text">
          <div class="milestone-message">{{ m.message }}</div>
          <div class="milestone-xp" *ngIf="m.xpSoFar > 0">+{{ m.xpSoFar.toFixed(1) }} XP so far</div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .action-tracker-overlay {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 1000;
      width: 350px;
    }

    .action-card {
      background: var(--eso-bg-panel, #120e07);
      border: 1px solid var(--eso-border, rgba(155,115,38,0.65));
      border-radius: 4px;
      padding: 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(201,168,76,0.05);
      backdrop-filter: blur(10px);
    }

    .action-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 20px;
    }

    .action-icon {
      font-size: 28px;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--eso-gold-mid, #9a7830) 0%, var(--eso-gold-dim, #6a5020) 100%);
      border-radius: 2px;
      border: 1px solid var(--eso-gold, #c9a84c);
      flex-shrink: 0;
    }

    .action-info {
      flex: 1;
    }

    .action-info h3 {
      margin: 0 0 6px 0;
      font-size: 15px;
      font-weight: 700;
      color: var(--eso-gold-bright, #f2c96a);
      font-family: 'Cinzel', serif;
      letter-spacing: 1px;
    }

    .target-result {
      margin: 0 0 4px 0;
      font-size: 13px;
      color: var(--eso-text, #e2cfa8);
    }

    .quest-link {
      margin: 0;
      font-size: 11px;
      color: var(--eso-gold-bright, #f2c96a);
      font-weight: 600;
      font-family: 'Cinzel', serif;
      letter-spacing: 0.5px;
    }

    .close-btn {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: #f0f0f0;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 18px;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .close-btn:hover {
      background: rgba(255, 100, 100, 0.3);
    }

    .action-timer {
      text-align: center;
      margin-bottom: 18px;
      padding: 14px;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 2px;
      border: 1px solid var(--eso-border, rgba(155,115,38,0.25));
    }

    .timer-display {
      font-size: 34px;
      font-weight: 700;
      color: var(--eso-gold, #c9a84c);
      font-family: 'Courier New', monospace;
      letter-spacing: 2px;
      text-shadow: 0 0 12px rgba(201,168,76,0.35);
    }

    .timer-label {
      font-size: 10px;
      color: var(--eso-text-dim, #a08858);
      margin-top: 4px;
      text-transform: uppercase;
      font-family: 'Cinzel', serif;
      letter-spacing: 1.5px;
    }

    .action-stats {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }

    .stat {
      flex: 1;
      background: var(--eso-bg-panel-alt, #1a1408);
      padding: 10px 12px;
      border-radius: 2px;
      border: 1px solid var(--eso-border, rgba(155,115,38,0.25));
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .stat-label {
      font-size: 10px;
      color: var(--eso-text-dim, #a08858);
      text-transform: uppercase;
      font-family: 'Cinzel', serif;
      letter-spacing: 1px;
    }

    .stat-value {
      font-size: 17px;
      font-weight: 700;
      color: var(--eso-text-bright, #fff8e8);
    }

    .stat-value.xp-value {
      color: var(--eso-gold-bright, #f2c96a);
    }

    .action-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 16px;
    }

    .action-buttons .btn:first-child {
      grid-column: 1 / -1;
    }

    .btn {
      padding: 10px 16px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-success {
      background: linear-gradient(135deg, var(--eso-gold, #c9a84c) 0%, var(--eso-gold-mid, #9a7830) 100%);
      color: var(--eso-bg-deep, #060402);
      font-family: 'Cinzel', serif;
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    .btn-success:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(201, 168, 76, 0.35);
    }

    .btn-warning {
      background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
      color: white;
    }

    .btn-warning:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(255, 107, 107, 0.4);
    }

    .btn-secondary {
      background: var(--eso-bg-panel-alt, #1a1408);
      color: var(--eso-text, #e2cfa8);
      border: 1px solid var(--eso-gold-dim, #6a5020);
    }

    .btn-secondary:hover {
      background: var(--eso-bg-hover, #221a09);
      border-color: var(--eso-gold-mid, #9a7830);
    }

    .animation-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 6px;
      font-size: 12px;
      color: #888;
    }

    .animation-indicator {
      width: 8px;
      height: 8px;
      background: #00ff88;
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.5; transform: scale(1.2); }
    }

    .milestone-toast-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 6px;
    }

    .milestone-toast {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: var(--eso-bg-panel, #120e07);
      border: 1px solid var(--eso-gold, #c9a84c);
      border-left: 3px solid var(--eso-gold-bright, #f2c96a);
      border-radius: 3px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.6), 0 0 8px rgba(201,168,76,0.15);
      animation: milestone-slide-in 0.35s ease-out;
    }

    @keyframes milestone-slide-in {
      from { opacity: 0; transform: translateX(24px); }
      to   { opacity: 1; transform: translateX(0); }
    }

    .milestone-icon { font-size: 20px; flex-shrink: 0; }

    .milestone-message {
      font-size: 13px;
      color: var(--eso-gold-bright, #f2c96a);
      font-family: 'Cinzel', serif;
      font-weight: 600;
    }

    .milestone-xp {
      font-size: 11px;
      color: var(--eso-text-dim, #a08050);
      margin-top: 2px;
    }

    @media (max-width: 768px) {
      .action-tracker-overlay {
        top: 10px;
        right: 10px;
        left: 10px;
        width: auto;
      }
    }
  `]
})
export class ActionTrackerComponent implements OnInit, OnDestroy {
  @Output() actionCompleted = new EventEmitter<ActiveAction>();
  @Output() actionFailed = new EventEmitter<void>();
  @Output() actionCancelled = new EventEmitter<void>();

  currentAction: ActiveAction | null = null;
  visibleMilestones: MilestoneAlert[] = [];
  private subscription: Subscription | null = null;
  private milestoneSubscription: Subscription | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private milestoneTimeouts: any[] = [];

  constructor(private actionTracker: ActionTrackerService) {}

  ngOnInit(): void {
    this.subscription = this.actionTracker.getCurrentAction().subscribe(
      action => { this.currentAction = action; }
    );

    this.milestoneSubscription = this.actionTracker.getMilestoneAlerts().subscribe(alert => {
      this.visibleMilestones = [alert, ...this.visibleMilestones];
      // Auto-dismiss after 7 seconds
      const t = setTimeout(() => {
        this.visibleMilestones = this.visibleMilestones.filter(m => m !== alert);
      }, 7000);
      this.milestoneTimeouts.push(t);
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.milestoneSubscription?.unsubscribe();
    this.milestoneTimeouts.forEach(t => clearTimeout(t));
  }

  onComplete(): void {
    const completed = this.actionTracker.completeAction();
    if (completed) {
      this.actionCompleted.emit(completed);
    }
  }

  onFail(): void {
    this.actionTracker.failAction();
    this.actionFailed.emit();
  }

  onCancel(): void {
    this.actionTracker.cancelAction();
    this.actionCancelled.emit();
  }

  onRetry(): void {
    this.actionTracker.retryAction();
  }

  formatDuration(seconds: number): string {
    return this.actionTracker.formatDuration(seconds);
  }

  getActionIcon(type: string): string {
    const icons: Record<string, string> = {
      prayer: '🙏',
      workout: '💪',
      coding: '💻',
      redteam: '🔒',
      artist: '🎨',
      lab: '🧪',
      meal: '🍽️',
      water: '💧',
      fasting: '⏱️'
    };
    return icons[type] || '⚡';
  }

  getActionTitle(type: string): string {
    const titles: Record<string, string> = {
      prayer: 'Paladin Training',
      workout: 'Physical Training',
      coding: 'Developer Work',
      redteam: 'RedTeam Mission',
      artist: 'Creative Work',
      lab: 'Lab Investigation',
      meal: 'Consuming Meal',
      water: 'Hydration',
      fasting: 'Fasting'
    };
    return titles[type] || 'Activity';
  }
}
