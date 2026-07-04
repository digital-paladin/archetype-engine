import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

// ── Local interfaces (mirror backend models) ──────────────────────────────────

interface QuestChapter {
  chapter: string;
  milestone: string;
  status: 'complete' | 'active' | 'locked';
  statusIcon: string;
}

interface QuestLine {
  id: string;
  number: number;
  name: string;
  icon: string;
  class: string;
  statusText: string;
  statusEmoji: string;
  tagline: string;
  chapters: QuestChapter[];
  currentXpDrivers: string;
  unlocks: string;
}

interface GrandConvergenceCondition {
  condition: string;
  questLine: string;
  complete: boolean;
}

interface GrandConvergence {
  conditions: GrandConvergenceCondition[];
  allComplete: boolean;
}

@Component({
  selector: 'app-quest-lines-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ql-panel">

      <!-- Header -->
      <div class="ql-header">
        <span class="ql-ornament">⚔️</span>
        <div>
          <h2 class="ql-title">THE PALADIN'S ARC</h2>
          <p class="ql-subtitle">Quest Lines — Active Story Arcs</p>
        </div>
        <div class="ql-convergence-badge" [class.converged]="grandConvergence()?.allComplete">
          {{ grandConvergence()?.allComplete ? '★ CONVERGED' : '★ GRAND CONVERGENCE' }}
        </div>
      </div>

      <!-- Loading -->
      <div *ngIf="isLoading()" class="ql-loading">
        <span class="ql-loading-text">Consulting the System…</span>
      </div>

      <!-- Quest Lines Grid -->
      <div *ngIf="!isLoading()" class="ql-grid">
        <div
          *ngFor="let ql of questLines()"
          class="ql-card"
          [class.ql-card--in-progress]="ql.statusEmoji === '🟢'"
          [class.ql-card--seeded]="ql.statusEmoji === '🟡'"
          [class.ql-card--locked]="ql.statusEmoji === '⬜'"
          (click)="toggleExpanded(ql.id)"
        >
          <!-- Card Header -->
          <div class="ql-card-header">
            <div class="ql-card-meta">
              <span class="ql-number">Arc {{ ql.number }}</span>
              <span class="ql-class-badge">{{ ql.class }}</span>
            </div>
            <div class="ql-card-title-row">
              <span class="ql-card-icon">{{ ql.icon }}</span>
              <h3 class="ql-card-name">{{ ql.name }}</h3>
              <span class="ql-status-emoji" [title]="ql.statusText">{{ ql.statusEmoji }}</span>
            </div>
            <p class="ql-tagline">"{{ ql.tagline }}"</p>
            <p class="ql-status-text">{{ ql.statusText }}</p>

            <!-- Chapter progress bar -->
            <div class="ql-progress-row">
              <div
                *ngFor="let ch of ql.chapters"
                class="ql-progress-segment"
                [class.ql-seg--complete]="ch.status === 'complete'"
                [class.ql-seg--active]="ch.status === 'active'"
                [class.ql-seg--locked]="ch.status === 'locked'"
                [title]="ch.chapter + ': ' + ch.milestone"
              ></div>
            </div>

            <div class="ql-chapter-counts">
              <span class="ql-ct complete">{{ completedChapters(ql) }} complete</span>
              <span class="ql-ct active">{{ activeChapters(ql) }} active</span>
              <span class="ql-ct locked">{{ lockedChapters(ql) }} locked</span>
            </div>
          </div>

          <!-- Expanded chapters -->
          <div *ngIf="expandedId() === ql.id" class="ql-chapters">
            <table class="ql-table">
              <thead>
                <tr>
                  <th>Chapter</th>
                  <th>Milestone</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  *ngFor="let ch of ql.chapters"
                  [class.row--complete]="ch.status === 'complete'"
                  [class.row--active]="ch.status === 'active'"
                  [class.row--locked]="ch.status === 'locked'"
                >
                  <td class="ch-label">{{ ch.chapter }}</td>
                  <td class="ch-milestone">{{ ch.milestone }}</td>
                  <td class="ch-icon">{{ chapterStatusIcon(ch.status) }}</td>
                </tr>
              </tbody>
            </table>

            <div *ngIf="ql.currentXpDrivers" class="ql-drivers">
              <span class="ql-drivers-label">⚡ XP Drivers:</span>
              <span class="ql-drivers-text">{{ ql.currentXpDrivers }}</span>
            </div>

            <div *ngIf="ql.unlocks" class="ql-unlocks">
              <span class="ql-unlocks-label">🔓 Unlocks:</span>
              <span class="ql-unlocks-text">{{ ql.unlocks }}</span>
            </div>
          </div>

        </div><!-- /ql-card -->
      </div><!-- /ql-grid -->

      <!-- Grand Convergence -->
      <div *ngIf="grandConvergence() && !isLoading()" class="ql-convergence">
        <h3 class="ql-convergence-title">★ GRAND CONVERGENCE: The Free Paladin</h3>
        <p class="ql-convergence-sub">
          "Self-sovereign. Physically capable. Financially independent. Technically elite. Spiritually grounded. Unbound."
        </p>
        <table class="ql-table">
          <thead>
            <tr>
              <th>Condition</th>
              <th>Quest Line</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              *ngFor="let c of grandConvergence()!.conditions"
              [class.row--complete]="c.complete"
              [class.row--locked]="!c.complete"
            >
              <td class="ch-milestone">{{ c.condition }}</td>
              <td class="ch-label">{{ c.questLine }}</td>
              <td class="ch-icon">{{ c.complete ? '✅' : '⬜' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  `,
  styles: [`
    .ql-panel {
      padding: 16px;
      color: #e0d5c0;
      font-family: 'Segoe UI', sans-serif;
    }

    /* ── Header ── */
    .ql-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      border-bottom: 1px solid #2a2a4a;
      padding-bottom: 12px;
    }
    .ql-ornament { font-size: 24px; }
    .ql-title {
      font-size: 14px;
      font-weight: 700;
      color: #c8a84b;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin: 0;
    }
    .ql-subtitle { font-size: 11px; color: #7a7a9a; margin: 2px 0 0; }
    .ql-convergence-badge {
      margin-left: auto;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: #7a7a9a;
      border: 1px solid #2a2a4a;
      padding: 4px 10px;
      border-radius: 4px;
      white-space: nowrap;
    }
    .ql-convergence-badge.converged {
      color: #c8a84b;
      border-color: #c8a84b;
      text-shadow: 0 0 8px rgba(200, 168, 75, 0.5);
    }

    /* ── Loading ── */
    .ql-loading {
      display: flex;
      justify-content: center;
      padding: 40px;
    }
    .ql-loading-text {
      color: #7a7a9a;
      font-style: italic;
      font-size: 13px;
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }

    /* ── Grid ── */
    .ql-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }

    /* ── Card ── */
    .ql-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      overflow: hidden;
      cursor: pointer;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .ql-card:hover { border-color: #3a3a5a; box-shadow: 0 2px 12px rgba(0,0,0,0.3); }
    .ql-card--in-progress { border-left: 3px solid #4caf6e; }
    .ql-card--seeded      { border-left: 3px solid #c8a84b; }
    .ql-card--locked      { border-left: 3px solid #3a3a4a; }

    .ql-card-header { padding: 14px 16px; }

    .ql-card-meta {
      display: flex;
      gap: 8px;
      margin-bottom: 6px;
    }
    .ql-number {
      font-size: 10px;
      font-weight: 700;
      color: #7a7a9a;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .ql-class-badge {
      font-size: 10px;
      font-weight: 600;
      color: #c8a84b;
      background: rgba(200,168,75,0.12);
      padding: 1px 7px;
      border-radius: 3px;
    }

    .ql-card-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .ql-card-icon { font-size: 18px; }
    .ql-card-name {
      font-size: 15px;
      font-weight: 700;
      color: #e0d5c0;
      margin: 0;
      flex: 1;
    }
    .ql-status-emoji { font-size: 16px; }

    .ql-tagline {
      font-size: 11px;
      color: #7b9cd4;
      font-style: italic;
      margin: 0 0 4px;
    }
    .ql-status-text {
      font-size: 11px;
      color: #9a9ab0;
      margin: 0 0 12px;
    }

    /* ── Progress bar ── */
    .ql-progress-row {
      display: flex;
      gap: 3px;
      height: 6px;
      margin-bottom: 6px;
    }
    .ql-progress-segment {
      flex: 1;
      border-radius: 2px;
    }
    .ql-seg--complete { background: #4caf6e; }
    .ql-seg--active   { background: #c8a84b; }
    .ql-seg--locked   { background: rgba(255,255,255,0.08); }

    .ql-chapter-counts {
      display: flex;
      gap: 12px;
      font-size: 10px;
    }
    .ql-ct.complete { color: #4caf6e; }
    .ql-ct.active   { color: #c8a84b; }
    .ql-ct.locked   { color: #5a5a7a; }

    /* ── Chapter detail table ── */
    .ql-chapters {
      border-top: 1px solid #2a2a4a;
      padding: 12px 16px 14px;
    }
    .ql-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 10px;
    }
    .ql-table th {
      text-align: left;
      color: #7a7a9a;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 10px;
      padding: 0 6px 6px 0;
      border-bottom: 1px solid #2a2a4a;
    }
    .ql-table td {
      padding: 5px 6px 5px 0;
      vertical-align: top;
    }
    .row--complete { color: #4caf6e; }
    .row--active   { color: #e0d5c0; }
    .row--locked   { color: #5a5a7a; }
    .ch-label    { font-weight: 600; white-space: nowrap; min-width: 110px; }
    .ch-milestone { color: inherit; line-height: 1.4; }
    .ch-icon     { text-align: right; font-size: 14px; white-space: nowrap; }

    .ql-drivers, .ql-unlocks {
      font-size: 11px;
      margin-top: 6px;
      line-height: 1.5;
    }
    .ql-drivers-label, .ql-unlocks-label {
      color: #c8a84b;
      font-weight: 600;
      margin-right: 4px;
    }
    .ql-drivers-text, .ql-unlocks-text { color: #9a9ab0; }

    /* ── Grand Convergence ── */
    .ql-convergence {
      background: rgba(200,168,75,0.05);
      border: 1px solid rgba(200,168,75,0.2);
      border-radius: 6px;
      padding: 16px;
    }
    .ql-convergence-title {
      font-size: 13px;
      font-weight: 700;
      color: #c8a84b;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 0 0 4px;
    }
    .ql-convergence-sub {
      font-size: 11px;
      color: #7b9cd4;
      font-style: italic;
      margin: 0 0 12px;
    }
  `]
})
export class QuestLinesPanelComponent implements OnInit {
  private readonly http = inject(HttpClient);

  questLines       = signal<QuestLine[]>([]);
  grandConvergence = signal<GrandConvergence | null>(null);
  isLoading        = signal(true);
  expandedId       = signal<string | null>(null);

  // Counts per quest line
  completedChapters = (ql: QuestLine) => ql.chapters.filter(c => c.status === 'complete').length;
  activeChapters    = (ql: QuestLine) => ql.chapters.filter(c => c.status === 'active').length;
  lockedChapters    = (ql: QuestLine) => ql.chapters.filter(c => c.status === 'locked').length;

  chapterStatusIcon(status: 'complete' | 'active' | 'locked'): string {
    return status === 'complete' ? '✅' : status === 'active' ? '🟡' : '⬜';
  }

  toggleExpanded(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  ngOnInit(): void {
    this.http.get<{ questLines: QuestLine[]; grandConvergence: GrandConvergence | null }>(
      `${environment.apiUrl}/api/character/quest-lines`
    ).subscribe({
      next: (res) => {
        this.questLines.set(res.questLines);
        this.grandConvergence.set(res.grandConvergence);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }
}
