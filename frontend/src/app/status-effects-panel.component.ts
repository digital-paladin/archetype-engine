import { Component, Input, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { environment } from '../environments/environment';

// ─── Interfaces ────────────────────────────────────────────────────────────

interface EffectStat {
  stat: string;
  modifier: string;
  direction: 'positive' | 'negative';
}

interface StatusEffect {
  id: string;
  name: string;
  type: 'buff' | 'debuff' | 'mixed';
  category: string;
  source: string;
  icon: string;
  effects: EffectStat[];
  appliedAt: string;
  duration: number;
  expiresAt: string | null;
  notes?: string;
}

interface EffectTemplate {
  name: string;
  type: 'buff' | 'debuff' | 'mixed';
  category: string;
  source: string;
  icon: string;
  effects: EffectStat[];
  duration: number;
}

// ─── Component ─────────────────────────────────────────────────────────────

@Component({
  selector: 'app-status-effects-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `

    <!-- ══════════════════════════════════════════════════════════
         COMPACT MODE — ESO "Active Effects" strip (left column)
         ══════════════════════════════════════════════════════════ -->
    <ng-container *ngIf="compact">

      <div class="aef-header">
        <span class="aef-title">Active Effects</span>
        <button class="aef-add-btn" (click)="showAddForm.set(!showAddForm())" [title]="showAddForm() ? 'Cancel' : 'Add effect'">
          {{ showAddForm() ? '✕' : '+' }}
        </button>
      </div>

      <!-- Quick-add: template picker -->
      <div class="aef-quick" *ngIf="showAddForm()">
        <select class="aef-select" (change)="applyTemplate($event)">
          <option value="">— Select preset effect —</option>
          <option *ngFor="let t of templates()" [value]="t.name">{{ t.icon }} {{ t.name }}</option>
        </select>
      </div>

      <!-- Empty state -->
      <div class="aef-empty" *ngIf="!isLoading() && activeEffects().length === 0">
        No active effects
      </div>

      <!-- Compact list -->
      <ul class="aef-list" *ngIf="activeEffects().length > 0">
        <li *ngFor="let e of activeEffects()"
            class="aef-item"
            [class.aef-buff]="e.type === 'buff'"
            [class.aef-debuff]="e.type === 'debuff'"
            [class.aef-mixed]="e.type === 'mixed'">
          <span class="aef-icon">{{ e.icon }}</span>
          <span class="aef-name">{{ e.name }}</span>
          <span class="aef-time" *ngIf="e.expiresAt">{{ timeRemainingShort(e.expiresAt) }}</span>
          <span class="aef-time aef-indf" *ngIf="!e.expiresAt">∞</span>
          <button class="aef-x" (click)="dismissEffect(e.id)" title="Dismiss">✕</button>
        </li>
      </ul>

    </ng-container>

    <!-- ══════════════════════════════════════════════════════════
         FULL MODE — Detail panel (⚗ Buffs tab)
         ══════════════════════════════════════════════════════════ -->
    <ng-container *ngIf="!compact">

    <div class="sep-root">

      <!-- Header Row -->
      <div class="sep-header">
        <span class="sep-title">Active Effects</span>
        <div class="sep-header-actions">
          <button class="sep-btn sep-btn-secondary" (click)="refresh()" title="Refresh">↻</button>
          <button class="sep-btn sep-btn-primary" (click)="showAddForm.set(!showAddForm())">
            {{ showAddForm() ? '✕ Cancel' : '+ Add Effect' }}
          </button>
        </div>
      </div>

      <!-- Add Effect Form -->
      <div class="sep-add-form" *ngIf="showAddForm()">
        <div class="sep-form-title">Quick-Log Status Effect</div>

        <!-- Template Picker -->
        <div class="sep-form-group">
          <label>Use Template</label>
          <select (change)="applyTemplate($event)">
            <option value="">— Select preset —</option>
            <option *ngFor="let t of templates()" [value]="t.name">{{ t.icon }} {{ t.name }}</option>
          </select>
        </div>

        <div class="sep-form-divider">— or custom —</div>

        <div class="sep-form-row">
          <div class="sep-form-group">
            <label>Name</label>
            <input [(ngModel)]="form.name" placeholder="e.g. Caffeine Clarity" />
          </div>
          <div class="sep-form-group sep-form-group-sm">
            <label>Icon</label>
            <input [(ngModel)]="form.icon" placeholder="☕" maxlength="4" />
          </div>
        </div>

        <div class="sep-form-row">
          <div class="sep-form-group">
            <label>Type</label>
            <select [(ngModel)]="form.type">
              <option value="buff">Buff</option>
              <option value="debuff">Debuff</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>
          <div class="sep-form-group">
            <label>Category</label>
            <select [(ngModel)]="form.category">
              <option value="substance">Substance</option>
              <option value="food">Food</option>
              <option value="training">Training</option>
              <option value="environmental">Environmental</option>
              <option value="illness">Illness</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div class="sep-form-group">
          <label>Source</label>
          <input [(ngModel)]="form.source" placeholder="e.g. Coffee - 2 cups" />
        </div>

        <div class="sep-form-group">
          <label>Duration (minutes, -1 = indefinite)</label>
          <input type="number" [(ngModel)]="form.duration" />
        </div>

        <div class="sep-form-group">
          <label>Notes (optional)</label>
          <input [(ngModel)]="form.notes" placeholder="Any context..." />
        </div>

        <button
          class="sep-btn sep-btn-primary sep-btn-full"
          [disabled]="!canSubmit()"
          (click)="submitEffect()">
          Apply Effect
        </button>
      </div>

      <!-- Loading -->
      <div class="sep-loading" *ngIf="isLoading()">Loading...</div>

      <!-- Empty State -->
      <div class="sep-empty" *ngIf="!isLoading() && activeEffects().length === 0">
        <span class="sep-empty-icon">✦</span>
        <p>No active status effects.</p>
        <p class="sep-empty-sub">Log caffeine, alcohol, allergies, training buffs, and more.</p>
      </div>

      <!-- Single-column list (tap to expand) -->
      <div class="sep-list" *ngIf="!isLoading() && activeEffects().length > 0">
        <div *ngFor="let e of activeEffects()"
             class="sep-item"
             [class.sep-item-buff]="e.type === 'buff'"
             [class.sep-item-debuff]="e.type === 'debuff'"
             [class.sep-item-mixed]="e.type === 'mixed'"
             (click)="toggleExpand(e.id)">

          <!-- Row: icon · name · time · dismiss -->
          <div class="sep-item-row">
            <span class="sep-item-icon">{{ e.icon }}</span>
            <div class="sep-item-info">
              <span class="sep-item-name">{{ e.name }}</span>
              <span class="sep-item-source">{{ e.source }}</span>
            </div>
            <span class="sep-item-time" *ngIf="e.expiresAt">{{ timeRemainingShort(e.expiresAt) }}</span>
            <span class="sep-item-time sep-indf" *ngIf="!e.expiresAt">∞</span>
            <button class="sep-dismiss" (click)="$event.stopPropagation(); dismissEffect(e.id)" title="Dismiss">✕</button>
          </div>

          <!-- Expanded: stat breakdown -->
          <div class="sep-item-detail" *ngIf="expandedId() === e.id">
            <ul class="sep-stat-list">
              <li *ngFor="let s of e.effects"
                  class="sep-stat"
                  [class.sep-stat-pos]="s.direction === 'positive'"
                  [class.sep-stat-neg]="s.direction === 'negative'">
                <span class="sep-stat-modifier">{{ s.modifier }}</span>
                <span class="sep-stat-name">{{ s.stat }}</span>
              </li>
            </ul>
            <div class="sep-item-meta">
              <span *ngIf="e.expiresAt">⏱ {{ timeRemaining(e.expiresAt) }} remaining</span>
              <span *ngIf="!e.expiresAt">∞ Indefinite</span>
            </div>
            <div class="sep-notes" *ngIf="e.notes">{{ e.notes }}</div>
          </div>

        </div>
      </div>

    </div>

    </ng-container>
  `,
  styles: [`
    /* ══════════════════════════════════════════════════════
       COMPACT MODE — ESO "Active Effects" strip
       Used in the left column status panel
       ══════════════════════════════════════════════════════ */

    .aef-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .aef-title {
      font-family: 'Cinzel', 'Palatino Linotype', serif;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--eso-gold, #c9a84c);
    }
    .aef-add-btn {
      background: none;
      border: 1px solid rgba(201,168,76,0.35);
      color: var(--eso-gold, #c9a84c);
      cursor: pointer;
      font-size: 14px;
      width: 22px; height: 22px;
      display: flex; align-items: center; justify-content: center;
      padding: 0; line-height: 1;
      transition: border-color 0.15s, background 0.15s;
    }
    .aef-add-btn:hover { border-color: var(--eso-gold, #c9a84c); background: rgba(201,168,76,0.1); }

    .aef-quick { margin-bottom: 6px; }
    .aef-select {
      width: 100%;
      background: rgba(10,8,3,0.7);
      border: 1px solid rgba(155,115,38,0.4);
      color: var(--eso-text, #e2cfa8);
      font-size: 11px;
      padding: 5px 6px;
      font-family: inherit;
      /* tall enough to tap on mobile */
      min-height: 36px;
    }
    .aef-select option { background: #1a1a2e; }
    .aef-select:focus { outline: none; border-color: var(--eso-gold, #c9a84c); }

    .aef-empty {
      font-size: 11px;
      color: var(--eso-text-muted, #6a5030);
      font-style: italic;
      padding: 4px 0 8px;
    }

    .aef-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .aef-item {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 5px 0 5px 8px;
      border-left: 2px solid transparent;
      /* touch target: min 44px height on mobile */
      min-height: 44px;
    }
    .aef-buff   { border-left-color: #4caf6e; }
    .aef-debuff { border-left-color: #e05c44; }
    .aef-mixed  { border-left-color: #c9a84c; }

    .aef-icon { font-size: 16px; flex-shrink: 0; }
    .aef-name {
      flex: 1;
      font-size: 12px;
      color: var(--eso-text, #e2cfa8);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .aef-buff   .aef-name { color: #8fe8aa; }
    .aef-debuff .aef-name { color: #f0906e; }
    .aef-mixed  .aef-name { color: #f2c96a; }

    .aef-time {
      font-size: 10px;
      color: var(--eso-text-muted, #6a5030);
      flex-shrink: 0;
      white-space: nowrap;
    }
    .aef-indf { font-size: 13px; opacity: 0.5; }
    .aef-x {
      background: none;
      border: none;
      color: #444;
      cursor: pointer;
      font-size: 10px;
      padding: 0 4px;
      line-height: 1;
      flex-shrink: 0;
      /* tall touch target */
      min-height: 32px;
      min-width: 28px;
    }
    .aef-x:hover { color: #e05c44; }

    /* ══════════════════════════════════════════════════════
       FULL MODE — Detail panel (⚗ Buffs tab)
       Single-column expandable list — mobile-first
       ══════════════════════════════════════════════════════ */

    .sep-root {
      font-family: 'Cinzel', 'Palatino Linotype', serif;
      color: var(--eso-text, #e2cfa8);
    }

    /* Header */
    .sep-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .sep-title {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      color: var(--eso-gold, #c9a84c);
    }
    .sep-header-actions { display: flex; gap: 8px; align-items: center; }

    /* Buttons */
    .sep-btn {
      border: none;
      cursor: pointer;
      font-size: 11px;
      font-family: inherit;
      padding: 6px 12px;
      transition: opacity 0.15s;
      letter-spacing: 0.5px;
      min-height: 34px;
    }
    .sep-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .sep-btn-primary {
      background: var(--eso-gold, #c9a84c);
      color: #0d0a06;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .sep-btn-secondary {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(155,115,38,0.35);
      color: var(--eso-text-dim, #a08858);
    }
    .sep-btn-full { width: 100%; margin-top: 10px; padding: 10px; font-size: 12px; }

    /* Add Form */
    .sep-add-form {
      background: rgba(0,0,0,0.25);
      border: 1px solid rgba(155,115,38,0.3);
      padding: 14px;
      margin-bottom: 14px;
    }
    .sep-form-title {
      font-size: 9px;
      font-weight: 600;
      color: var(--eso-gold, #c9a84c);
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 2px;
    }
    .sep-form-divider { text-align: center; font-size: 10px; color: #444; margin: 8px 0; font-family: sans-serif; }
    .sep-form-group { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
    .sep-form-group-sm { max-width: 70px; }
    /* Stack rows on very narrow screens */
    .sep-form-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .sep-form-row .sep-form-group { flex: 1; min-width: 100px; }
    .sep-form-group label {
      font-size: 9px;
      color: var(--eso-text-muted, #6a5030);
      text-transform: uppercase;
      letter-spacing: 1.5px;
    }
    .sep-form-group input,
    .sep-form-group select {
      background: rgba(10,8,3,0.7);
      border: 1px solid rgba(155,115,38,0.35);
      color: var(--eso-text, #e2cfa8);
      font-size: 12px;
      padding: 7px 8px;
      font-family: inherit;
      min-height: 36px;
      width: 100%;
      box-sizing: border-box;
    }
    .sep-form-group input:focus,
    .sep-form-group select:focus { outline: none; border-color: var(--eso-gold, #c9a84c); }
    .sep-form-group select option { background: #0d0a06; }

    /* States */
    .sep-loading { color: var(--eso-text-muted, #6a5030); font-style: italic; font-size: 12px; padding: 20px 0; font-family: sans-serif; }
    .sep-empty { text-align: center; padding: 30px 10px; color: var(--eso-text-muted, #6a5030); font-size: 12px; font-family: sans-serif; }
    .sep-empty-icon { font-size: 24px; display: block; margin-bottom: 8px; opacity: 0.3; }
    .sep-empty-sub { font-size: 11px; color: #444; margin-top: 4px; }

    /* Single-column list */
    .sep-list { display: flex; flex-direction: column; gap: 2px; }

    .sep-item {
      border-left: 3px solid transparent;
      background: rgba(0,0,0,0.2);
      cursor: pointer;
      transition: background 0.15s;
      user-select: none;
    }
    .sep-item:hover { background: rgba(201,168,76,0.05); }
    .sep-item-buff   { border-left-color: #4caf6e; }
    .sep-item-debuff { border-left-color: #e05c44; }
    .sep-item-mixed  { border-left-color: #c9a84c; }

    /* Row: always visible */
    .sep-item-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      min-height: 52px; /* comfortable touch target */
    }
    .sep-item-icon { font-size: 20px; flex-shrink: 0; }
    .sep-item-info { flex: 1; min-width: 0; }
    .sep-item-name {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--eso-text, #e2cfa8);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sep-item-buff   .sep-item-name { color: #8fe8aa; }
    .sep-item-debuff .sep-item-name { color: #f0906e; }
    .sep-item-mixed  .sep-item-name { color: #f2c96a; }
    .sep-item-source {
      display: block;
      font-size: 10px;
      color: var(--eso-text-muted, #6a5030);
      font-family: sans-serif;
      margin-top: 1px;
    }
    .sep-item-time {
      font-size: 10px;
      color: #7b9cd4;
      flex-shrink: 0;
      white-space: nowrap;
      font-family: sans-serif;
    }
    .sep-indf { font-size: 14px; color: #555; }
    .sep-dismiss {
      background: none;
      border: none;
      color: #444;
      cursor: pointer;
      font-size: 12px;
      padding: 0;
      flex-shrink: 0;
      min-height: 36px;
      min-width: 32px;
    }
    .sep-dismiss:hover { color: #e05c44; }

    /* Expanded detail section */
    .sep-item-detail {
      padding: 0 12px 12px 42px;
      border-top: 1px solid rgba(155,115,38,0.12);
      animation: sep-expand 0.15s ease;
    }
    @keyframes sep-expand {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .sep-stat-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .sep-stat { display: flex; align-items: baseline; gap: 8px; font-size: 11px; font-family: sans-serif; }
    .sep-stat-modifier { font-weight: 700; min-width: 44px; flex-shrink: 0; }
    .sep-stat-pos .sep-stat-modifier { color: #4caf6e; }
    .sep-stat-neg .sep-stat-modifier { color: #e05c44; }
    .sep-stat-name { color: var(--eso-text-dim, #a08858); }
    .sep-item-meta {
      margin-top: 8px;
      font-size: 10px;
      color: #7b9cd4;
      font-family: sans-serif;
    }
    .sep-notes { font-size: 10px; color: #555; margin-top: 4px; font-style: italic; font-family: sans-serif; }
  `]
})
export class StatusEffectsPanelComponent implements OnInit, OnDestroy {

  @Input() compact = false;

  private readonly http = inject(HttpClient);

  // ── Signals ──
  activeEffects = signal<StatusEffect[]>([]);
  templates     = signal<EffectTemplate[]>([]);
  isLoading     = signal(true);
  showAddForm   = signal(false);
  expandedId    = signal<string | null>(null);

  // ── Computed Columns (used by full-mode summary counts) ──
  buffEffects   = computed(() => this.activeEffects().filter(e => e.type === 'buff'));
  debuffEffects = computed(() => this.activeEffects().filter(e => e.type === 'debuff'));
  mixedEffects  = computed(() => this.activeEffects().filter(e => e.type === 'mixed'));

  // ── Form State ──
  form = {
    name: '',
    type: 'buff' as 'buff' | 'debuff' | 'mixed',
    category: 'substance' as string,
    source: '',
    icon: '✦',
    duration: 360,
    notes: '',
  };

  canSubmit = computed(() => !!this.form.name.trim() && !!this.form.source.trim());

  // ── Refresh interval (every 60s to update countdowns) ──
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadData();
    this.refreshTimer = setInterval(() => {
      // Trigger re-render so countdown timers update
      this.activeEffects.set([...this.activeEffects()]);
    }, 60_000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  refresh(): void {
    this.isLoading.set(true);
    this.loadData();
  }

  private loadData(): void {
    forkJoin({
      effects:   this.http.get<{ success: boolean; effects: StatusEffect[] }>(`${environment.apiUrl}/api/status-effects`),
      templates: this.http.get<{ success: boolean; templates: EffectTemplate[] }>(`${environment.apiUrl}/api/status-effects/templates`),
    }).subscribe({
      next: ({ effects, templates }) => {
        if (effects.success)   this.activeEffects.set(effects.effects);
        if (templates.success) this.templates.set(templates.templates);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  applyTemplate(event: Event): void {
    const name = (event.target as HTMLSelectElement).value;
    if (!name) return;
    const tpl = this.templates().find(t => t.name === name);
    if (!tpl) return;

    // For templates, submit immediately
    this.http.post<{ success: boolean; effect: StatusEffect }>(
      `${environment.apiUrl}/api/status-effects`,
      {
        name: tpl.name,
        type: tpl.type,
        category: tpl.category,
        source: tpl.source,
        icon: tpl.icon,
        effects: tpl.effects,
        duration: tpl.duration,
      }
    ).subscribe({
      next: res => {
        if (res.success) {
          this.activeEffects.set([...this.activeEffects(), res.effect]);
          (event.target as HTMLSelectElement).value = '';
          this.showAddForm.set(false);
        }
      },
    });
  }

  submitEffect(): void {
    if (!this.canSubmit()) return;

    this.http.post<{ success: boolean; effect: StatusEffect }>(
      `${environment.apiUrl}/api/status-effects`,
      {
        name: this.form.name,
        type: this.form.type,
        category: this.form.category,
        source: this.form.source,
        icon: this.form.icon || '✦',
        effects: [],
        duration: this.form.duration,
        notes: this.form.notes || undefined,
      }
    ).subscribe({
      next: res => {
        if (res.success) {
          this.activeEffects.set([...this.activeEffects(), res.effect]);
          this.resetForm();
          this.showAddForm.set(false);
        }
      },
    });
  }

  dismissEffect(id: string): void {
    this.http.delete(`${environment.apiUrl}/api/status-effects/${id}`).subscribe({
      next: () => {
        this.activeEffects.set(this.activeEffects().filter(e => e.id !== id));
      },
    });
  }

  timeRemaining(expiresAt: string): string {
    const diffMs = new Date(expiresAt).getTime() - Date.now();
    if (diffMs <= 0) return 'Expired';
    const totalMin = Math.floor(diffMs / 60_000);
    const hours    = Math.floor(totalMin / 60);
    const mins     = totalMin % 60;
    if (hours > 0) return `${hours}h ${mins}m remaining`;
    return `${mins}m remaining`;
  }

  /** Short format for compact left-column strip: "4h 12m" or "45m" or "exp" */
  timeRemainingShort(expiresAt: string): string {
    const diffMs = new Date(expiresAt).getTime() - Date.now();
    if (diffMs <= 0) return 'exp';
    const totalMin = Math.floor(diffMs / 60_000);
    const hours    = Math.floor(totalMin / 60);
    const mins     = totalMin % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  toggleExpand(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  private resetForm(): void {
    this.form = { name: '', type: 'buff', category: 'substance', source: '', icon: '✦', duration: 360, notes: '' };
  }
}
