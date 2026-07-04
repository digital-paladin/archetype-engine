import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { forkJoin, of } from 'rxjs';
import { environment } from '../environments/environment';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  priority?: 1 | 2 | 3 | 4;
  labels?: string[];
  due?: { date?: string; datetime?: string; string?: string };
  project_id?: string;
  url?: string;
  is_completed?: boolean;
}

interface QuestPointers {
  current: TodoistTask | null;
  next: TodoistTask | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-todoist-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="todoist-container">

      <!-- ══ Quest Pointer Widget ══ -->
      <div class="pointer-widget">
        <div class="pointer-header">
          <span class="pointer-icon">⚔️</span>
          <h2 class="pointer-title">QUEST POINTERS</h2>
          <button class="refresh-btn" (click)="reload()" [disabled]="isLoading()" title="Refresh">↺</button>
        </div>

        <div class="pointer-slots" *ngIf="!isLoading(); else loadingTpl">

          <!-- Current Quest slot -->
          <div class="pointer-slot slot-current" [class.slot-empty]="!pointers()?.current">
            <div class="slot-label">
              <span class="slot-badge badge-current">P1 🔴</span>
              <span class="slot-name">CURRENT QUEST</span>
              <button class="change-btn" (click)="openPicker('current')" title="Change current quest">change</button>
            </div>
            <div class="slot-task" *ngIf="pointers()?.current as task; else emptySlotCurrent">
              <span class="task-content">{{ task.content }}</span>
              <span class="task-due" *ngIf="task.due?.date">📅 {{ task.due!.date }}</span>
            </div>
            <ng-template #emptySlotCurrent>
              <div class="slot-empty-text">No current quest — pick one below</div>
            </ng-template>
          </div>

          <!-- Next Quest slot -->
          <div class="pointer-slot slot-next" [class.slot-empty]="!pointers()?.next">
            <div class="slot-label">
              <span class="slot-badge badge-next">P2 🟠</span>
              <span class="slot-name">NEXT QUEST</span>
              <button class="change-btn" (click)="openPicker('next')" title="Change next quest">change</button>
            </div>
            <div class="slot-task" *ngIf="pointers()?.next as task; else emptySlotNext">
              <span class="task-content">{{ task.content }}</span>
              <span class="task-due" *ngIf="task.due?.date">📅 {{ task.due!.date }}</span>
            </div>
            <ng-template #emptySlotNext>
              <div class="slot-empty-text">No next quest assigned</div>
            </ng-template>
          </div>
        </div>

        <ng-template #loadingTpl>
          <div class="todoist-loading">◈ Loading quest pointers...</div>
        </ng-template>

        <div class="pointer-error" *ngIf="pointerError()">⚠ {{ pointerError() }}</div>
      </div>

      <!-- ══ Task Picker Modal ══ -->
      <div class="picker-overlay" *ngIf="pickerOpen()" (click)="closePicker()">
        <div class="picker-modal" (click)="$event.stopPropagation()">
          <div class="picker-header">
            <span class="picker-title">
              Set {{ pickerSlot() === 'current' ? '⚔️ Current Quest' : '→ Next Quest' }}
            </span>
            <button class="picker-close" (click)="closePicker()">✕</button>
          </div>

          <input
            class="picker-search"
            [(ngModel)]="pickerSearch"
            placeholder="Search tasks..."
            autofocus
          />

          <div class="picker-list">
            <div *ngIf="pickerLoading()" class="picker-empty">Loading tasks...</div>

            <div
              *ngFor="let task of filteredTasks()"
              class="picker-item"
              [class.picker-item-selected]="isActivePointer(task)"
              (click)="selectTask(task)"
            >
              <div class="picker-item-content">{{ task.content }}</div>
              <div class="picker-item-meta">
                <span *ngIf="task.due?.date" class="picker-meta-due">📅 {{ task.due!.date }}</span>
                <span *ngFor="let label of task.labels" class="picker-meta-label">{{ label }}</span>
              </div>
            </div>

            <div *ngIf="!pickerLoading() && filteredTasks().length === 0" class="picker-empty">
              No tasks found
            </div>
          </div>

          <!-- Clear slot -->
          <button
            class="picker-clear-btn"
            (click)="clearSlot()"
            *ngIf="pickerSlot() === 'current' ? pointers()?.current : pointers()?.next"
          >
            Clear {{ pickerSlot() === 'current' ? 'current' : 'next' }} quest pointer
          </button>
        </div>
      </div>

