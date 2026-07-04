import { Component, signal, inject, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { environment } from '../environments/environment';
import { SocketService } from './socket.service';

interface QuestField { label: string; value: string; }
interface QuestClass { name: string; fields: QuestField[]; }

const CLASS_META: Record<string, { icon: string; color: string; lore: string }> = {
  'Paladin of God': {
    icon: '✝', color: '#c8a84b',
    lore: 'Walk in the Spirit. Put on the full Armor of God daily — prayer, scripture, and surrender. Your greatest battles are won on your knees before the One who already won the war.',
  },
  'Web App Developer': {
    icon: '⌨', color: '#7b68ee',
    lore: 'Build systems that endure. Ship clean code. Solve real problems for real users. Every pull request is a brick in the cathedral — the work compounds into mastery.',
  },
  'RedTeam Operator': {
    icon: '◉', color: '#e05c44',
    lore: 'Think like the adversary. Move unseen. Every exploit discovered is a vulnerability your allies no longer need to fear. Knowledge is the weapon — precision is the discipline.',
  },
  'Artist': {
    icon: '◈', color: '#4caf6e',
    lore: 'Create without apology. Art is evidence of a soul. The work does not need to be perfect — it needs to be made. Ship it, then make the next one better.',
  },
  'Financial Strategist': {
    icon: '◆', color: '#5ba0d0',
    lore: 'Build the fortress before the storm arrives. Every dollar deployed with intention compounds into freedom. Wealth is patience in action and discipline over time.',
  },
};

@Component({
  selector: 'app-quests-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="qj-shell">

      <!-- ── LEFT: Zone / Quest list ───────────────────────────────── -->
      <div class="qj-left">
        <div class="qj-left-header">
          <span class="qj-title">QUEST JOURNAL</span>
          <span class="qj-count" *ngIf="!isLoading()">{{ loggedCount }}/{{ totalCount }}</span>
        </div>

        <div class="qj-list">
          <div *ngIf="isLoading()" class="qj-loading">◈ Loading...</div>

          <div *ngFor="let cls of questClasses()" class="qj-zone-block">
            <!-- Zone header (class name) -->
            <div class="qj-zone-row"
                 [class.zone-expanded]="isExpanded(cls.name)"
                 (click)="toggleExpand(cls.name)">
              <span class="zone-arrow">{{ isExpanded(cls.name) ? '▼' : '▶' }}</span>
              <span class="zone-icon" [style.color]="classMeta(cls.name).color">{{ classMeta(cls.name).icon }}</span>
              <span class="zone-name">{{ cls.name | uppercase }}</span>
              <span class="zone-progress" *ngIf="classLoggedCount(cls) > 0 && !isExpanded(cls.name)">
                {{ classLoggedCount(cls) }}/{{ cls.fields.length }}
              </span>
            </div>

            <!-- Quest fields under this zone -->
            <div *ngIf="isExpanded(cls.name)" class="qj-field-list">
              <div *ngFor="let field of cls.fields; let i = index"
                   class="qj-quest-row"
                   [class.quest-sel]="isSelected(cls.name, i)"
                   (click)="selectField(cls.name, i)">
                <span class="q-bullet" [class.q-done]="isLogged(field)">
                  {{ isLogged(field) ? '✓' : '◆' }}
                </span>
                <span class="q-label" [class.q-label-done]="isLogged(field)">{{ field.label }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="qj-footer">
          <span class="qj-date-nav">
            <button class="qj-nav-btn" (click)="prevDay()" title="Previous day">‹</button>
            <span class="qj-date-label">{{ selectedDate() }}</span>
            <button class="qj-nav-btn" (click)="nextDay()" [disabled]="isViewingToday" title="Next day">›</button>
          </span>
          <span class="qj-sync-row">
            <span *ngIf="lastSynced()" class="qj-last-synced">↻ {{ lastSynced() }}</span>
            <button class="qj-sync-btn" (click)="manualSync()" title="Refresh quests">↻</button>
          </span>
        </div>
      </div>

      <!-- ── RIGHT: Quest detail pane ──────────────────────────────── -->
      <div class="qj-right">

        <!-- Empty state -->
        <div *ngIf="!activeField" class="qj-no-sel">
          <span class="no-sel-icon">◈</span>
          <span class="no-sel-text">Select a quest to view details</span>
        </div>

        <!-- Quest detail -->
        <div *ngIf="activeField" class="qj-detail">

          <div class="qj-detail-head">
            <div class="qj-quest-name">{{ activeField.label | uppercase }}</div>
            <div class="qj-zone-chip" [style.color]="classMeta(activeClassName).color">
              {{ classMeta(activeClassName).icon }} {{ activeClassName }}
            </div>
          </div>

          <p class="qj-lore">{{ classMeta(activeClassName).lore }}</p>

          <div class="qj-tasks">
            <div class="qj-tasks-hdr">
              TASKS
            </div>
            <textarea
              class="qj-task-area"
              [placeholder]="'Log progress for: ' + activeField.label"
              [(ngModel)]="activeField.value"
              (ngModelChange)="onFieldChange(activeClassName, activeField.label, $event)">
            </textarea>
          </div>

          <div class="qj-reward-bar">
            <span class="reward-icon">✦</span>
            <span class="reward-label">XP REWARD</span>
            <span class="reward-val">{{ isLogged(activeField) ? '+25 XP confirmed' : 'Pending completion' }}</span>
            <span class="qj-save"
                  [class.is-saving]="saveStatus() === 'saving'"
                  [class.is-saved]="saveStatus() === 'saved'">
              <ng-container *ngIf="saveStatus() === 'saving'">◌ saving...</ng-container>
              <ng-container *ngIf="saveStatus() === 'saved'">✓ saved</ng-container>
            </span>
          </div>

        </div>
      </div>

    </div>
  `,
  styles: [`
    /* ── ESO Quest Journal Shell ─────────────────────────────────── */
    :host { display: block; height: 100%; }
    .qj-shell {
      display: flex; height: 100%; min-height: 520px;
      background: var(--eso-bg-panel, #100e07);
      border: 1px solid var(--eso-border, rgba(155,115,38,0.45));
      font-family: 'Cinzel', serif;
      overflow: hidden;
    }

    /* ── LEFT PANE ───────────────────────────────────────────────── */
    .qj-left {
      width: 280px; min-width: 280px;
      background: var(--eso-bg-panel-alt, #1a1408);
      border-right: 1px solid var(--eso-border, rgba(155,115,38,0.45));
      display: flex; flex-direction: column; overflow: hidden;
    }
    .qj-left-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px 10px; flex-shrink: 0;
      border-bottom: 1px solid rgba(155,115,38,0.35);
    }
    .qj-title { font-size: 12px; font-weight: 700; letter-spacing: 2.5px; color: var(--eso-text, #e2cfa8); }
    .qj-count { font-size: 11px; color: var(--eso-gold, #c9a84c); font-weight: 700; }

    .qj-list { flex: 1; overflow-y: auto; }
    .qj-loading { padding: 32px 16px; text-align: center; font-size: 12px; color: var(--eso-text-dim, #a08858); letter-spacing: 1px; }

    /* Zone (class) header row */
    .qj-zone-row {
      display: flex; align-items: center; gap: 7px;
      padding: 9px 14px; cursor: pointer;
      transition: background 0.12s;
    }
    .qj-zone-row:hover { background: rgba(201,168,76,0.06); }
    .qj-zone-row.zone-expanded { background: rgba(201,168,76,0.08); }
    .zone-arrow  { font-size: 9px; color: var(--eso-gold, #c9a84c); width: 10px; flex-shrink: 0; }
    .zone-icon   { font-size: 13px; flex-shrink: 0; }
    .zone-name   { flex: 1; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; color: var(--eso-text, #e2cfa8); }
    .zone-progress { font-size: 9px; color: var(--eso-gold, #c9a84c); font-weight: 700; }

    /* Quest field rows */
    .qj-field-list { background: rgba(0,0,0,0.22); padding-bottom: 2px; }
    .qj-quest-row {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 14px 6px 30px; cursor: pointer;
      border-left: 2px solid transparent;
      transition: background 0.12s, border-left-color 0.12s;
    }
    .qj-quest-row:hover { background: rgba(201,168,76,0.06); }
    .qj-quest-row.quest-sel {
      background: rgba(201,168,76,0.13);
      border-left-color: var(--eso-gold, #c9a84c);
    }
    .q-bullet { font-size: 9px; color: var(--eso-gold, #c9a84c); flex-shrink: 0; }
    .q-bullet.q-done { color: #6fcf7d; }
    .q-label  { font-size: 11px; color: var(--eso-text-dim, #a08858); line-height: 1.4; }
    .q-label.q-label-done { color: var(--eso-text, #e2cfa8); }

    .qj-footer {
      padding: 7px 14px; flex-shrink: 0; font-size: 10px;
      letter-spacing: 1px; color: var(--eso-text-dim, #a08858);
      border-top: 1px solid rgba(155,115,38,0.2);
      display: flex; align-items: center; justify-content: space-between;
    }
    .qj-sync-row { display: flex; align-items: center; gap: 5px; }
    .qj-last-synced { font-size: 9px; color: rgba(160,136,88,0.55); letter-spacing: 0.5px; }
    .qj-sync-btn {
      background: none; border: 1px solid rgba(155,115,38,0.30);
      color: var(--eso-gold, #c9a84c); font-size: 11px;
      padding: 1px 5px; cursor: pointer; border-radius: 2px;
      line-height: 1; transition: background 0.12s;
    }
    .qj-sync-btn:hover { background: rgba(201,168,76,0.10); }
    .qj-date-nav { display: flex; align-items: center; gap: 4px; }
    .qj-nav-btn {
      background: none; border: 1px solid rgba(155,115,38,0.30);
      color: var(--eso-gold, #c9a84c); font-size: 14px; line-height: 1;
      padding: 1px 6px; cursor: pointer; border-radius: 2px;
      transition: background 0.12s;
    }
    .qj-nav-btn:hover:not(:disabled) { background: rgba(201,168,76,0.10); }
    .qj-nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    .qj-date-label { font-size: 10px; letter-spacing: 0.8px; color: var(--eso-text-dim, #a08858); min-width: 82px; text-align: center; }

    /* ── RIGHT PANE ─────────────────────────────────────────────── */
    .qj-right { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

    .qj-no-sel {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 12px;
    }
    .no-sel-icon { font-size: 32px; color: rgba(201,168,76,0.25); }
    .no-sel-text { font-size: 12px; letter-spacing: 1px; color: var(--eso-text-dim, #a08858); }

    .qj-detail {
      flex: 1; display: flex; flex-direction: column;
      padding: 22px 26px 18px; overflow-y: auto;
    }
    .qj-detail-head { margin-bottom: 14px; }
    .qj-quest-name {
      font-size: 18px; font-weight: 700; letter-spacing: 2px;
      color: var(--eso-gold-bright, #f2c96a); margin-bottom: 5px;
    }
    .qj-zone-chip { font-size: 11px; letter-spacing: 1px; font-weight: 600; }

    .qj-lore {
      font-family: 'Open Sans', sans-serif;
      font-size: 12px; color: var(--eso-text-dim, #a08858);
      line-height: 1.7; margin: 0 0 22px 0;
      border-left: 2px solid rgba(201,168,76,0.25);
      padding-left: 12px; font-style: italic;
    }

    .qj-tasks { flex: 1; display: flex; flex-direction: column; gap: 8px; }
    .qj-tasks-hdr {
      font-size: 10px; font-weight: 700; letter-spacing: 2px;
      color: var(--eso-text-dim, #a08858);
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(155,115,38,0.2);
      display: flex; align-items: center; gap: 8px;
    }
    .qj-task-area {
      flex: 1; min-height: 130px;
      background: rgba(0,0,0,0.35);
      border: 1px solid rgba(155,115,38,0.30);
      color: var(--eso-text, #e2cfa8);
      font-size: 13px; font-family: 'Open Sans', sans-serif;
      line-height: 1.6; padding: 12px 14px; resize: vertical;
      transition: border-color 0.15s, background 0.15s;
    }
    .qj-task-area:focus {
      outline: none;
      border-color: rgba(201,168,76,0.55);
      background: rgba(0,0,0,0.45);
    }
    .qj-task-area::placeholder { color: rgba(160,136,88,0.40); font-style: italic; font-family: 'Cinzel', serif; font-size: 11px; }

    .qj-reward-bar {
      display: flex; align-items: center; gap: 8px;
      padding-top: 12px; margin-top: 14px; flex-shrink: 0;
      border-top: 1px solid rgba(155,115,38,0.2);
    }
    .reward-icon  { color: var(--eso-gold, #c9a84c); font-size: 12px; }
    .reward-label { font-size: 10px; letter-spacing: 1.5px; color: var(--eso-text-dim, #a08858); }
    .reward-val   { flex: 1; font-size: 12px; font-weight: 700; color: var(--eso-gold-bright, #f2c96a); }
    .qj-save {
      font-size: 11px; letter-spacing: 0.5px; color: transparent;
      transition: color 0.2s; min-width: 80px; text-align: right;
    }
    .qj-save.is-saving { color: var(--eso-gold, #c9a84c); }
    .qj-save.is-saved  { color: #6fcf7d; }

    @media (max-width: 640px) {
      .qj-left { width: 200px; min-width: 200px; }
      .qj-quest-name { font-size: 14px; }
    }

    /* ── Mobile: stack quest list above detail pane ── */
    @media (max-width: 480px) {
      .qj-shell { flex-direction: column; min-height: unset; }
      .qj-left  {
        width: 100%; min-width: unset; max-height: 220px;
        border-right: none;
        border-bottom: 1px solid var(--eso-border, rgba(155,115,38,0.45));
      }
      .qj-right { flex: 1; min-height: 300px; }
    }
  `],
})
export class QuestsPanelComponent implements OnInit, OnDestroy {
  private http          = inject(HttpClient);
  private socketService = inject(SocketService);

  isLoading    = signal(true);
  saveStatus   = signal<'idle' | 'saving' | 'saved'>('idle');
  questClasses = signal<QuestClass[]>([]);
  lastSynced   = signal<string>('');
  private readonly todayStr = new Date().toLocaleDateString('en-CA');
  selectedDate = signal(this.todayStr);
  @Output() dateChanged = new EventEmitter<string>();

  // ── Selection state ──────────────────────────────────────────────
  private _activeName = signal<string>('');
  private _activeIdx  = signal<number>(-1);
  private _expanded   = signal<Set<string>>(new Set());

  get activeClassName(): string { return this._activeName(); }

  get activeField(): QuestField | null {
    const cls = this.questClasses().find(c => c.name === this._activeName());
    const idx = this._activeIdx();
    return cls?.fields[idx] ?? null;
  }

  get totalCount(): number {
    return this.questClasses().reduce((s, c) => s + c.fields.length, 0);
  }

  get loggedCount(): number {
    return this.questClasses().reduce(
      (s, c) => s + c.fields.filter(f => this.isLogged(f)).length, 0
    );
  }

  isExpanded(name: string): boolean { return this._expanded().has(name); }

  isSelected(className: string, idx: number): boolean {
    return this._activeName() === className && this._activeIdx() === idx;
  }

  isLogged(field: QuestField): boolean { return field.value.trim().length > 0; }

  classLoggedCount(cls: QuestClass): number {
    return cls.fields.filter(f => this.isLogged(f)).length;
  }

  toggleExpand(name: string): void {
    const s = new Set(this._expanded());
    if (s.has(name)) {
      s.delete(name);
      if (this._activeName() === name) {
        this._activeName.set('');
        this._activeIdx.set(-1);
      }
    } else {
      s.add(name);
    }
    this._expanded.set(s);
  }

  selectField(className: string, idx: number): void {
    this._activeName.set(className);
    this._activeIdx.set(idx);
  }

  classMeta(name: string) {
    return CLASS_META[name] ?? { icon: '◆', color: '#c9a84c', lore: 'Press forward. The path continues.' };
  }

  // ── Save / load infrastructure ────────────────────────────────────
  private fieldQueues      = new Map<string, Subject<string>>();
  private activeSaves      = 0;
  private dirtyFields      = new Set<string>();
  private dirtyFieldValues = new Map<string, string>();
  private lastSavedValues  = new Map<string, string>();
  private socketSub: Subscription | undefined;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly POLL_INTERVAL_MS = 30_000;

  get isViewingToday(): boolean { return this.selectedDate() === this.todayStr; }

  prevDay(): void {
    const d = new Date(this.selectedDate() + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    this.navigateToDate(d.toLocaleDateString('en-CA'));
  }

  nextDay(): void {
    if (this.isViewingToday) return;
    const d = new Date(this.selectedDate() + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    this.navigateToDate(d.toLocaleDateString('en-CA'));
  }

  private navigateToDate(date: string): void {
    this.selectedDate.set(date);
    this.dateChanged.emit(date);
    this.dirtyFields.clear();
    this.dirtyFieldValues.clear();
    this._activeName.set('');
    this._activeIdx.set(-1);
    this._expanded.set(new Set());
    // Clear stale quest data before loading the new date so any concurrent
    // loadQuestsWithMerge() (triggered by mobile visibilitychange) cannot read
    // the previous date's values and bleed them into the new date's view.
    this.questClasses.set([]);
    this.loadQuests();
  }

  ngOnInit(): void {
    this.dateChanged.emit(this.todayStr); // Sync parent on panel open/re-open
    this.loadQuests();

    // WebSocket: instant reload when the journal file changes on disk
    this.socketSub = this.socketService.onJournalUpdate().subscribe(() => {
      if (this.dirtyFields.size === 0 && this.activeSaves === 0) {
        console.log('[QUESTS SYNC] 🔌 Socket event → full reload (no dirty fields)');
        this.loadQuests();
      } else {
        console.log(`[QUESTS SYNC] 🔌 Socket event → merge reload (dirty: [${[...this.dirtyFields].join(', ')}], activeSaves: ${this.activeSaves})`);
        this.loadQuestsWithMerge();
      }
    });

    // Polling fallback: catches changes the socket may have missed
    this.pollTimer = setInterval(() => {
      if (this.dirtyFields.size === 0 && this.activeSaves === 0) {
        console.log('[QUESTS SYNC] ⏰ Poll → merge reload');
        this.loadQuestsWithMerge();
      } else {
        console.log(`[QUESTS SYNC] ⏰ Poll → skipped (dirty: [${[...this.dirtyFields].join(', ')}], activeSaves: ${this.activeSaves})`);
      }
    }, this.POLL_INTERVAL_MS);

    // Visibility change: re-sync when user returns to this browser tab
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  ngOnDestroy(): void {
    this.socketSub?.unsubscribe();
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.fieldQueues.forEach(q => q.complete());
    this.fieldQueues.clear();
    this.dirtyFields.clear();
    this.dirtyFieldValues.clear();
    this.lastSavedValues.clear();
  }

  private readonly onVisibilityChange = (): void => {
    if (!document.hidden) {
      if (this.dirtyFields.size === 0 && this.activeSaves === 0) {
        console.log('[QUESTS SYNC] 👁 Tab visible → merge reload');
        this.loadQuestsWithMerge();
      } else {
        console.log(`[QUESTS SYNC] 👁 Tab visible → skipped (dirty: [${[...this.dirtyFields].join(', ')}], activeSaves: ${this.activeSaves})`);
      }
    }
  };

  manualSync(): void {
    if (this.dirtyFields.size === 0 && this.activeSaves === 0) {
      console.log('[QUESTS SYNC] ↻ Manual sync → full reload');
      this.loadQuests();
    } else {
      console.log(`[QUESTS SYNC] ↻ Manual sync → merge reload (dirty: [${[...this.dirtyFields].join(', ')}])`);
      this.loadQuestsWithMerge();
    }
  }

  onFieldChange(className: string, label: string, value: string): void {
    const key = `${className}:${label}`;
    const isNewDirty = !this.dirtyFields.has(key);
    this.dirtyFields.add(key);
    this.dirtyFieldValues.set(key, value);
    if (isNewDirty) {
      console.log(`[QUESTS DIRTY] ✏️  Field marked dirty: "${key}"`);
    }
    if (!this.fieldQueues.has(key)) {
      const q = new Subject<string>();
      q.pipe(debounceTime(700)).subscribe(val => this.doSave(className, label, val));
      this.fieldQueues.set(key, q);
    }
    this.fieldQueues.get(key)!.next(value);
  }

  private doSave(className: string, label: string, value: string): void {
    const key = `${className}:${label}`;
    this.activeSaves++;
    this.saveStatus.set('saving');
    this.http.put(`${environment.apiUrl}/api/quests/today`, {
      date: this.selectedDate(), className, label, value
    }).subscribe({
      next: () => {
        this.lastSavedValues.set(key, value);
        // Only clear dirty if no newer typing occurred after this save was dispatched.
        if (this.dirtyFieldValues.get(key) === value) {
          this.dirtyFields.delete(key);
          this.dirtyFieldValues.delete(key);
          console.log(`[QUESTS SAVE] ✅ Saved & dirty cleared: "${key}" (${value.length} chars)`);
        } else {
          console.log(`[QUESTS SAVE] ✅ Saved but dirty KEPT: "${key}" — value changed since dispatch`);
        }
        this.activeSaves = Math.max(0, this.activeSaves - 1);
        if (this.activeSaves === 0) {
          this.saveStatus.set('saved');
          setTimeout(() => this.saveStatus.set('idle'), 2000);
        }
      },
      error: (err) => {
        console.error(`[QUESTS SAVE] ❌ Save failed for "${key}":`, err);
        // On error: keep dirty so the value can be retried or protected from overwrite
        this.activeSaves = Math.max(0, this.activeSaves - 1);
        if (this.activeSaves === 0) this.saveStatus.set('idle');
      }
    });
  }

  loadQuests(): void {
    console.log(`[QUESTS LOAD] 📥 Full reload for date: ${this.selectedDate()}`);
    this.isLoading.set(true);
    this.http.get<{ success: boolean; classes: QuestClass[] }>(
      `${environment.apiUrl}/api/quests/today?date=${this.selectedDate()}`
    ).subscribe({
      next: (res) => {
        if (res.success) {
          const classes = res.classes.map(c => ({
            ...c,
            fields: c.fields.map(f => ({
              label: f.label,
              value: f.value === '[To be logged]' ? '' : f.value,
            })),
          }));
          const totalFields = classes.reduce((s, c) => s + c.fields.length, 0);
          console.log(`[QUESTS LOAD] ✔️ Full reload complete: ${classes.length} classes, ${totalFields} fields`);
          this.questClasses.set(classes);
          this.lastSynced.set(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
          // Auto-expand first class and select its first field
          if (classes.length > 0 && this._activeName() === '') {
            const first = classes[0].name;
            this._expanded.set(new Set([first]));
            this._activeName.set(first);
            this._activeIdx.set(0);
          }
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('[QUESTS LOAD] ❌ Full reload failed:', err);
        this.isLoading.set(false);
      },
    });
  }

  private loadQuestsWithMerge(): void {
    console.log(`[QUESTS MERGE] 🔀 Merge reload for date: ${this.selectedDate()} (protecting dirty: [${[...this.dirtyFields].join(', ')}])`);
    this.http.get<{ success: boolean; classes: QuestClass[] }>(
      `${environment.apiUrl}/api/quests/today?date=${this.selectedDate()}`
    ).subscribe({
      next: (res) => {
        if (res.success) {
          const protectedFields: string[] = [];
          const classes = res.classes.map(c => ({
            ...c,
            fields: c.fields.map(f => {
              const key = `${c.name}:${f.label}`;
              if (this.dirtyFields.has(key)) {
                protectedFields.push(key);
                return { label: f.label, value: this.dirtyFieldValues.get(key) ?? f.value };
              }
              return { label: f.label, value: f.value === '[To be logged]' ? '' : f.value };
            }),
          }));
          if (protectedFields.length > 0) {
            console.log(`[QUESTS MERGE] 🛡️  Protected from overwrite: [${protectedFields.join(', ')}]`);
          }
          const totalFields = classes.reduce((s, c) => s + c.fields.length, 0);
          console.log(`[QUESTS MERGE] ✔️ Merge complete: ${classes.length} classes, ${totalFields} fields`);
          this.questClasses.set(classes);
          this.lastSynced.set(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        }
      },
      error: (err) => console.error('[QUESTS MERGE] ❌ Merge reload failed:', err),
    });
  }
}
