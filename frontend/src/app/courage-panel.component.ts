import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../environments/environment';

interface CourageMilestone {
  id: string;
  title: string;
  domain: string;
  date: string;
  xp: number;
  notes?: string;
}

interface CourageFlagEntry {
  id: string;
  date: string;
  activityType: string;
  xp: number;
  note?: string;
}

interface CourageActivityProgress {
  activityType: string;
  displayName: string;
  domain: string;
  sessionCount: number;
  courageXPEarned: number;
  status: 'active' | 'normalizing' | 'conquered';
}

interface CourageStat {
  totalXP: number;
  level: number;
  tier: string;
  xpToNextLevel: number;
  percentToNext: number;
  milestones: CourageMilestone[];
  activityProgress: CourageActivityProgress[];
  recentFlags: CourageFlagEntry[];
}

@Component({
  selector: 'app-courage-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="courage-panel">

      <!-- ── Header ── -->
      <div class="cp-header">
        <span class="cp-icon">⚔️</span>
        <div>
          <div class="cp-title">COURAGE STAT</div>
          <div class="cp-subtitle">Fear override · Voluntary discomfort · Fear conquest</div>
        </div>
        <div class="cp-level-badge" [class]="tierClass()">
          L{{ stat()?.level ?? 1 }} · {{ stat()?.tier ?? 'Timid' }}
        </div>
      </div>

      <!-- ── Loading ── -->
      <div *ngIf="isLoading()" class="cp-loading">Loading courage data...</div>

      <ng-container *ngIf="!isLoading() && stat()">

        <!-- ── XP Bar ── -->
        <div class="cp-xp-section">
          <div class="cp-xp-labels">
            <span class="cp-xp-value">{{ stat()!.totalXP }} XP total</span>
            <span class="cp-xp-next" *ngIf="stat()!.xpToNextLevel > 0">
              {{ stat()!.xpToNextLevel }} XP to L{{ stat()!.level + 1 }} — {{ stat()!.tier }}
            </span>
            <span class="cp-xp-next" *ngIf="stat()!.xpToNextLevel === 0">✦ LEGENDARY MAX ✦</span>
          </div>
          <div class="cp-xp-bar-bg">
            <div class="cp-xp-bar-fill" [style.width.%]="stat()!.percentToNext"
                 [class]="tierClass()"></div>
          </div>
        </div>

        <!-- ── Tier description ── -->
        <div class="cp-tier-desc">{{ tierDescription() }}</div>

        <!-- ── Domain Progress ── -->
        <div class="cp-section">
          <div class="cp-section-title">⚡ Domain Progress</div>
          <div class="cp-domains">
            <div *ngFor="let act of stat()!.activityProgress" class="cp-domain-row">
              <div class="cp-domain-left">
                <span class="cp-domain-name">{{ act.displayName }}</span>
                <span class="cp-domain-label">{{ act.domain }}</span>
              </div>
              <div class="cp-domain-right">
                <span class="cp-domain-sessions">{{ act.sessionCount }} sessions</span>
                <span class="cp-domain-xp">+{{ act.courageXPEarned }} XP</span>
                <span class="cp-status-badge" [class]="'status-' + act.status">
                  {{ statusLabel(act.status) }}
                </span>
              </div>
            </div>
          </div>
          <div class="cp-session-legend">
            +8 XP · sessions 1–5 &nbsp;|&nbsp; +4 XP · sessions 6–15 &nbsp;|&nbsp;
            +2 XP · sessions 16–25 &nbsp;|&nbsp; +0 XP · sessions 26+ (conquered)
          </div>
        </div>

        <!-- ── Fear Milestones ── -->
        <div class="cp-section">
          <div class="cp-section-title">🏆 Fear Milestones</div>
          <div *ngIf="stat()!.milestones.length === 0" class="cp-empty">
            No milestones yet — add your first fear conquest below.
          </div>
          <div *ngFor="let m of stat()!.milestones" class="cp-milestone-row">
            <div class="cp-milestone-left">
              <span class="cp-milestone-title">{{ m.title }}</span>
              <span class="cp-milestone-meta">{{ m.domain }} · {{ m.date }}</span>
              <span *ngIf="m.notes" class="cp-milestone-notes">{{ m.notes }}</span>
            </div>
            <div class="cp-milestone-right">
              <span class="cp-milestone-xp">+{{ m.xp }} XP</span>
              <button class="cp-delete-btn" (click)="deleteMilestone(m.id)"
                      title="Remove milestone">✕</button>
            </div>
          </div>
        </div>

        <!-- ── Add Milestone Form ── -->
        <div class="cp-section">
          <div class="cp-section-title">➕ Add Fear Milestone</div>
          <div class="cp-form">
            <input class="cp-input" [(ngModel)]="newTitle" placeholder="Title (e.g. Overcame drowning fear)" />
            <div class="cp-form-row">
              <input class="cp-input" [(ngModel)]="newDomain" placeholder="Domain (e.g. Water)" />
              <input class="cp-input cp-input-sm" [(ngModel)]="newDate" type="date" />
              <input class="cp-input cp-input-xp" [(ngModel)]="newXP" type="number" placeholder="XP" min="1" max="200" />
            </div>
            <input class="cp-input" [(ngModel)]="newNotes" placeholder="Notes (optional)" />
            <button class="cp-submit-btn" (click)="addMilestone()" [disabled]="!canSubmit()">
              Add Milestone
            </button>
            <div *ngIf="submitMsg()" class="cp-submit-msg">{{ submitMsg() }}</div>
          </div>
          <div class="cp-xp-guide">
            <span class="cp-guide-label">XP Guide:</span>
            <span>Minor fear override = 25 XP</span>
            <span>Significant achievement = 50 XP</span>
            <span>Major life fear = 75 XP</span>
            <span>Extreme courage = 100 XP</span>
          </div>
        </div>

        <!-- ── Recent Courage Flags ── -->
        <div class="cp-section" *ngIf="stat()!.recentFlags.length > 0">
          <div class="cp-section-title">🚩 Recent Courage Flags</div>
          <div *ngFor="let f of stat()!.recentFlags" class="cp-flag-row">
            <span class="cp-flag-date">{{ f.date }}</span>
            <span class="cp-flag-type">{{ f.activityType }}</span>
            <span *ngIf="f.note" class="cp-flag-note">{{ f.note }}</span>
            <span class="cp-flag-xp">+{{ f.xp }} XP</span>
          </div>
          <div class="cp-flag-hint">
            Courage flags are awarded automatically when you check "Courage Flag" on an activity log. Max 1× per day.
          </div>
        </div>

      </ng-container>
    </div>
  `,
  styles: [`
    .courage-panel {
      padding: 16px;
      color: #e0d5c0;
      font-family: 'Cinzel', serif;
      max-width: 900px;
    }

    /* Header */
    .cp-header {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 18px;
      padding-bottom: 14px;
      border-bottom: 1px solid #3a3060;
    }
    .cp-icon { font-size: 32px; }
    .cp-title {
      font-size: 18px;
      font-weight: 700;
      color: #c8a84b;
      letter-spacing: 0.12em;
    }
    .cp-subtitle {
      font-size: 11px;
      color: #7a7090;
      font-family: 'Segoe UI', sans-serif;
      letter-spacing: 0.04em;
      margin-top: 2px;
    }
    .cp-level-badge {
      margin-left: auto;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      border: 1px solid currentColor;
    }

    /* Tier colours */
    .tier-timid      { color: #8888aa; border-color: #8888aa; }
    .tier-hesitant   { color: #aaaacc; border-color: #aaaacc; }
    .tier-brave      { color: #4caf6e; border-color: #4caf6e; }
    .tier-courageous { color: #7b9cd4; border-color: #7b9cd4; }
    .tier-bold       { color: #c8a84b; border-color: #c8a84b; }
    .tier-fearless   { color: #e05c44; border-color: #e05c44; }
    .tier-legendary  { color: #e8c86e; border-color: #e8c86e; box-shadow: 0 0 8px #e8c86e66; }

    /* XP Bar */
    .cp-xp-section { margin-bottom: 10px; }
    .cp-xp-labels {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 6px;
      font-family: 'Segoe UI', sans-serif;
    }
    .cp-xp-value { color: #c8a84b; font-weight: 600; }
    .cp-xp-next  { color: #7a7090; }
    .cp-xp-bar-bg {
      height: 8px;
      background: rgba(255,255,255,0.06);
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid #2a2a4a;
    }
    .cp-xp-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.6s ease;
      background: #8888aa;
    }
    .cp-xp-bar-fill.tier-timid      { background: #8888aa; }
    .cp-xp-bar-fill.tier-hesitant   { background: #aaaacc; }
    .cp-xp-bar-fill.tier-brave      { background: #4caf6e; }
    .cp-xp-bar-fill.tier-courageous { background: #7b9cd4; }
    .cp-xp-bar-fill.tier-bold       { background: #c8a84b; }
    .cp-xp-bar-fill.tier-fearless   { background: #e05c44; }
    .cp-xp-bar-fill.tier-legendary  { background: linear-gradient(90deg, #c8a84b, #e8c86e); }

    .cp-tier-desc {
      font-size: 12px;
      color: #7a7090;
      font-family: 'Segoe UI', sans-serif;
      font-style: italic;
      margin-bottom: 18px;
    }

    /* Sections */
    .cp-section {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 14px;
    }
    .cp-section-title {
      font-size: 12px;
      font-weight: 700;
      color: #c8a84b;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 12px;
    }
    .cp-empty {
      font-size: 12px;
      color: #7a7090;
      font-family: 'Segoe UI', sans-serif;
      font-style: italic;
    }
    .cp-loading {
      font-size: 13px;
      color: #7a7090;
      font-family: 'Segoe UI', sans-serif;
      padding: 24px;
      text-align: center;
    }

    /* Domain rows */
    .cp-domain-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      font-family: 'Segoe UI', sans-serif;
    }
    .cp-domain-row:last-child { border-bottom: none; }
    .cp-domain-left { display: flex; flex-direction: column; gap: 2px; }
    .cp-domain-name { font-size: 13px; color: #e0d5c0; font-weight: 600; }
    .cp-domain-label { font-size: 11px; color: #7a7090; }
    .cp-domain-right { display: flex; align-items: center; gap: 12px; }
    .cp-domain-sessions { font-size: 12px; color: #7a7090; }
    .cp-domain-xp { font-size: 12px; color: #c8a84b; font-weight: 600; }

    .cp-status-badge {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .status-active     { background: rgba(76,175,110,0.15); color: #4caf6e; border: 1px solid #4caf6e44; }
    .status-normalizing{ background: rgba(200,168,75,0.15);  color: #c8a84b; border: 1px solid #c8a84b44; }
    .status-conquered  { background: rgba(123,104,238,0.15); color: #7b68ee; border: 1px solid #7b68ee44; }

    .cp-session-legend {
      margin-top: 10px;
      font-size: 10px;
      color: #555580;
      font-family: 'Segoe UI', sans-serif;
    }

    /* Milestone rows */
    .cp-milestone-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      font-family: 'Segoe UI', sans-serif;
    }
    .cp-milestone-row:last-child { border-bottom: none; }
    .cp-milestone-left { display: flex; flex-direction: column; gap: 3px; flex: 1; }
    .cp-milestone-title { font-size: 13px; color: #e0d5c0; font-weight: 600; }
    .cp-milestone-meta  { font-size: 11px; color: #7a7090; }
    .cp-milestone-notes { font-size: 11px; color: #9090b0; font-style: italic; }
    .cp-milestone-right { display: flex; align-items: center; gap: 10px; }
    .cp-milestone-xp    { font-size: 14px; font-weight: 700; color: #c8a84b; }
    .cp-delete-btn {
      background: none;
      border: 1px solid #444;
      color: #666;
      padding: 2px 7px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      transition: color 0.2s, border-color 0.2s;
    }
    .cp-delete-btn:hover { color: #e05c44; border-color: #e05c44; }

    /* Add form */
    .cp-form { display: flex; flex-direction: column; gap: 8px; }
    .cp-form-row { display: flex; gap: 8px; }
    .cp-input {
      background: rgba(255,255,255,0.05);
      border: 1px solid #3a3060;
      border-radius: 4px;
      color: #e0d5c0;
      padding: 7px 10px;
      font-size: 12px;
      font-family: 'Segoe UI', sans-serif;
      width: 100%;
      box-sizing: border-box;
    }
    .cp-input:focus { outline: none; border-color: #c8a84b; }
    .cp-input-sm  { max-width: 140px; flex-shrink: 0; }
    .cp-input-xp  { max-width: 80px;  flex-shrink: 0; }
    .cp-submit-btn {
      background: rgba(200,168,75,0.15);
      border: 1px solid #c8a84b;
      color: #c8a84b;
      padding: 8px 18px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: 'Cinzel', serif;
      font-weight: 700;
      letter-spacing: 0.06em;
      align-self: flex-start;
      transition: background 0.2s;
    }
    .cp-submit-btn:hover:not(:disabled) { background: rgba(200,168,75,0.3); }
    .cp-submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .cp-submit-msg { font-size: 12px; color: #4caf6e; font-family: 'Segoe UI', sans-serif; }

    .cp-xp-guide {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      margin-top: 10px;
      font-size: 10px;
      color: #555580;
      font-family: 'Segoe UI', sans-serif;
    }
    .cp-guide-label { color: #7a7090; font-weight: 600; }

    /* Courage flags */
    .cp-flag-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      font-family: 'Segoe UI', sans-serif;
      font-size: 12px;
    }
    .cp-flag-row:last-of-type { border-bottom: none; }
    .cp-flag-date { color: #7a7090; min-width: 90px; }
    .cp-flag-type { color: #aaaacc; flex: 1; }
    .cp-flag-note { color: #9090b0; font-style: italic; flex: 2; }
    .cp-flag-xp   { color: #c8a84b; font-weight: 600; }
    .cp-flag-hint {
      margin-top: 8px;
      font-size: 10px;
      color: #555580;
      font-family: 'Segoe UI', sans-serif;
      font-style: italic;
    }
  `],
})
export class CouragePanelComponent implements OnInit {
  stat        = signal<CourageStat | null>(null);
  isLoading   = signal(true);

  // Form fields
  newTitle  = '';
  newDomain = '';
  newDate   = new Date().toLocaleDateString('en-CA');
  newXP     = 50;
  newNotes  = '';
  submitMsg = signal('');

  private readonly http = inject(HttpClient);

  tierClass = computed(() => {
    const tier = this.stat()?.tier?.toLowerCase().replace(/\s+/g, '-') ?? 'timid';
    return `tier-${tier}`;
  });

  tierDescription = computed((): string => {
    const tier = this.stat()?.tier;
    const descriptions: Record<string, string> = {
      'Timid':      'Only beginning to acknowledge the fears that hold you back.',
      'Hesitant':   'Aware of your fears — taking the first steps toward them.',
      'Brave':      'Regularly choosing action over comfort. Fear no longer controls you.',
      'Courageous': 'Consistent pattern of fear-override. Fear has become fuel.',
      'Bold':       'Discomfort is your default training state. You seek the hard path.',
      'Fearless':   'Fear is information, not a barrier. You act in spite of it, always.',
      'Legendary':  'The architecture of your life is built on fear conquered. Myth level.',
    };
    return tier ? (descriptions[tier] ?? '') : '';
  });

  ngOnInit(): void {
    this.http.get<{ success: boolean; data: CourageStat }>(
      `${environment.apiUrl}/api/courage`
    ).pipe(catchError(() => of(null))).subscribe(res => {
      if (res?.success) this.stat.set(res.data);
      this.isLoading.set(false);
    });
  }

  statusLabel(status: string): string {
    return status === 'active' ? '🔵 Active'
      : status === 'normalizing' ? '🟡 Normalizing'
      : '🟣 Conquered';
  }

  canSubmit(): boolean {
    return this.newTitle.trim().length > 0
      && this.newDomain.trim().length > 0
      && this.newDate.length > 0
      && this.newXP > 0;
  }

  addMilestone(): void {
    if (!this.canSubmit()) return;
    this.http.post<{ success: boolean; milestone: CourageMilestone; totalXP: number }>(
      `${environment.apiUrl}/api/courage/milestones`,
      {
        title:  this.newTitle.trim(),
        domain: this.newDomain.trim(),
        date:   this.newDate,
        xp:     Number(this.newXP),
        notes:  this.newNotes.trim() || undefined,
      }
    ).subscribe({
      next: res => {
        if (res.success) {
          this.submitMsg.set(`✅ Milestone added! +${res.milestone.xp} Courage XP`);
          this.newTitle = '';
          this.newDomain = '';
          this.newNotes = '';
          this.newXP = 50;
          // Reload stat
          this.http.get<{ success: boolean; data: CourageStat }>(
            `${environment.apiUrl}/api/courage`
          ).subscribe(r => { if (r?.success) this.stat.set(r.data); });
          setTimeout(() => this.submitMsg.set(''), 4000);
        }
      },
      error: () => this.submitMsg.set('❌ Failed to add milestone'),
    });
  }

  deleteMilestone(id: string): void {
    this.http.delete<{ success: boolean; totalXP: number }>(
      `${environment.apiUrl}/api/courage/milestones/${id}`
    ).subscribe(res => {
      if (res.success) {
        this.http.get<{ success: boolean; data: CourageStat }>(
          `${environment.apiUrl}/api/courage`
        ).subscribe(r => { if (r?.success) this.stat.set(r.data); });
      }
    });
  }
}
