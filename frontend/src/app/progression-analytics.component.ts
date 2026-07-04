import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { environment } from '../environments/environment';
import { SocketService } from './socket.service';

// ── Interfaces ─────────────────────────────────────────────────────────────

interface DailyEntryData {
  dateLabel: string;
  classXP: Record<string, number>;
  totalXP: number;
  gritPct?: number;
}

interface TimeToLevel {
  className: string;
  level: number;
  currentXP: number;
  xpNeeded: number;
  avgDailyXP: number;
  daysRemaining: number;
  projectedDate: string;
  isInactive: boolean;
}

interface XPProjectionEntry {
  totalXP: number;
  daysTracked: number;
  avgDailyXP: number;
  avgWeeklyXP: number;
  projected6mo: number;
  projected12mo: number;
}

interface DayDisciplineData {
  dateLabel: string;
  breaches: { alcohol: boolean; lust: boolean; diet: boolean; sweets: boolean; redMeat: boolean; other: boolean };
  indulgenceCount: number;
}

interface DisciplineSummary {
  entries:           DayDisciplineData[];
  alcoholPassRate:   number;
  lustPassRate:      number;
  dietPassRate:      number;
  sweetsBreachCount: number;
  redMeatBreachCount: number;
  otherBreachCount:  number;
  disciplineScore:   number;
  alcoholStreak:     number;
  lustStreak:        number;
  dietStreak:        number;
  mixingEvents:      number;
}

interface SystemAlert {
  type: 'class-monoculture' | 'class-dark';
  severity: 'warning' | 'critical';
  message: string;
  affectedClass: string;
  detail: string;
}

interface AmccSparkDay { date: string; checks: number; pct: number; }
interface AmccData {
  success:      boolean;
  score:        number;        // 0–100
  tier:         string;        // Atrophying | Baseline | Developing | Hardened | Elite
  description:  string;
  totalChecks:  number;
  maxPossible:  number;        // always 180 (6 items × 30 days)
  sparkline:    AmccSparkDay[];
}

interface AnalyticsResponse {
  recentEntries: DailyEntryData[];
  timeToLevel: TimeToLevel[];
  projections: Record<string, XPProjectionEntry>;
  disciplineSummary?: DisciplineSummary;
  systemAlerts?: SystemAlert[];
}

// ── Constants ───────────────────────────────────────────────────────────────

const CLASS_COLORS: Record<string, string> = {
  developer:            '#60a5fa',
  sage:                 '#c084fc',
  warrior:              '#f87171',
  artist:               '#fbbf24',
  redteamer:            '#34d399',
  'financial strategist': '#fb923c',
  survivalist:          '#a3e635',
};

function classColor(name: string): string {
  return CLASS_COLORS[name.toLowerCase()] ?? '#9a7830';
}

// ── Component ───────────────────────────────────────────────────────────────

