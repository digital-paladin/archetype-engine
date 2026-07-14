import { Component, Input, OnChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

export interface SleepData {
  score: number;
  hours: number;
  vitality: number;
  efficiency: number;
  deep_min: number;
  rem_min: number;
  light_min: number;
  awake_min: number;
}

export interface SleepDayData extends SleepData {
  date: string; // YYYY-MM-DD
}

export interface FitbitActivity {
  name: string;
  durationMin: number;    // minutes
  calories: number;
  steps?: number;
  distanceKm?: number;
  startTime: string;      // "HH:MM"
}

export interface ActivitySummary {
  steps: number;
  activeMinutes: number;       // fairlyActive + veryActive
  lightlyActiveMinutes?: number;
  sedentaryMinutes?: number;
  caloriesOut: number;
  activeZoneMinutes?: number;
  activities: FitbitActivity[];
  restingHR?: number;
  heartZones?: { name: string; minutes: number; calOut: number; min: number; max: number }[];
}

export interface VitalsData {
  weight?: number;
  bmi?: number;
  bodyFat?: number;
  spo2Avg?: number;
  spo2Min?: number;
  spo2Max?: number;
  vo2Max?: string;
  respiratoryRate?: number;
  waterOz?: number;          // total water logged today (fl oz)
  weeklyAvgWeight?: number;  // 7-day rolling avg bodyweight (lbs)
  weeklyWeightDays?: number; // how many of the past 7 days had a weight log entry
}

@Component({
  selector: 'app-sleep-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sleep-panel">

      <!-- ── Tonight's Sleep ── -->
      <section class="eso-panel sleep-card" *ngIf="today; else noSleep">
        <h3 class="eso-panel-title">💤 Tonight's Sleep</h3>

        <div class="tonight-grid">

          <!-- Score ring -->
          <div class="score-ring-wrap">
            <svg class="score-ring" viewBox="0 0 100 100">
              <circle class="ring-track" cx="50" cy="50" r="40"/>
              <circle class="ring-fill"
                cx="50" cy="50" r="40"
                [style.stroke-dasharray]="scoreDash(today!.score)"
                [class]="scoreRingClass(today!.score)"/>
            </svg>
            <div class="score-center">
              <span class="score-value">{{ today!.score }}</span>
              <span class="score-label">/ 100</span>
            </div>
          </div>

          <!-- Key stats -->
          <div class="tonight-stats">
            <div class="eso-stat-row">
              <span class="eso-label">⏱ Duration</span>
              <span class="eso-value" [class]="hoursClass(today!.hours)">{{ today!.hours }} hrs</span>
            </div>
            <div class="eso-stat-row">
              <span class="eso-label">⚡ Vitality</span>
              <span class="eso-value">{{ today!.vitality }} / 10</span>
            </div>
            <div class="eso-stat-row">
              <span class="eso-label">📊 Efficiency</span>
              <span class="eso-value">{{ today!.efficiency }}%</span>
            </div>

            <!-- Vitality bar -->
            <div class="eso-bar-track" style="margin-top:8px">
              <div class="eso-bar-fill"
                   [class]="vitalityBarClass(today!.vitality)"
                   [style.width.%]="(today!.vitality / 10) * 100"></div>
            </div>
            <div class="bar-labels">
              <span class="bar-label-lo">0</span>
              <span class="bar-label-hi">10</span>
            </div>
          </div>

        </div>
      </section>

      <!-- No sleep data state -->
      <ng-template #noSleep>
        <section class="eso-panel sleep-card sleep-empty">
          <h3 class="eso-panel-title">💤 Tonight's Sleep</h3>
          <div class="eso-placeholder-content">
            <span class="eso-placeholder-icon">💤</span>
            <p class="eso-placeholder-text">No sleep data for today</p>
            <p class="eso-placeholder-sub">
              Connect Oura (or legacy Fitbit) or wait until morning data syncs.<br>
              <button type="button" class="fitbit-link" (click)="connectOura()">Authorize Oura →</button>
              <span class="wearable-sep">·</span>
              <a [href]="fitbitAuthUrl" class="fitbit-link">Fitbit (legacy) →</a>
            </p>
          </div>
        </section>
      </ng-template>

      <!-- ── Sleep Stages ── (only when today has stage data) -->
      <section class="eso-panel sleep-card" *ngIf="today && hasStagData(today)">
        <h3 class="eso-panel-title">🧬 Sleep Stages</h3>
        <div class="stages-list">

          <div class="stage-row">
            <div class="stage-meta">
              <span class="stage-dot deep-dot"></span>
              <span class="stage-name">Deep</span>
              <span class="stage-min">{{ today!.deep_min }} min</span>
            </div>
            <div class="eso-bar-track">
              <div class="eso-bar-fill stage-bar-deep"
                   [style.width.%]="stagePct(today!.deep_min)"></div>
            </div>
          </div>

          <div class="stage-row">
            <div class="stage-meta">
              <span class="stage-dot rem-dot"></span>
              <span class="stage-name">REM</span>
              <span class="stage-min">{{ today!.rem_min }} min</span>
            </div>
            <div class="eso-bar-track">
              <div class="eso-bar-fill stage-bar-rem"
                   [style.width.%]="stagePct(today!.rem_min)"></div>
            </div>
          </div>

          <div class="stage-row">
            <div class="stage-meta">
              <span class="stage-dot light-dot"></span>
              <span class="stage-name">Light</span>
              <span class="stage-min">{{ today!.light_min }} min</span>
            </div>
            <div class="eso-bar-track">
              <div class="eso-bar-fill stage-bar-light"
                   [style.width.%]="stagePct(today!.light_min)"></div>
            </div>
          </div>

          <div class="stage-row">
            <div class="stage-meta">
              <span class="stage-dot awake-dot"></span>
              <span class="stage-name">Awake</span>
              <span class="stage-min">{{ today!.awake_min }} min</span>
            </div>
            <div class="eso-bar-track">
              <div class="eso-bar-fill stage-bar-awake"
                   [style.width.%]="stagePct(today!.awake_min)"></div>
            </div>
          </div>

        </div>

        <div class="stage-total-label">Total time in bed: {{ totalBedMin(today!) }} min</div>
      </section>

      <!-- ── Sleep Debt ── -->
      <section class="eso-panel sleep-card" *ngIf="sleepDebt !== null">
        <h3 class="eso-panel-title">📉 Sleep Debt</h3>
        <div class="debt-display">
          <div class="eso-stat-row">
            <span class="eso-label">Accumulated Debt</span>
            <span class="eso-value" [class]="debtClass(sleepDebt!)">{{ sleepDebt }} hrs</span>
          </div>
          <div class="eso-bar-track">
            <div class="eso-bar-fill"
                 [class]="debtBarClass(sleepDebt!)"
                 [style.width.%]="debtBarWidth(sleepDebt!)"></div>
          </div>
          <div class="debt-note">
            <span *ngIf="sleepDebt! <= 2">🟢 Debt under control — keep it up</span>
            <span *ngIf="sleepDebt! > 2 && sleepDebt! <= 5">🟡 Moderate debt — prioritize 8+ hrs tonight</span>
            <span *ngIf="sleepDebt! > 5 && sleepDebt! <= 10">🟠 High debt — recovery sleep needed</span>
            <span *ngIf="sleepDebt! > 10">🔴 Critical debt — immediate intervention required</span>
          </div>
        </div>
      </section>

      <!-- ── 7-Day Trend ── -->
      <section class="eso-panel sleep-card" *ngIf="week && week.length > 0">
        <h3 class="eso-panel-title">📅 7-Day Sleep History</h3>

        <div class="week-chart">
          <div class="week-bar-wrap" *ngFor="let day of weekReversed()">
            <div class="week-bar-outer">
              <div class="week-bar-fill"
                   [class]="weekBarClass(day.score)"
                   [style.height.%]="weekBarHeight(day.hours)">
              </div>
            </div>
            <div class="week-bar-label">{{ day.hours > 0 ? day.hours + 'h' : '—' }}</div>
            <div class="week-bar-date">{{ formatDay(day.date) }}</div>
          </div>
        </div>

        <div class="week-legend">
          <span class="legend-item"><span class="legend-dot excellent-dot"></span>≥7.5 hrs</span>
          <span class="legend-item"><span class="legend-dot good-dot"></span>6–7.5 hrs</span>
          <span class="legend-item"><span class="legend-dot poor-dot"></span>&lt;6 hrs</span>
          <span class="legend-item"><span class="legend-dot none-dot"></span>No data</span>
        </div>

        <!-- Summary stats row -->
        <div class="eso-divider"></div>
        <div class="week-summary-row">
          <div class="week-stat">
            <span class="week-stat-val">{{ avgHours() }}</span>
            <span class="week-stat-label">avg hrs</span>
          </div>
          <div class="week-stat">
            <span class="week-stat-val">{{ avgScore() }}</span>
            <span class="week-stat-label">avg score</span>
          </div>
          <div class="week-stat">
            <span class="week-stat-val">{{ avgVitality() }}</span>
            <span class="week-stat-label">avg vitality</span>
          </div>
          <div class="week-stat">
            <span class="week-stat-val">{{ daysWithData() }}/7</span>
            <span class="week-stat-label">days logged</span>
          </div>
        </div>
      </section>

      <!-- ── 30-Day Paydown Trend ── -->
      <section class="eso-panel sleep-card" *ngIf="month && month.length > 0">  
        <h3 class="eso-panel-title">📆 30-Day Paydown Trend</h3>

        <div class="month-chart">
          <!-- 8 hr baseline indicator -->
          <div class="baseline-line" title="8 Hour Baseline"></div>
          
          <div class="month-bar-wrap" *ngFor="let day of monthReversed()" title="{{ day.date }}: {{ day.hours }} hrs (Score: {{ day.score }})">       
            <div class="month-bar-outer">
              <div class="month-bar-fill"
                   [class]="monthBarClass(day.hours, day.score)"
                   [style.height.%]="monthBarHeight(day.hours)">
              </div>
            </div>
            <!-- only show a few labels to avoid crowding -->
            <div class="month-bar-label" *ngIf="day.date.endsWith('-01') || day.date.endsWith('-15')">{{ day.date.split('-')[1] + '/' + day.date.split('-')[2] }}</div>
          </div>
        </div>

        <div class="week-legend" style="margin-top: 24px;">
          <span class="legend-item"><span class="legend-dot" style="background:#6fcf97"></span>Paydown (&gt;8h)</span>
          <span class="legend-item"><span class="legend-dot" style="background:#c9a84c"></span>Maintenance (6-8h)</span>
          <span class="legend-item"><span class="legend-dot" style="background:#e05c44"></span>Deficit (&lt;6h)</span>
        </div>
      </section>

      <!-- ── Physical Activity (Fitbit auto-detected) ── -->
      <section class="eso-panel sleep-card" *ngIf="hasActivityData()">
        <h3 class="eso-panel-title">🏃 Physical Activity <span class="fitbit-sync-badge">Fitbit</span></h3>

        <!-- Summary stats -->
        <div class="activity-summary-row">
          <div class="activity-stat" *ngIf="activities!.steps > 0">
            <span class="activity-stat-val">{{ activities!.steps | number }}</span>
            <span class="activity-stat-label">steps</span>
          </div>
          <div class="activity-stat" *ngIf="activities!.activeMinutes > 0">
            <span class="activity-stat-val">{{ activities!.activeMinutes }}</span>
            <span class="activity-stat-label">active min</span>
          </div>
          <div class="activity-stat" *ngIf="activities!.caloriesOut > 0">
            <span class="activity-stat-val">{{ activities!.caloriesOut | number }}</span>
            <span class="activity-stat-label">cal burned</span>
          </div>
        </div>

        <!-- Logged activities -->
        <ng-container *ngIf="activities!.activities.length > 0">
          <div class="eso-divider"></div>
          <div class="activity-list">
            <div class="activity-row" *ngFor="let act of activities!.activities">
              <span class="activity-icon-cell">{{ activityIcon(act.name) }}</span>
              <div class="activity-info">
                <span class="activity-name">{{ act.name }}</span>
                <span class="activity-meta">
                  {{ act.durationMin }} min
                  <span *ngIf="act.distanceKm"> · {{ act.distanceKm }} km</span>
                  <span *ngIf="act.calories > 0"> · {{ act.calories }} cal</span>
                </span>
              </div>
              <span class="activity-time">{{ act.startTime }}</span>
            </div>
          </div>
        </ng-container>

        <!-- Steps only, no logged workouts -->
        <p class="activity-steps-note"
           *ngIf="activities!.activities.length === 0 && activities!.steps > 0">
          No logged workouts — general activity tracked via step count
        </p>

      </section>

      <!-- ── Paladin Vitals ── -->
      <section class="eso-panel sleep-card" *ngIf="vitals">
        <h3 class="eso-panel-title">🩺 Paladin Vitals <span class="fitbit-sync-badge">Fitbit</span></h3>
        <div class="vitals-grid">
          <div class="vitals-stat" *ngIf="vitals!.weight != null">
            <span class="vitals-val">{{ vitals!.weight }}</span>
            <span class="vitals-label">weight (today)</span>
          </div>
          <div class="vitals-stat" *ngIf="vitals!.weeklyAvgWeight != null">
            <span class="vitals-val">{{ vitals!.weeklyAvgWeight }}</span>
            <span class="vitals-label">7-day avg wt</span>
          </div>
          <div class="vitals-stat" *ngIf="vitals!.bmi != null">
            <span class="vitals-val">{{ vitals!.bmi }}</span>
            <span class="vitals-label">BMI</span>
          </div>
          <div class="vitals-stat" *ngIf="vitals!.bodyFat != null">
            <span class="vitals-val">{{ vitals!.bodyFat }}%</span>
            <span class="vitals-label">body fat</span>
          </div>
          <div class="vitals-stat" *ngIf="vitals!.spo2Avg != null">
            <span class="vitals-val">{{ vitals!.spo2Avg }}%</span>
            <span class="vitals-label">SpO₂ avg</span>
          </div>
          <div class="vitals-stat" *ngIf="vitals!.spo2Min != null">
            <span class="vitals-val">{{ vitals!.spo2Min }}–{{ vitals!.spo2Max }}%</span>
            <span class="vitals-label">SpO₂ range</span>
          </div>
          <div class="vitals-stat" *ngIf="vitals!.vo2Max">
            <span class="vitals-val">{{ vitals!.vo2Max }}</span>
            <span class="vitals-label">VO₂ max</span>
          </div>
          <div class="vitals-stat" *ngIf="vitals!.respiratoryRate != null">
            <span class="vitals-val">{{ vitals!.respiratoryRate }}</span>
            <span class="vitals-label">br / min</span>
          </div>
          <div class="vitals-stat" *ngIf="vitals!.waterOz != null">
            <span class="vitals-val">{{ vitals!.waterOz }} oz</span>
            <span class="vitals-label">💧 hydration</span>
          </div>
        </div>

        <!-- Protein target derived from 7-day avg bodyweight -->
        <ng-container *ngIf="vitals!.weeklyAvgWeight != null">
          <div class="eso-divider" style="margin: 10px 0 8px;"></div>
          <div class="eso-stat-row">
            <span class="eso-label">🥩 Daily protein target</span>
            <span class="eso-value" style="color:#c8a84b; font-weight:600;">{{ proteinFloor() }}–{{ proteinTarget() }}g</span>
          </div>
          <div style="font-size:0.7rem; opacity:0.5; margin-top:2px;">
            0.64 × {{ vitals!.weeklyAvgWeight }}lb floor &nbsp;·&nbsp; 0.80 × {{ vitals!.weeklyAvgWeight }}lb target &nbsp;·&nbsp; {{ vitals!.weeklyWeightDays }}/7 days logged
          </div>
        </ng-container>

      </section>

    </div>
  `,
  styles: [`
    .sleep-panel {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* ── Tonight Section ────────────────────────────── */
    .tonight-grid {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 20px;
      align-items: start;
    }

    /* Score ring */
    .score-ring-wrap {
      position: relative;
      width: 100px;
      height: 100px;
    }
    .score-ring {
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }
    .ring-track {
      fill: none;
      stroke: rgba(155,115,38,0.20);
      stroke-width: 8;
    }
    .ring-fill {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
      stroke-dashoffset: 0;
      transition: stroke-dasharray 0.8s ease;
    }
    .ring-excellent { stroke: #6fcf97; }
    .ring-good      { stroke: #c9a84c; }
    .ring-poor      { stroke: #f2994a; }
    .ring-critical  { stroke: #eb5757; }

    .score-center {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }
    .score-value {
      display: block;
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--eso-gold, #c9a84c);
      line-height: 1;
    }
    .score-label {
      font-size: 0.65rem;
      color: var(--eso-text-dim, #8a7a5a);
    }

    /* Stat rows */
    .tonight-stats { display: flex; flex-direction: column; gap: 6px; }

    .hours-good     { color: #6fcf97 !important; }
    .hours-ok       { color: #c9a84c !important; }
    .hours-poor     { color: #f2994a !important; }
    .hours-critical { color: #eb5757 !important; }

    .bar-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.6rem;
      color: var(--eso-text-dim, #8a7a5a);
      margin-top: 2px;
    }

    /* ── Stages Section ─────────────────────────────── */
    .stages-list { display: flex; flex-direction: column; gap: 10px; }

    .stage-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .stage-meta {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stage-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .deep-dot   { background: #4f9cf9; }
    .rem-dot    { background: #bf7fff; }
    .light-dot  { background: #6fcf97; }
    .awake-dot  { background: #f2994a; }

    .stage-name {
      font-size: 0.8rem;
      color: var(--eso-text-dim, #8a7a5a);
      width: 42px;
    }
    .stage-min {
      margin-left: auto;
      font-size: 0.8rem;
      color: var(--eso-gold, #c9a84c);
    }

    /* Stage bar colors */
    .stage-bar-deep  { background: #4f9cf9 !important; }
    .stage-bar-rem   { background: #bf7fff !important; }
    .stage-bar-light { background: #6fcf97 !important; }
    .stage-bar-awake { background: #f2994a !important; }

    .stage-total-label {
      margin-top: 10px;
      font-size: 0.72rem;
      color: var(--eso-text-dim, #8a7a5a);
      text-align: right;
    }

    /* ── Sleep Debt Section ─────────────────────────── */
    .debt-display { display: flex; flex-direction: column; gap: 8px; }

    .debt-note {
      font-size: 0.75rem;
      margin-top: 4px;
      color: var(--eso-text-dim, #8a7a5a);
    }
    .debt-ok       { color: #6fcf97 !important; }
    .debt-moderate { color: #c9a84c !important; }
    .debt-high     { color: #f2994a !important; }
    .debt-critical { color: #eb5757 !important; }

    .debt-bar-ok       { background: #6fcf97 !important; }
    .debt-bar-moderate { background: #c9a84c !important; }
    .debt-bar-high     { background: #f2994a !important; }
    .debt-bar-critical { background: #eb5757 !important; }

    /* ── 7-Day Trend Section ────────────────────────── */
    
    .month-chart {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 100px;
      padding: 8px 0 16px; /* extra bottom padding for labels */
      position: relative;
    }
    .month-bar-wrap {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
      position: relative;
    }
    .month-bar-outer {
      flex: 1;
      width: 100%;
      position: relative;
      background: rgba(155,115,38,0.05);
      border-radius: 2px 2px 0 0;
      display: flex;
      align-items: flex-end;
    }
    .month-bar-fill {
      width: 100%;
      border-radius: 2px 2px 0 0;
      transition: height 0.6s ease;
      min-height: 1px;
    }
    .month-bar-label {
      position: absolute;
      bottom: -15px;
      font-size: 0.55rem;
      color: var(--eso-gold, #c9a84c);
      opacity: 0.7;
      white-space: nowrap;
    }
    .baseline-line {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 16px; /* above the padding */
      border-bottom: 1px dashed rgba(255,255,255,0.4);
      pointer-events: none;
      z-index: 10;
      height: 66.6%;
    }
    .bar-paydown    { background: #6fcf97 !important; }
    .bar-maintenance{ background: #c9a84c !important; }
    .bar-deficit    { background: #e05c44 !important; }
    .week-chart {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      height: 100px;
      padding: 8px 0 4px;
    }
    .week-bar-wrap {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      height: 100%;
    }
    .week-bar-outer {
      flex: 1;
      width: 100%;
      position: relative;
      background: rgba(155,115,38,0.10);
      border-radius: 3px 3px 0 0;
      display: flex;
      align-items: flex-end;
    }
    .week-bar-fill {
      width: 100%;
      border-radius: 3px 3px 0 0;
      transition: height 0.6s ease;
      min-height: 2px;
    }
    .bar-excellent { background: #6fcf97 !important; }
    .bar-good      { background: #c9a84c !important; }
    .bar-poor      { background: #f2994a !important; }
    .bar-none      { background: rgba(155,115,38,0.15) !important; min-height: 0 !important; }

    .week-bar-label {
      font-size: 0.65rem;
      color: var(--eso-gold, #c9a84c);
      text-align: center;
    }
    .week-bar-date {
      font-size: 0.6rem;
      color: var(--eso-text-dim, #8a7a5a);
      text-align: center;
    }

    .week-legend {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 8px;
      font-size: 0.7rem;
      color: var(--eso-text-dim, #8a7a5a);
    }
    .legend-item { display: flex; align-items: center; gap: 5px; }
    .legend-dot  { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
    .excellent-dot { background: #6fcf97; }
    .good-dot      { background: #c9a84c; }
    .poor-dot      { background: #f2994a; }
    .none-dot      { background: rgba(155,115,38,0.25); }

    .week-summary-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-top: 10px;
    }
    .week-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    .week-stat-val {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--eso-gold, #c9a84c);
    }
    .week-stat-label {
      font-size: 0.65rem;
      color: var(--eso-text-dim, #8a7a5a);
      text-align: center;
    }

    /* ── Empty / link state ─────────────────────────── */
    .fitbit-link {
      background: none;
      border: none;
      padding: 0;
      font: inherit;
      cursor: pointer;
      color: var(--eso-gold, #c9a84c);
      text-decoration: underline;
    }
    .fitbit-link:hover { text-decoration: underline; }
    .wearable-sep { margin: 0 0.35rem; opacity: 0.6; }

    /* Vitality bar colors (reuse dashboard classes) */
    .eso-bar-vitality-high    { background: linear-gradient(90deg, #6fcf97, #27ae60) !important; }
    .eso-bar-vitality-medium  { background: linear-gradient(90deg, #f2c94c, #e2a400) !important; }
    .eso-bar-vitality-low     { background: linear-gradient(90deg, #f2994a, #d9531e) !important; }
    .eso-bar-vitality-minimal { background: linear-gradient(90deg, #eb5757, #c0392b) !important; }

    /* ── Physical Activity Section ─────────────────── */
    .fitbit-sync-badge {
      font-size: 0.6rem;
      background: rgba(201,168,76,0.18);
      border: 1px solid rgba(201,168,76,0.35);
      color: var(--eso-gold, #c9a84c);
      padding: 1px 6px;
      border-radius: 3px;
      margin-left: 8px;
      vertical-align: middle;
      letter-spacing: 0.5px;
    }

    .activity-summary-row {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }
    .activity-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 64px;
    }
    .activity-stat-val {
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--eso-gold, #c9a84c);
    }
    .activity-stat-label {
      font-size: 0.62rem;
      color: var(--eso-text-dim, #8a7a5a);
    }

    .activity-list { display: flex; flex-direction: column; gap: 8px; }

    .activity-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .activity-icon-cell {
      font-size: 1.2rem;
      line-height: 1;
      width: 28px;
      text-align: center;
      flex-shrink: 0;
    }
    .activity-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
    }
    .activity-name {
      font-size: 0.85rem;
      color: var(--eso-gold-bright, #f2c96a);
    }
    .activity-meta {
      font-size: 0.72rem;
      color: var(--eso-text-dim, #8a7a5a);
    }
    .activity-time {
      font-size: 0.7rem;
      color: var(--eso-text-dim, #8a7a5a);
      white-space: nowrap;
    }
    .activity-steps-note {
      font-size: 0.72rem;
      color: var(--eso-text-dim, #8a7a5a);
      margin-top: 6px;
    }

    /* ── Paladin Vitals ───────────────────────────────── */
    .vitals-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .vitals-stat {
      background: var(--eso-panel-inner, rgba(0,0,0,0.3));
      border: 1px solid var(--eso-border, #5a3e0a);
      border-radius: 4px;
      padding: 8px 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 68px;
    }

    .vitals-val {
      font-size: 1.05rem;
      font-weight: bold;
      color: var(--eso-text-gold, #d4a853);
    }

    .vitals-label {
      font-size: 0.62rem;
      color: var(--eso-text-dim, #8a7a5a);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 2px;
    }

    /* ── Mobile (≤ 420 px) ─────────────────────────── */
    @media (max-width: 420px) {
      /* Shrink score ring column so tonight-grid doesn't overflow */
      .tonight-grid {
        grid-template-columns: 88px 1fr;
        gap: 12px;
      }
      .score-ring-wrap { width: 78px; height: 78px; }
      .score-value     { font-size: 1.3rem; }

      /* Week summary: 2×2 grid instead of 4 across */
      .week-summary-row { grid-template-columns: repeat(2, 1fr); }

      /* Vitals chips: wrap tighter */
      .vitals-stat { min-width: 60px; padding: 6px 10px; }
    }
  `],
})
export class SleepPanelComponent implements OnChanges {
  private readonly http = inject(HttpClient);
  readonly fitbitAuthUrl = `${environment.apiUrl}/api/fitbit/auth`;

  @Input() today: SleepData | null = null;
  @Input() week: SleepDayData[] | null = null;
  @Input() month: SleepDayData[] | null = null;
  @Input() sleepDebt: number | null = null;
  @Input() activities: ActivitySummary | null = null;
  @Input() vitals: VitalsData | null = null;

  connectOura(): void {
    this.http.get<{ success: boolean; url?: string; error?: string }>(
      `${environment.apiUrl}/api/oura/connect-url`
    ).subscribe({
      next: (res) => {
        if (res.success && res.url) {
          window.location.href = res.url;
        } else {
          console.warn('[SleepPanel] Oura connect failed:', res.error);
          alert(res.error || 'Oura is not configured yet.');
        }
      },
      error: (err) => {
        const msg = err?.error?.error || 'Could not start Oura authorization.';
        console.warn('[SleepPanel] Oura connect error:', msg);
        alert(msg);
      },
    });
  }

  monthReversed(): SleepDayData[] {
    if (!this.month) return [];
    // slice() creates a copy so we don't mutate the input array
    return this.month.slice().reverse();
  }

  // ── Protein target (derived from 7-day avg bodyweight) ───────────────────

  proteinFloor():  number { return Math.round(0.64 * (this.vitals?.weeklyAvgWeight ?? 0)); }
  proteinTarget(): number { return Math.round(0.80 * (this.vitals?.weeklyAvgWeight ?? 0)); }

  private _totalBedMin = 1;

  ngOnChanges(): void {
    if (this.today) {
      this._totalBedMin = this.totalBedMin(this.today) || 1;
    }
  }

  // ── Score ring ──────────────────────────────────────────────────────────────

  scoreDash(score: number): string {
    const circumference = 2 * Math.PI * 40; // r=40
    const filled = (score / 100) * circumference;
    return `${filled} ${circumference}`;
  }

  scoreRingClass(score: number): string {
    if (score >= 80) return 'ring-fill ring-excellent';
    if (score >= 65) return 'ring-fill ring-good';
    if (score >= 45) return 'ring-fill ring-poor';
    return 'ring-fill ring-critical';
  }

  // ── Hours color class ───────────────────────────────────────────────────────

  hoursClass(hours: number): string {
    if (hours >= 7.5) return 'hours-good';
    if (hours >= 6)   return 'hours-ok';
    if (hours >= 4.5) return 'hours-poor';
    return 'hours-critical';
  }

  // ── Vitality bar class ──────────────────────────────────────────────────────

  vitalityBarClass(vitality: number): string {
    if (vitality >= 7)  return 'eso-bar-fill eso-bar-vitality-high';
    if (vitality >= 5)  return 'eso-bar-fill eso-bar-vitality-medium';
    if (vitality >= 3)  return 'eso-bar-fill eso-bar-vitality-low';
    return 'eso-bar-fill eso-bar-vitality-minimal';
  }

  // ── Stage data helpers ──────────────────────────────────────────────────────

  hasStagData(s: SleepData): boolean {
    return (s.deep_min + s.rem_min + s.light_min + s.awake_min) > 0;
  }

  totalBedMin(s: SleepData): number {
    return s.deep_min + s.rem_min + s.light_min + s.awake_min;
  }

  stagePct(min: number): number {
    if (!this.today) return 0;
    const total = this.totalBedMin(this.today);
    return total > 0 ? Math.round((min / total) * 100) : 0;
  }

  // ── Sleep debt helpers ──────────────────────────────────────────────────────

  debtClass(debt: number): string {
    if (debt <= 2)  return 'debt-ok';
    if (debt <= 5)  return 'debt-moderate';
    if (debt <= 10) return 'debt-high';
    return 'debt-critical';
  }

  debtBarClass(debt: number): string {
    if (debt <= 2)  return 'debt-bar-ok';
    if (debt <= 5)  return 'debt-bar-moderate';
    if (debt <= 10) return 'debt-bar-high';
    return 'debt-bar-critical';
  }

  debtBarWidth(debt: number): number {
    // 20 hrs = 100% bar width
    return Math.min((debt / 20) * 100, 100);
  }

  // ── Week chart helpers ──────────────────────────────────────────────────────

  weekReversed(): SleepDayData[] {
    return this.week ? [...this.week].reverse() : [];
  }

  weekBarHeight(hours: number): number {
    // Max bar = 10 hrs
    if (hours <= 0) return 0;
    return Math.min((hours / 10) * 100, 100);
  }

  weekBarClass(score: number): string {
    if (score <= 0) return 'week-bar-fill bar-none';
    if (score >= 75) return 'week-bar-fill bar-excellent';
    if (score >= 55) return 'week-bar-fill bar-good';
    return 'week-bar-fill bar-poor';
  }

  monthBarClass(hours: number, score: number): string {
    if (hours <= 0) return 'week-bar-fill bar-none';
    if (hours >= 8) return 'week-bar-fill bar-paydown'; // e.g. green for paying down debt
    if (score >= 75) return 'week-bar-fill bar-excellent';
    if (score >= 55) return 'week-bar-fill bar-good';
    return 'week-bar-fill bar-poor';
  }

  monthBarHeight(hours: number): number {
    return this.weekBarHeight(hours);
  }

  formatDay(dateStr: string): string {
    const [, , dd] = dateStr.split('-');
    const d = new Date(dateStr + 'T12:00:00');
    const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    return `${days[d.getDay()]}\n${parseInt(dd, 10)}`;
  }

  // ── Week summary stats ──────────────────────────────────────────────────────

  private activeDays(): SleepDayData[] {
    return (this.week || []).filter(d => d.hours > 0);
  }

  daysWithData(): number { return this.activeDays().length; }

  avgHours(): string {
    const days = this.activeDays();
    if (!days.length) return '—';
    return (days.reduce((s, d) => s + d.hours, 0) / days.length).toFixed(1);
  }

  avgScore(): string {
    const days = this.activeDays();
    if (!days.length) return '—';
    return Math.round(days.reduce((s, d) => s + d.score, 0) / days.length).toString();
  }

  avgVitality(): string {
    const days = this.activeDays();
    if (!days.length) return '—';
    return (days.reduce((s, d) => s + d.vitality, 0) / days.length).toFixed(1);
  }

  // ── Physical activity helpers ───────────────────────────────────────────────

  hasActivityData(): boolean {
    if (!this.activities) return false;
    return this.activities.steps > 0 || this.activities.activities.length > 0;
  }

  activityIcon(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('run') || n.includes('jog'))            return '🏃';
    if (n.includes('swim'))                                return '🏊';
    if (n.includes('walk'))                                return '🚶';
    if (n.includes('bike') || n.includes('cycl'))          return '🚴';
    if (n.includes('hike') || n.includes('trail'))         return '⛰️';
    if (n.includes('yoga') || n.includes('stretch'))       return '🧘';
    if (n.includes('weight') || n.includes('lift') || n.includes('strength')) return '🏋️';
    if (n.includes('sport') || n.includes('tennis') || n.includes('basket')) return '⚽';
    return '💪';
  }
}
