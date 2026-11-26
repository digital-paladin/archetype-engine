import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { FoodLog } from './food-log-panel.component';
import type { VitalsData } from './sleep-panel.component';
import { SystemQuestService } from './system-quest.service';
import { chicagoDate } from './quest-progress';
import {
  buildObjectivesView,
  metricsFromFoodAndVitals,
  readCollapsedGroups,
  writeCollapsedGroups,
  type GroupedQuest,
  type KeyValueStore,
  type TrackerGroupId,
} from './objectives-tracker';

@Component({
  selector: 'app-objectives-tracker',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="eso-panel obj-tracker" aria-label="Objectives" data-testid="objectives-tracker">
      <h2 class="eso-panel-title">Objectives</h2>

      <ng-container *ngIf="view() as tracker">
        <p class="obj-empty" *ngIf="tracker.empty" data-testid="objectives-empty">No active objectives.</p>

        <ul class="obj-live" *ngIf="tracker.liveLines.length" data-testid="objectives-live" aria-label="Today's counters">
          <li *ngFor="let line of tracker.liveLines">{{ line }}</li>
        </ul>

        <div class="obj-body">
          <section
            class="obj-group"
            *ngFor="let group of tracker.groups; trackBy: trackGroup"
            [attr.data-group]="group.id"
            data-testid="objectives-group">
            <button
              type="button"
              class="obj-group-toggle"
              [attr.aria-expanded]="!group.collapsed"
              [attr.aria-controls]="groupListId(group.id)"
              (click)="toggleGroup(group.id)">
              <span class="obj-chevron" aria-hidden="true">{{ group.collapsed ? '▸' : '▾' }}</span>
              {{ group.label }}
            </button>
            <ul
              class="obj-quests"
              *ngIf="!group.collapsed"
              [id]="groupListId(group.id)"
              [attr.aria-label]="group.label">
              <li class="obj-quest" *ngFor="let quest of group.quests; trackBy: trackQuest" data-testid="objective-quest">
                <p class="obj-quest-name">
                  <span
                    *ngIf="quest.awaitingTurnIn"
                    class="obj-turnin"
                    data-testid="objectives-turn-in"
                    role="img"
                    aria-label="awaiting confirmation"
                    title="awaiting confirmation">?</span>
                  <span class="obj-name">{{ quest.title }}</span>
                </p>
                <ul class="obj-lines" *ngIf="quest.lines.length" [attr.aria-label]="quest.title + ' objectives'">
                  <li *ngFor="let line of quest.lines">{{ line }}</li>
                </ul>
              </li>
            </ul>
          </section>
        </div>

        <button
          type="button"
          class="obj-more"
          *ngIf="tracker.hiddenCount > 0"
          data-testid="objectives-more"
          (click)="showAll.set(true)"
          [attr.aria-label]="'Show ' + tracker.hiddenCount + ' more objectives'">
          +{{ tracker.hiddenCount }} more
        </button>
        <button
          type="button"
          class="obj-more"
          *ngIf="tracker.showLess"
          data-testid="objectives-less"
          (click)="showAll.set(false)">
          Show less
        </button>
      </ng-container>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      flex-shrink: 0;
    }
    .obj-tracker {
      padding-bottom: 10px;
    }
    .obj-empty {
      margin: 0;
      color: var(--eso-text-dim, #a08858);
      font-family: 'Open Sans', sans-serif;
      font-size: 12px;
    }
    .obj-body {
      max-height: min(46vh, 420px);
      overflow-y: auto;
      padding: 2px 4px 4px;
    }
    .obj-live,
    .obj-quests,
    .obj-lines {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .obj-live {
      margin: 0 0 8px;
      padding-left: 14px;
    }
    .obj-live li,
    .obj-lines li {
      color: var(--eso-text, #e2cfa8);
      font-family: 'Open Sans', sans-serif;
      font-size: 12px;
      line-height: 1.35;
    }
    .obj-group + .obj-group { margin-top: 6px; }
    .obj-group-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      min-height: 32px;
      margin: 0;
      padding: 4px 2px;
      background: transparent;
      border: none;
      border-radius: 2px;
      color: var(--eso-gold, #c9a84c);
      font-family: 'Cinzel', serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1.6px;
      text-transform: uppercase;
      text-align: left;
      cursor: pointer;
    }
    .obj-group-toggle:hover { color: var(--eso-gold-bright, #f2c96a); }
    .obj-group-toggle:focus-visible,
    .obj-more:focus-visible {
      /* Inset so the scroll area does not clip the ring. */
      outline: 3px solid #fff8e8;
      outline-offset: -3px;
      background: rgba(242, 201, 106, 0.16);
    }
    .obj-chevron { width: 10px; flex-shrink: 0; }
    .obj-quest { margin: 0 0 8px; }
    .obj-quest-name {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin: 0;
    }
    .obj-name {
      color: var(--eso-gold-bright, #f2c96a);
      font-family: 'Open Sans', sans-serif;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.3;
    }
    .obj-turnin {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      margin-top: 1px;
      flex-shrink: 0;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, #ffe38a, #f2c96a 46%, #c9a84c);
      color: #3a2c10;
      font-family: 'Open Sans', sans-serif;
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
      box-shadow: 0 0 6px rgba(242, 201, 106, 0.7);
    }
    .obj-lines { padding: 1px 0 0 16px; }
    .obj-more {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      margin-top: 2px;
      padding: 2px;
      background: transparent;
      border: none;
      color: var(--eso-gold-bright, #f2c96a);
      font-family: 'Open Sans', sans-serif;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .obj-more:hover { color: #fff4d2; }
    @media (max-width: 600px) {
      .obj-group-toggle,
      .obj-more { min-height: 40px; }
      .obj-name { font-size: 14px; }
      .obj-body { max-height: none; }
    }
  `],
})
export class ObjectivesTrackerComponent {
  private readonly system = inject(SystemQuestService);

  /** Today's food log. Protein grams come from totals.protein. */
  readonly food = input<FoodLog | null>(null);
  /** Status vitals. Body weight sets the protein goal; waterOz is the hydration reading. */
  readonly vitals = input<VitalsData | null>(null);

  private readonly collapsed = signal<ReadonlySet<TrackerGroupId>>(readCollapsedGroups(browserStorage()));
  readonly showAll = signal(false);

  readonly view = computed(() => buildObjectivesView({
    quests: this.system.quests(),
    today: chicagoDate(),
    collapsed: this.collapsed(),
    showAll: this.showAll(),
    metrics: metricsFromFoodAndVitals(this.food(), this.vitals()),
  }));

  toggleGroup(id: TrackerGroupId): void {
    const next = new Set(this.collapsed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsed.set(next);
    writeCollapsedGroups(browserStorage(), next);
  }

  groupListId(id: TrackerGroupId): string {
    return `objectives-group-${id}`;
  }

  trackQuest(_index: number, quest: GroupedQuest): string {
    return quest.id;
  }

  trackGroup(_index: number, group: { id: TrackerGroupId }): string {
    return group.id;
  }
}

function browserStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