@Component({
  selector: 'app-progression-analytics',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  template: `
    <div class="pa-root">

      <!-- ══ Loading ══ -->
      <div *ngIf="isLoading()" class="pa-loading">Loading analytics...</div>

      <!-- ══ Empty state ══ -->
      <div *ngIf="!isLoading() && data() && !hasData()" class="pa-empty">
        <div class="pa-empty-icon">📊</div>
        <div class="pa-empty-title">No Analytics Data</div>
        <div class="pa-empty-msg">The analytics parser couldn't read the character sheet on this environment. This will be resolved when Sprint 5 migrates parsing to Supabase.</div>
      </div>

      <ng-container *ngIf="!isLoading() && hasData()">

        <!-- ══ Section 0: aMCC Neural Density ══ -->
        <section class="pa-section pa-amcc-section" *ngIf="amccData()">
          <h4 class="pa-title">🧠 aMCC Neural Density
            <span class="pa-subtitle">30-day resistance override index</span>
          </h4>
          <div class="pa-amcc-header">
            <div class="pa-amcc-score-wrap">
              <span class="pa-amcc-score" [style.color]="amccScoreColor()">{{ amccData()!.score }}</span>
              <span class="pa-amcc-score-denom">/100</span>
            </div>
            <div class="pa-amcc-meta">
              <span class="pa-amcc-tier" [style.color]="amccScoreColor()">{{ amccData()!.tier }}</span>
              <span class="pa-amcc-desc">{{ amccData()!.description }}</span>
              <span class="pa-amcc-count">{{ amccData()!.totalChecks }} / {{ amccData()!.maxPossible }} events</span>
            </div>
          </div>
          <!-- 30-day resistance sparkline -->
          <div class="pa-amcc-sparkline">
            <div
              *ngFor="let day of amccData()!.sparkline"
              class="pa-amcc-bar"
              [style.height.%]="day.pct || 4"
              [style.background]="amccBarColor(day.pct)"
              [title]="day.date + ': ' + day.checks + '/6'"
            ></div>
          </div>
          <!-- Tier legend -->
          <div class="pa-amcc-legend">
            <span *ngFor="let t of amccTiers" class="pa-amcc-leg-item" [style.color]="t.color">{{ t.label }}</span>
          </div>
        </section>

        <!-- ══ Section 0.5: System Health Alerts ══ -->
        <section class="pa-section pa-alerts-section" *ngIf="activeAlerts().length > 0">
          <h4 class="pa-title">🛡 System Health</h4>
          <div class="pa-alerts">
            <div *ngFor="let a of activeAlerts()"
                 class="pa-alert"
                 [class.pa-alert-warning]="a.severity === 'warning'"
                 [class.pa-alert-critical]="a.severity === 'critical'">
              <div class="pa-alert-msg">{{ a.message }}</div>
              <div class="pa-alert-detail">{{ a.detail }}</div>
            </div>
          </div>
        </section>

        <!-- ══ Section 1: Time to Next Level ══ -->
        <section class="pa-section">
          <h4 class="pa-title">⏱ Time to Next Level</h4>
          <div class="pa-ttl-grid">
            <div *ngFor="let cls of data()!.timeToLevel" class="pa-ttl-row">
              <div class="pa-ttl-header">
                <span class="pa-ttl-name">{{ cls.className }}</span>
                <span class="pa-ttl-level" [style.color]="getClassColor(cls.className)">L{{ cls.level }}</span>
                <span class="pa-ttl-date" [class.pa-inactive]="cls.isInactive">
                  {{ cls.isInactive ? '—— Inactive' : cls.projectedDate }}
                </span>
              </div>
              <div class="pa-ttl-bar-wrap">
                <div class="pa-ttl-bar">
                  <div class="pa-ttl-fill"
                    [style.width.%]="getLevelPct(cls)"
                    [style.background]="getClassColor(cls.className)">
                  </div>
                </div>
                <span class="pa-ttl-xp">
                  {{ cls.isInactive ? 'N/A' : cls.xpNeeded + ' XP left' }}
                </span>
              </div>
              <div class="pa-ttl-meta" *ngIf="!cls.isInactive">
                <span>{{ cls.avgDailyXP | number:'1.1-1' }} XP/day</span>
                <span *ngIf="cls.daysRemaining > 0">{{ cls.daysRemaining }} days</span>
              </div>
            </div>
          </div>
        </section>

        <!-- ══ Section 2: XP Activity Heatmap ══ -->
        <section class="pa-section">
          <h4 class="pa-title">📅 {{ recentEntriesReversed().length }}-Day XP Activity
            <span class="pa-subtitle">daily XP earned</span>
          </h4>
          <div class="pa-heatmap">
            <div
              *ngFor="let entry of recentEntriesReversed()"
              class="pa-heat-cell"
              [style.background]="heatColor(entry.totalXP)"
              [title]="entry.dateLabel + ': ' + entry.totalXP + ' XP'">
              <span class="pa-heat-label">{{ entry.dateLabel }}</span>
              <span class="pa-heat-xp" *ngIf="entry.totalXP > 0">+{{ entry.totalXP }}</span>
            </div>
          </div>
          <!-- Legend -->
          <div class="pa-heat-legend">
            <span class="pa-legend-label">0 XP</span>
            <div class="pa-legend-bar">
              <div class="pa-legend-gradient"></div>
            </div>
            <span class="pa-legend-label">50+ XP</span>
          </div>
        </section>

        <!-- ══ Section 3: Grit Score Trend ══ -->
        <section class="pa-section" *ngIf="gritEntries().length > 0">
          <h4 class="pa-title">🎯 Grit Score Trend
            <span class="pa-subtitle">last {{ gritEntries().length }} logged days</span>
          </h4>
          <div class="pa-grit-chart">
            <div *ngFor="let g of gritEntries()" class="pa-grit-bar-col">
              <div class="pa-grit-bar-track">
                <div
                  class="pa-grit-fill"
                  [style.height.%]="g.pct"
                  [class.grit-high]="g.pct >= 70"
                  [class.grit-mid]="g.pct >= 50 && g.pct < 70"
                  [class.grit-low]="g.pct < 50">
                </div>
              </div>
              <span class="pa-grit-pct">{{ g.pct | number:'1.0-0' }}%</span>
              <span class="pa-grit-date">{{ g.date }}</span>
            </div>
          </div>
        </section>

        <!-- ══ Section 4: XP Velocity Table ══ -->
        <section class="pa-section">
          <h4 class="pa-title">📈 XP Velocity</h4>
          <div class="pa-table-wrap">
          <table class="pa-velocity-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Avg/Day</th>
                <th>Avg/Week</th>
                <th>6-Month</th>
                <th>12-Month</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of velocityRows()">
                <td>
                  <span class="pa-vel-dot" [style.background]="getClassColor(row.name)"></span>
                  {{ row.name }}
                </td>
                <td [class.pa-dim]="row.avgDay === 0">{{ row.avgDay === 0 ? '—' : (row.avgDay | number:'1.1-1') }}</td>
                <td [class.pa-dim]="row.avgWeek === 0">{{ row.avgWeek === 0 ? '—' : (row.avgWeek | number:'1.0-0') }}</td>
                <td [class.pa-dim]="row.proj6mo === 0">{{ row.proj6mo === 0 ? '—' : '+' + row.proj6mo }}</td>
                <td [class.pa-dim]="row.proj12mo === 0">{{ row.proj12mo === 0 ? '—' : '+' + row.proj12mo }}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </section>

        <!-- ══ Section 5: Sage Paladin Discipline ══ -->
        <section class="pa-section" *ngIf="data()!.disciplineSummary">
          <h4 class="pa-title">⚔ Sage Paladin Discipline
            <span class="pa-subtitle">{{ disciplineTimeline().length }}-day indulgence tracking</span>
          </h4>

          <!-- Score header -->
          <div class="pa-disc-header">
            <div class="pa-disc-score-wrap">
              <span class="pa-disc-score" [style.color]="disciplineScoreColor()">{{ data()!.disciplineSummary!.disciplineScore }}</span>
              <span class="pa-disc-score-denom">/100</span>
            </div>
            <div class="pa-disc-grade-wrap">
              <span class="pa-disc-grade" [style.color]="disciplineScoreColor()">{{ disciplineGrade() }}</span>
              <span class="pa-disc-mix-warn" *ngIf="data()!.disciplineSummary!.mixingEvents > 0">
                ⚠ {{ data()!.disciplineSummary!.mixingEvents }} compound event{{ data()!.disciplineSummary!.mixingEvents > 1 ? 's' : '' }}
              </span>
            </div>
          </div>

          <!-- Category rows -->
          <div class="pa-disc-cats">
            <div *ngFor="let cat of disciplineCategories()" class="pa-disc-cat-row">
              <span class="pa-disc-cat-icon">{{ cat.icon }}</span>
              <span class="pa-disc-cat-name">{{ cat.label }}</span>
              <ng-container *ngIf="cat.passRate !== undefined">
                <span class="pa-disc-streak">{{ cat.streak }}d</span>
                <div class="pa-disc-bar">
                  <div class="pa-disc-bar-fill"
                    [style.width.%]="cat.passRate"
                    [style.background]="cat.color">
                  </div>
                </div>
                <span class="pa-disc-pct" [style.color]="cat.color">{{ cat.passRate }}%</span>
              </ng-container>
              <ng-container *ngIf="cat.passRate === undefined">
                <span class="pa-disc-breach-count"
                  [class.pa-disc-clean]="cat.breach === 0"
                  [class.pa-disc-dirty]="cat.breach! > 0">
                  {{ cat.breach === 0 ? '✓ clean' : cat.breach + ' breach' + (cat.breach! > 1 ? 'es' : '') }}
                </span>
              </ng-container>
            </div>
          </div>

          <!-- Breach timeline -->
          <div class="pa-disc-timeline">
            <span class="pa-disc-tl-label">{{ disciplineTimeline().length }}-Day Breach Log</span>
            <div class="pa-disc-dots">
              <div
                *ngFor="let dot of disciplineTimeline()"
                class="pa-disc-dot"
                [style.background]="dot.color"
                [title]="dot.label">
              </div>
            </div>
            <div class="pa-disc-legend">
              <span class="pa-disc-leg"><span class="pa-disc-leg-dot" style="background:#1a3d18"></span>Clean</span>
              <span class="pa-disc-leg"><span class="pa-disc-leg-dot" style="background:#78350f"></span>Diet</span>
              <span class="pa-disc-leg"><span class="pa-disc-leg-dot" style="background:#be185d"></span>Lust</span>
              <span class="pa-disc-leg"><span class="pa-disc-leg-dot" style="background:#3730a3"></span>Alcohol</span>
              <span class="pa-disc-leg"><span class="pa-disc-leg-dot" style="background:#7f1d1d"></span>Multiple</span>
            </div>
          </div>
        </section>

      </ng-container>

    </div>
  `,
  styles: [`
    .pa-root {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .pa-loading {
      font-size: 11px;
      color: var(--eso-text-dim, #a08858);
      padding: 16px 0;
      text-align: center;
    }

    .pa-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 32px 16px;
      text-align: center;
    }
    .pa-empty-icon { font-size: 32px; opacity: 0.5; }
    .pa-empty-title { font-size: 13px; font-weight: 600; color: var(--eso-gold, #c8a84b); }
    .pa-empty-msg { font-size: 11px; color: var(--eso-text-dim, #a08858); max-width: 280px; line-height: 1.5; }

    /* ── Alerts ── */
    .pa-alerts { display: flex; flex-direction: column; gap: 8px; }

    .pa-alert {
      padding: 8px 10px;
      border-radius: 2px;
      border-left: 3px solid;
    }
    .pa-alert-warning  { background: rgba(251,191,36,0.08); border-color: #fbbf24; }
    .pa-alert-critical { background: rgba(248,113,113,0.10); border-color: #f87171; }

    .pa-alert-msg {
      font-size: 10px;
      font-family: 'Cinzel', serif;
      color: var(--eso-text, #d4b483);
      margin-bottom: 3px;
    }
    .pa-alert-detail {
      font-size: 9px;
      color: var(--eso-text-dim, #a08858);
    }

    /* ── Sections ── */
    .pa-section {
      background: rgba(6, 4, 2, 0.7);
      border: 1px solid rgba(155, 115, 38, 0.35);
      border-radius: 2px;
      padding: 12px 14px;
    }

    .pa-title {
      margin: 0 0 10px 0;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--eso-gold-bright, #f2c96a);
      font-family: 'Cinzel', serif;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .pa-subtitle {
      font-size: 9px;
      letter-spacing: 0;
      text-transform: none;
      color: var(--eso-text-dim, #a08858);
      font-weight: 400;
      margin-left: auto;
    }

    /* ── Time to Level ── */
    .pa-ttl-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .pa-ttl-row {
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(155,115,38,0.15);
      border-radius: 2px;
      padding: 8px 10px;
    }

    .pa-ttl-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 5px;
    }

    .pa-ttl-name {
      flex: 1;
      font-size: 11px;
      font-family: 'Cinzel', serif;
      color: var(--eso-text, #d4b483);
    }

    .pa-ttl-level {
      font-size: 12px;
      font-weight: 700;
      font-family: 'Cinzel', serif;
    }

    .pa-ttl-date {
      font-size: 10px;
      font-family: 'Cinzel', serif;
      color: var(--eso-gold, #c9a84c);
    }

    .pa-inactive { color: var(--eso-text-dim, #a08858) !important; }

    .pa-ttl-bar-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 3px;
    }

    .pa-ttl-bar {
      flex: 1;
      height: 6px;
      background: rgba(0,0,0,0.5);
      border-radius: 1px;
      overflow: hidden;
      border: 1px solid rgba(155,115,38,0.2);
    }

    .pa-ttl-fill {
      height: 100%;
      transition: width 0.6s ease-out;
      opacity: 0.85;
    }

    .pa-ttl-xp {
      font-size: 9px;
      color: var(--eso-text-dim, #a08858);
      min-width: 70px;
      text-align: right;
      white-space: nowrap;
    }

    .pa-ttl-meta {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: var(--eso-text-dim, #a08858);
    }

    /* ── Heatmap ── */
    .pa-heatmap {
      display: grid;
      grid-template-columns: repeat(10, 1fr);
      gap: 4px;
      margin-bottom: 8px;
    }

    .pa-heat-cell {
      aspect-ratio: 1;
      border-radius: 2px;
      position: relative;
      cursor: default;
      min-height: 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(0,0,0,0.3);
      transition: transform 0.1s;
    }

    .pa-heat-cell:hover { transform: scale(1.05); }

    .pa-heat-label {
      font-size: 7px;
      color: rgba(255,255,255,0.5);
      line-height: 1.2;
      text-align: center;
      white-space: nowrap;
    }

    .pa-heat-xp {
      font-size: 8px;
      font-weight: 700;
      color: rgba(255,255,255,0.85);
      font-family: 'Cinzel', serif;
    }

    .pa-heat-legend {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }

    .pa-legend-label {
      font-size: 9px;
      color: var(--eso-text-dim, #a08858);
    }

    .pa-legend-bar { flex: 1; }

    .pa-legend-gradient {
      height: 6px;
      border-radius: 1px;
      background: linear-gradient(90deg,
        rgba(155,115,38,0.1) 0%,
        rgba(201,168,76,0.4) 40%,
        rgba(242,201,106,0.9) 100%);
    }

    /* ── Grit Chart ── */
    .pa-grit-chart {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      height: 90px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .pa-grit-chart::-webkit-scrollbar { display: none; }

    .pa-grit-bar-col {
      flex: 0 0 40px;
      min-width: 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
    }

    .pa-grit-bar-track {
      flex: 1;
      width: 100%;
      background: rgba(0,0,0,0.4);
      border-radius: 1px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      border: 1px solid rgba(155,115,38,0.15);
    }

    .pa-grit-fill {
      width: 100%;
      transition: height 0.5s ease-out;
    }

    .grit-high { background: #4ade80; }
    .grit-mid  { background: #fbbf24; }
    .grit-low  { background: #f87171; }

    .pa-grit-pct {
      font-size: 8px;
      color: var(--eso-text-dim, #a08858);
      margin-top: 2px;
      font-family: 'Cinzel', serif;
    }

    .pa-grit-date {
      font-size: 7px;
      color: rgba(160, 136, 88, 0.5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
      text-align: center;
    }

    /* ── Velocity Table ── */
    .pa-velocity-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }

    .pa-velocity-table th {
      text-align: left;
      font-size: 9px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: var(--eso-text-dim, #a08858);
      font-family: 'Cinzel', serif;
      padding: 4px 6px;
      border-bottom: 1px solid rgba(155,115,38,0.3);
    }

    .pa-velocity-table th:not(:first-child) { text-align: right; }

    .pa-velocity-table td {
      padding: 5px 6px;
      color: var(--eso-text, #d4b483);
      font-family: 'Cinzel', serif;
      border-bottom: 1px solid rgba(155,115,38,0.10);
    }

    .pa-velocity-table td:not(:first-child) { text-align: right; }

    .pa-dim { color: var(--eso-text-dim, #a08858) !important; }

    .pa-vel-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      margin-right: 5px;
      vertical-align: middle;
    }

    /* ── Discipline ── */
    .pa-disc-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 12px;
    }

    .pa-disc-score-wrap {
      display: flex;
      align-items: baseline;
      gap: 3px;
    }

    .pa-disc-score {
      font-size: 38px;
      font-weight: 700;
      font-family: 'Cinzel', serif;
      line-height: 1;
    }

    .pa-disc-score-denom {
      font-size: 14px;
      color: var(--eso-text-dim, #a08858);
      font-family: 'Cinzel', serif;
    }

    .pa-disc-grade-wrap {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .pa-disc-grade {
      font-size: 11px;
      font-family: 'Cinzel', serif;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      font-weight: 700;
    }

    .pa-disc-mix-warn {
      font-size: 9px;
      color: #f87171;
      letter-spacing: 0.5px;
    }

    .pa-disc-cats {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-bottom: 12px;
    }

    .pa-disc-cat-row {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 5px 8px;
      background: rgba(0,0,0,0.25);
      border: 1px solid rgba(155,115,38,0.12);
      border-radius: 2px;
    }

    .pa-disc-cat-icon { font-size: 13px; width: 18px; text-align: center; }

    .pa-disc-cat-name {
      font-size: 10px;
      font-family: 'Cinzel', serif;
      color: var(--eso-text, #d4b483);
      min-width: 88px;
    }

    .pa-disc-streak {
      font-size: 9px;
      color: var(--eso-gold, #c9a84c);
      font-family: 'Cinzel', serif;
      min-width: 26px;
      text-align: right;
    }

    .pa-disc-bar {
      flex: 1;
      height: 5px;
      background: rgba(0,0,0,0.5);
      border-radius: 1px;
      overflow: hidden;
      border: 1px solid rgba(155,115,38,0.15);
    }

    .pa-disc-bar-fill {
      height: 100%;
      transition: width 0.5s ease-out;
      opacity: 0.85;
    }

    .pa-disc-pct {
      font-size: 10px;
      font-family: 'Cinzel', serif;
      font-weight: 700;
      min-width: 32px;
      text-align: right;
    }

    .pa-disc-breach-count {
      font-size: 9px;
      font-family: 'Cinzel', serif;
      margin-left: auto;
    }
    .pa-disc-clean { color: #4ade80; }
    .pa-disc-dirty  { color: #f87171; }

    .pa-disc-timeline { margin-top: 4px; }

    .pa-disc-tl-label {
      font-size: 8px;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--eso-text-dim, #a08858);
      display: block;
      margin-bottom: 5px;
    }

    .pa-disc-dots {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
      margin-bottom: 6px;
    }

    .pa-disc-dot {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      cursor: default;
      transition: transform 0.1s;
    }
    .pa-disc-dot:hover { transform: scale(1.3); }

    .pa-disc-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .pa-disc-leg {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 8px;
      color: var(--eso-text-dim, #a08858);
    }

    .pa-disc-leg-dot {
      width: 8px;
      height: 8px;
      border-radius: 1px;
      display: inline-block;
    }

    /* ── aMCC Neural Density ── */
    .pa-amcc-header {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 10px;
    }

    .pa-amcc-score-wrap {
      display: flex;
      align-items: baseline;
      gap: 2px;
      flex-shrink: 0;
    }

    .pa-amcc-score {
      font-size: 36px;
      font-weight: 700;
      font-family: 'Cinzel', serif;
      line-height: 1;
    }

    .pa-amcc-score-denom {
      font-size: 12px;
      color: var(--eso-text-dim, #a08858);
      font-family: 'Cinzel', serif;
    }

    .pa-amcc-meta {
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
    }

    .pa-amcc-tier {
      font-size: 13px;
      font-weight: 600;
      font-family: 'Cinzel', serif;
      letter-spacing: 1px;
      text-transform: uppercase;
    }

    .pa-amcc-desc {
      font-size: 10px;
      color: var(--eso-text, #d4b483);
      line-height: 1.4;
    }

    .pa-amcc-count {
      font-size: 9px;
      color: var(--eso-text-dim, #a08858);
    }

    .pa-amcc-sparkline {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 48px;
      margin-bottom: 8px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(155,115,38,0.15);
      border-radius: 2px;
      padding: 4px 6px;
    }

    .pa-amcc-bar {
      flex: 1;
      min-width: 3px;
      border-radius: 1px 1px 0 0;
      transition: height 0.4s ease-out;
    }

    .pa-amcc-legend {
      display: flex;
      justify-content: space-between;
      gap: 4px;
    }

    .pa-amcc-leg-item {
      font-size: 8px;
      font-family: 'Cinzel', serif;
      letter-spacing: 0.5px;
    }

    /* ── Mobile (Samsung S23 ≈ 393px) ───────────────────────────── */
    @media (max-width: 600px) {
      .pa-section { padding: 10px 10px; }

      /* Heatmap: 7 columns → larger, tappable cells */
      .pa-heatmap { grid-template-columns: repeat(7, 1fr); }
      .pa-heat-cell  { min-height: 30px; }
      .pa-heat-label { font-size: 6px; }
      .pa-heat-xp    { font-size: 7px; }

      /* Grit chart: scroll horizontally with fixed-width bars */
      .pa-grit-chart {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        gap: 4px;
      }
      .pa-grit-chart::-webkit-scrollbar { display: none; }
      .pa-grit-bar-col { flex: 0 0 30px; min-width: 30px; }
      .pa-grit-pct     { font-size: 7px; }
      .pa-grit-date    { font-size: 6px; }

      /* Velocity table wrapper: scroll horizontally */
      .pa-table-wrap {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        margin: 0 -2px;
        padding: 0 2px;
      }
      .pa-velocity-table { min-width: 380px; font-size: 9px; }
      .pa-velocity-table th,
      .pa-velocity-table td { padding: 4px 5px; white-space: nowrap; }

      /* Time-to-level: smaller date text */
      .pa-ttl-date { font-size: 9px; }
      .pa-ttl-xp   { min-width: 60px; font-size: 8px; }

      /* Discipline: tighter rows */
      .pa-disc-cat-name { min-width: 70px; font-size: 9px; }
      .pa-disc-cat-row  { gap: 5px; padding: 4px 6px; }
    }
  `]
})
export class ProgressionAnalyticsComponent implements OnInit, OnDestroy {
  private readonly http          = inject(HttpClient);
  private readonly socketService = inject(SocketService);
  private socketSub?: Subscription;