      <!-- ══ All Tasks List ══ -->
      <div class="task-section">
        <div class="task-section-header">
          <span class="task-section-title">ALL ACTIVE TASKS</span>
          <span class="task-count">{{ allTasks().length }} tasks</span>
        </div>

        <div *ngIf="isLoading()" class="todoist-loading">◈ Loading...</div>

        <div class="task-list" *ngIf="!isLoading()">
          <div
            *ngFor="let task of allTasks()"
            class="task-row"
            [class.task-is-current]="isCurrentPointer(task)"
            [class.task-is-next]="isNextPointer(task)"
          >
            <div class="task-priority-pip" [class]="'pip-p' + (task.priority ?? 1)"></div>
            <div class="task-info">
              <span class="task-row-content">{{ task.content }}</span>
              <div class="task-row-meta">
                <span *ngIf="task.due?.date" class="task-meta-due">📅 {{ task.due!.date }}</span>
                <span *ngFor="let label of (task.labels ?? [])" class="task-meta-label">{{ label }}</span>
              </div>
            </div>
            <div class="task-actions">
              <button
                class="task-action-btn btn-current"
                [class.active]="isCurrentPointer(task)"
                (click)="setPointer('current', task)"
                title="Set as current quest"
              >⚔️</button>
              <button
                class="task-action-btn btn-next"
                [class.active]="isNextPointer(task)"
                (click)="setPointer('next', task)"
                title="Set as next quest"
              >→</button>
            </div>
          </div>

          <div class="task-empty" *ngIf="allTasks().length === 0">
            No active tasks — create one in Todoist
          </div>
        </div>
      </div>