  isLoading    = signal(true);
  data         = signal<AnalyticsResponse | null>(null);
  amccData     = signal<AmccData | null>(null);

  readonly amccTiers = [
    { label: 'Atrophying', color: '#f87171' },
    { label: 'Baseline',   color: '#fbbf24' },
    { label: 'Developing', color: '#60a5fa' },
    { label: 'Hardened',   color: '#c084fc' },
    { label: 'Elite',      color: '#4ade80' },
  ];

  amccScoreColor = computed(() => {
    const s = this.amccData()?.score ?? 0;
    if (s >= 95) return '#4ade80';
    if (s >= 80) return '#c084fc';
    if (s >= 60) return '#60a5fa';
    if (s >= 40) return '#fbbf24';
    return '#f87171';
  });

  amccBarColor(pct: number): string {
    if (pct >= 95) return '#4ade80';
    if (pct >= 80) return '#c084fc';
    if (pct >= 60) return '#60a5fa';
    if (pct >= 40) return '#fbbf24';
    if (pct > 0)   return '#f87171';
    return 'rgba(155,115,38,0.12)';
  }

  hasData = computed(() => {
    const d = this.data();
    return d !== null && (d.recentEntries?.length > 0 || d.timeToLevel?.length > 0);
  });

  recentEntriesReversed = computed(() => {
    const entries = this.data()?.recentEntries ?? [];
    return [...entries].reverse();
  });

  activeAlerts = computed(() => this.data()?.systemAlerts ?? []);

  gritEntries = computed(() => {
    const entries = this.data()?.recentEntries ?? [];
    return entries
      .filter(e => e.gritPct !== undefined)
      .reverse()
      .map(e => ({ date: e.dateLabel, pct: e.gritPct! }));
  });

  velocityRows = computed(() => {
    const proj = this.data()?.projections ?? {};
    const classOrder = ['Developer', 'Sage', 'Warrior', 'Redteamer', 'Artist', 'Financial Strategist', 'Survivalist'];
    return classOrder
      .filter(name => proj[name] !== undefined)
      .map(name => ({
        name,
        avgDay:   proj[name].avgDailyXP,
        avgWeek:  proj[name].avgWeeklyXP,
        proj6mo:  proj[name].projected6mo,
        proj12mo: proj[name].projected12mo,
      }));
  });

  disciplineScoreColor = computed(() => {
    const score = this.data()?.disciplineSummary?.disciplineScore ?? 0;
    if (score >= 90) return '#4ade80';
    if (score >= 75) return '#f2c96a';
    if (score >= 60) return '#fbbf24';
    return '#f87171';
  });

  disciplineGrade = computed(() => {
    const score = this.data()?.disciplineSummary?.disciplineScore ?? 0;
    if (score >= 95) return 'Grandmaster';
    if (score >= 85) return 'Master';
    if (score >= 75) return 'Expert';
    if (score >= 60) return 'Adept';
    if (score >= 40) return 'Novice';
    return 'Fallen';
  });