    </div>
  `,
  styles: [`
    .todoist-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 12px;
      font-family: 'Segoe UI', sans-serif;
      color: #e0d5c0;
    }

    /* ── Quest Pointer Widget ── */
    .pointer-widget {
      background: rgba(200, 168, 75, 0.06);
      border: 1px solid #c8a84b44;
      border-radius: 8px;
      padding: 14px;
    }
    .pointer-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .pointer-icon { font-size: 18px; }
    .pointer-title {
      flex: 1;
      font-size: 13px;
      font-weight: 700;
      color: #c8a84b;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 0;
    }
    .refresh-btn {
      background: none;
      border: 1px solid #2a2a4a;
      color: #888;
      border-radius: 4px;
      cursor: pointer;
      padding: 2px 8px;
      font-size: 14px;
    }
    .refresh-btn:hover { color: #c8a84b; border-color: #c8a84b44; }
    .refresh-btn:disabled { opacity: 0.4; cursor: default; }

    .pointer-slots { display: flex; flex-direction: column; gap: 10px; }

    .pointer-slot {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      padding: 10px 12px;
      transition: border-color 0.2s;
    }
    .slot-current { border-left: 3px solid #e05c44; }
    .slot-next    { border-left: 3px solid #f5a623; }
    .slot-empty   { opacity: 0.7; }

    .slot-label {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    .slot-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 3px;
    }
    .badge-current { background: rgba(224,92,68,0.2); color: #e05c44; }
    .badge-next    { background: rgba(245,166,35,0.2); color: #f5a623; }
    .slot-name {
      flex: 1;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: #888;
      text-transform: uppercase;
    }
    .change-btn {
      background: none;
      border: 1px solid #2a2a4a;
      color: #888;
      border-radius: 3px;
      font-size: 10px;
      padding: 1px 6px;
      cursor: pointer;
    }
    .change-btn:hover { color: #c8a84b; border-color: #c8a84b44; }

    .slot-task { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .task-content { font-size: 13px; color: #e0d5c0; font-weight: 500; }
    .task-due { font-size: 11px; color: #888; }
    .slot-empty-text { font-size: 12px; color: #555; font-style: italic; }

    .pointer-error { font-size: 12px; color: #e05c44; margin-top: 6px; }
    .todoist-loading { font-size: 13px; color: #555; padding: 8px 0; }

    /* ── Picker Modal ── */
    .picker-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.7);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000;
    }
    .picker-modal {
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      border-radius: 10px;
      width: min(520px, 94vw);
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .picker-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid #2a2a4a;
    }
    .picker-title { font-size: 14px; font-weight: 700; color: #c8a84b; }
    .picker-close {
      background: none; border: none; color: #888;
      font-size: 16px; cursor: pointer; padding: 2px 6px;
    }
    .picker-close:hover { color: #e05c44; }
    .picker-search {
      margin: 10px 12px 0;
      background: rgba(255,255,255,0.05);
      border: 1px solid #2a2a4a;
      border-radius: 5px;
      color: #e0d5c0;
      padding: 7px 10px;
      font-size: 13px;
      outline: none;
    }
    .picker-search:focus { border-color: #c8a84b44; }
    .picker-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .picker-item {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 5px;
      padding: 8px 10px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .picker-item:hover { background: rgba(200,168,75,0.08); border-color: #c8a84b44; }
    .picker-item-selected { border-color: #c8a84b; background: rgba(200,168,75,0.12); }
    .picker-item-content { font-size: 13px; color: #e0d5c0; margin-bottom: 3px; }
    .picker-item-meta { display: flex; gap: 6px; flex-wrap: wrap; }
    .picker-meta-due { font-size: 11px; color: #888; }
    .picker-meta-label {
      font-size: 10px; color: #7b68ee;
      background: rgba(123,104,238,0.12);
      padding: 0 4px; border-radius: 3px;
    }
    .picker-empty { font-size: 13px; color: #555; padding: 12px 0; text-align: center; }
    .picker-clear-btn {
      margin: 8px 12px 12px;
      background: rgba(224,92,68,0.12);
      border: 1px solid rgba(224,92,68,0.3);
      border-radius: 5px;
      color: #e05c44;
      font-size: 12px;
      padding: 6px 12px;
      cursor: pointer;
    }
    .picker-clear-btn:hover { background: rgba(224,92,68,0.2); }

    /* ── All Tasks List ── */
    .task-section {
      background: rgba(255,255,255,0.02);
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      overflow: hidden;
    }
    .task-section-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px;
      background: rgba(255,255,255,0.03);
      border-bottom: 1px solid #2a2a4a;
    }
    .task-section-title {
      font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
      color: #888; text-transform: uppercase;
    }
    .task-count { font-size: 11px; color: #555; }

    .task-list { display: flex; flex-direction: column; }
    .task-row {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 14px;
      border-bottom: 1px solid #1e1e33;
      transition: background 0.15s;
    }
    .task-row:last-child { border-bottom: none; }
    .task-row:hover { background: rgba(255,255,255,0.03); }
    .task-is-current { background: rgba(224,92,68,0.06); }
    .task-is-next    { background: rgba(245,166,35,0.06); }

    .task-priority-pip {
      width: 4px; height: 28px; border-radius: 2px; flex-shrink: 0;
    }
    .pip-p4 { background: #e05c44; }
    .pip-p3 { background: #f5a623; }
    .pip-p2 { background: #7b9cd4; }
    .pip-p1 { background: #444; }

    .task-info { flex: 1; min-width: 0; }
    .task-row-content { font-size: 13px; color: #e0d5c0; display: block; }
    .task-row-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
    .task-meta-due { font-size: 11px; color: #888; }
    .task-meta-label {
      font-size: 10px; color: #7b68ee;
      background: rgba(123,104,238,0.12);
      padding: 0 4px; border-radius: 3px;
    }

    .task-actions { display: flex; gap: 4px; flex-shrink: 0; }
    .task-action-btn {
      background: none;
      border: 1px solid #2a2a4a;
      border-radius: 4px;
      color: #555;
      font-size: 12px;
      padding: 3px 7px;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .btn-current:hover, .btn-current.active { color: #e05c44; border-color: rgba(224,92,68,0.4); background: rgba(224,92,68,0.1); }
    .btn-next:hover,    .btn-next.active    { color: #f5a623; border-color: rgba(245,166,35,0.4); background: rgba(245,166,35,0.1); }

    .task-empty { padding: 20px; text-align: center; color: #555; font-size: 13px; }
  `]
})
export class TodoistPanelComponent implements OnInit {
  private readonly http = inject(HttpClient);

  // ─── State ──────────────────────────────────────────────────────────────────

  isLoading       = signal(true);
  pointers        = signal<QuestPointers | null>(null);
  allTasks        = signal<TodoistTask[]>([]);
  pointerError    = signal<string | null>(null);

  // Picker state
  pickerOpen      = signal(false);
  pickerSlot      = signal<'current' | 'next'>('current');
  pickerLoading   = signal(false);
  pickerSearch    = '';
  private _allTasksForPicker = signal<TodoistTask[]>([]);

  filteredTasks = computed(() => {
    const q = this.pickerSearch.toLowerCase().trim();
    const tasks = this._allTasksForPicker();
    if (!q) return tasks;
    return tasks.filter(t => t.content.toLowerCase().includes(q));
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.isLoading.set(true);
    this.pointerError.set(null);

    forkJoin({
      pointers: this.http.get<{ success: boolean; current: TodoistTask | null; next: TodoistTask | null }>(
        `${environment.apiUrl}/api/todoist/quest-pointers`
      ).pipe(catchError(() => of({ success: false, current: null, next: null }))),
      tasks: this.http.get<{ success: boolean; tasks: TodoistTask[] }>(
        `${environment.apiUrl}/api/todoist/tasks`
      ).pipe(catchError(() => of({ success: false, tasks: [] }))),
    }).subscribe({
      next: ({ pointers, tasks }) => {
        this.pointers.set({ current: pointers.current, next: pointers.next });
        this.allTasks.set(tasks.tasks ?? []);
        this._allTasksForPicker.set(tasks.tasks ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this.pointerError.set('Failed to load Todoist data — check TODOIST_API_TOKEN');
        this.isLoading.set(false);
      }
    });
  }

  // ─── Pointer Actions ────────────────────────────────────────────────────────

  setPointer(slot: 'current' | 'next', task: TodoistTask): void {
    // Optimistic update
    const current = { ...this.pointers()! };
    current[slot] = task;
    this.pointers.set(current);

    this.http.post<{ success: boolean; task: TodoistTask }>(
      `${environment.apiUrl}/api/todoist/quest-pointer`,
      { slot, taskId: task.id }
    ).subscribe({
      next: ({ task: updated }) => {
        const p = { ...this.pointers()! };
        p[slot] = updated;
        this.pointers.set(p);
        // Refresh task list labels
        this.refreshTaskLabels(updated);
      },
      error: () => {
        this.pointerError.set(`Failed to set ${slot} quest pointer`);
        this.reload(); // revert optimistic update
      }
    });
  }

  clearSlot(): void {
    const slot = this.pickerSlot();
    this.http.delete(`${environment.apiUrl}/api/todoist/quest-pointer/${slot}`)
      .subscribe({
        next: () => {
          const p = { ...this.pointers()! };
          p[slot] = null;
          this.pointers.set(p);
          this.closePicker();
        },
        error: () => this.pointerError.set(`Failed to clear ${slot} quest pointer`)
      });
  }

  // ─── Picker ─────────────────────────────────────────────────────────────────

  openPicker(slot: 'current' | 'next'): void {
    this.pickerSlot.set(slot);
    this.pickerSearch = '';
    this.pickerOpen.set(true);

    // Reload tasks into picker in case list is stale
    this.pickerLoading.set(true);
    this.http.get<{ success: boolean; tasks: TodoistTask[] }>(
      `${environment.apiUrl}/api/todoist/tasks`
    ).pipe(catchError(() => of({ success: false, tasks: [] }))).subscribe(res => {
      this._allTasksForPicker.set(res.tasks ?? []);
      this.pickerLoading.set(false);
    });
  }

  closePicker(): void {
    this.pickerOpen.set(false);
  }

  selectTask(task: TodoistTask): void {
    this.setPointer(this.pickerSlot(), task);
    this.closePicker();
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  isCurrentPointer(task: TodoistTask): boolean {
    return this.pointers()?.current?.id === task.id;
  }

  isNextPointer(task: TodoistTask): boolean {
    return this.pointers()?.next?.id === task.id;
  }

  isActivePointer(task: TodoistTask): boolean {
    return this.isCurrentPointer(task) || this.isNextPointer(task);
  }

  /** After a pointer change, update the label array on the matching task in the list */
  private refreshTaskLabels(updated: TodoistTask): void {
    this.allTasks.update(tasks =>
      tasks.map(t => t.id === updated.id ? { ...t, labels: updated.labels } : t)
    );
  }
}