  disciplineCategories = computed(() => {
    const d = this.data()?.disciplineSummary;
    if (!d) return [] as Array<{ icon: string; label: string; passRate: number | undefined; streak: number | undefined; breach: number | undefined; color: string }>;
    const barColor = (rate: number) =>
      rate >= 90 ? '#4ade80' : rate >= 70 ? '#fbbf24' : '#f87171';
    return [
      { icon: '🍷', label: 'Alcohol',      passRate: d.alcoholPassRate, streak: d.alcoholStreak, breach: undefined,             color: barColor(d.alcoholPassRate) },
      { icon: '🔥', label: 'Lust',          passRate: d.lustPassRate,    streak: d.lustStreak,    breach: undefined,             color: barColor(d.lustPassRate) },
      { icon: '🥗', label: 'Diet / Junk',   passRate: d.dietPassRate,    streak: d.dietStreak,    breach: undefined,             color: barColor(d.dietPassRate) },
      { icon: '🥩', label: 'Red Meat',      passRate: undefined,          streak: undefined,        breach: d.redMeatBreachCount, color: '#f87171' },
      { icon: '🍰', label: 'Sweets',        passRate: undefined,          streak: undefined,        breach: d.sweetsBreachCount,  color: '#f87171' },
      { icon: '◆',  label: 'Other',         passRate: undefined,          streak: undefined,        breach: d.otherBreachCount,   color: '#f87171' },
    ];
  });

  disciplineTimeline = computed(() => {
    const d = this.data()?.disciplineSummary;
    if (!d) return [] as Array<{ color: string; label: string }>;
    return [...d.entries].reverse().map(e => {
      const { alcohol, lust } = e.breaches;
      const total = e.indulgenceCount;
      let color: string;
      let label: string;
      if (total === 0) {
        color = '#1a3d18'; label = `${e.dateLabel}: Clean`;
      } else if (total >= 2) {
        color = '#7f1d1d'; label = `${e.dateLabel}: Multiple`;
      } else if (alcohol) {
        color = '#3730a3'; label = `${e.dateLabel}: Alcohol`;
      } else if (lust) {
        color = '#be185d'; label = `${e.dateLabel}: Lust`;
      } else {
        color = '#78350f'; label = `${e.dateLabel}: Diet`;
      }
      return { color, label };
    });
  });

  ngOnInit(): void {
    this.loadAnalytics();
    this.loadAmcc();
    this.socketSub = this.socketService.onCharacterUpdate().subscribe(() => {
      this.loadAnalytics();
      this.loadAmcc();
    });
  }

  ngOnDestroy(): void {
    this.socketSub?.unsubscribe();
  }

  private loadAnalytics(): void {
    this.http.get<AnalyticsResponse>(`${environment.apiUrl}/api/character/analytics`).subscribe({
      next:  (d) => { this.data.set(d); this.isLoading.set(false); },
      error: ()  => this.isLoading.set(false)
    });
  }

  private loadAmcc(): void {
    this.http.get<AmccData>(`${environment.apiUrl}/api/character/amcc`).subscribe({
      next:  (d) => { if (d.success) this.amccData.set(d); },
      error: ()  => { /* non-critical — panel stays hidden */ }
    });
  }

  getClassColor(name: string): string {
    return classColor(name);
  }

  /** Fill % of progress bar = how far through current level (inverse of xpNeeded/xpToNextLevel) */
  getLevelPct(cls: TimeToLevel): number {
    if (cls.isInactive) return 5;
    const total = cls.currentXP + cls.xpNeeded;
    if (total === 0) return 0;
    return Math.min(100, Math.round((cls.currentXP / total) * 100));
  }

  /** Heat cell background based on XP */
  heatColor(xp: number): string {
    if (xp === 0) return 'rgba(155,115,38,0.06)';
    const intensity = Math.min(1, xp / 50);
    const alpha = 0.15 + intensity * 0.75;
    return `rgba(201,168,76,${alpha.toFixed(2)})`;
  }
}
