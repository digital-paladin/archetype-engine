import {
  Component, OnDestroy, inject, signal, computed, effect, untracked, WritableSignal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActionTrackerService } from './action-tracker.service';
import { environment } from '../environments/environment';

// ── Workout data ────────────────────────────────────────────────
const PROGRAM_START = new Date(2026, 1, 9); // Feb 9, 2026

const WEEK_PERCENTAGES = [0.70, 0.75, 0.78, 0.78, 0.83, 0.87, 0.91, 0.90];

// 1RM values from journal workouts (Mar 1, 2026):
// Squat: 115 lbs — formally tested Feb 9 (form breakdown at rep 2)
// Bench: 146 lbs — Epley estimate from 115 lbs × 4×8 working set
// Deadlift: 108 lbs — Epley estimate from 90 lbs × 4×6 working set
const ONE_RMS: Record<string, number> = { squat: 115, bench: 146, deadlift: 108 };

const WARMUP_ITEMS = [
  '5 min cardio / jump rope warm-up',
  'Foam rolling (quads, hamstrings, back)',
  'Hip flexor & ankle mobility',
  'Shoulder & thoracic mobility',
  'Bar-only warm-up sets (3×5)',
];

const ACCESSORY_BY_DAY: Record<string, string[]> = {
  squat:    ['Pull-Ups 3×max reps', 'Dead Hangs 3×30s', 'Romanian Deadlift 3×8', 'Bulgarian Split Squats 3×8', 'Planks 3×60s'],
  bench:    ['Dumbbell Rows 3×10 each', 'Face Pulls 3×15', 'Tricep Dips 3×max', 'Band Pull-Aparts 3×20', 'Core Hollow Hold 3×30s'],
  deadlift: ['Deficit Push-Ups 3×12', 'Barbell Row 3×8', 'Hip Thrust 3×12', 'Farmer Carries 3×40m', 'Cable Rows 3×12'],
  open:     ['Accessory A 3×10', 'Accessory B 3×10', 'Accessory C 3×10', 'Accessory D 3×10', 'Core work 2×60s'],
};

interface SetRow { weight: string; reps: string; done: boolean; }

type WorkoutDay    = 'squat' | 'bench' | 'deadlift' | 'open';
type RedTeamPhase  = 'Recon' | 'Initial Access' | 'Exploitation' | 'Post-Exploit' | 'Report';
type RTPlatform    = 'HTB' | 'PortSwigger' | 'TryHackMe' | 'Other';

function getCurrentProgramWeek(): number {
  const ms   = Date.now() - PROGRAM_START.getTime();
  const week = Math.floor(ms / (7 * 24 * 60 * 60 * 1000)) + 1;
  return Math.min(8, Math.max(1, week));
}

function getPhaseInfo(week: number): { sets: number; reps: string; label: string } {
  if (week <= 3) return { sets: 4, reps: '8',  label: `Wk${week} Volume (4×8)` };
  if (week <= 6) return { sets: 5, reps: '5',  label: `Wk${week} Intensity (5×5)` };
  if (week === 7) return { sets: 5, reps: '3', label: `Wk7 Peak (5×3)` };
  return { sets: 3, reps: '5',  label: 'Wk8 Deload' };
}

function suggestWeight(day: WorkoutDay): string {
  if (day === 'open') return '135';
  const week = getCurrentProgramWeek();
  const pct  = WEEK_PERCENTAGES[week - 1] ?? 0.70;
  const raw  = ONE_RMS[day] * pct;
  return String(Math.round(raw / 5) * 5); // round to nearest 5
}

function detectWorkoutDay(): WorkoutDay {
  const dow = new Date().getDay(); // 0=Sun,1=Mon,...
  if (dow === 1) return 'squat';
  if (dow === 3) return 'bench';
  if (dow === 5) return 'deadlift';
  return 'open';
}

// ── Activity-key → backend activityType map ───────────────────
const ACTIVITY_TYPE_MAP: Record<string, string> = {
  'workout-strength': 'workout-strength',
  'workout-cardio':   'workout-cardio',
  'workout-mma':      'workout-mma',
  'coding-routine':   'personal-project',
  'paladin-app-dev':  'paladin-app-dev',       // multi-class: Developer + Sage + Artist
  'htb-medium':       'redteam-lab',
  'prayer-routine':   'personal-project',      // fallback until added to xpCalculator
  'art-drawing':      'art-drawing',
  'christian-art-visual':  'christian-art-visual',  // multi-class: Artist + Sage
  'christian-art-music':   'christian-art-music',   // multi-class: Artist + Sage
  'christian-art-poetry':  'christian-art-poetry',  // multi-class: Artist + Sage
  'deep-focus':       'personal-project',
  'hydration':        'personal-project',
  'daily-log':        'personal-project',
};

// ── Component ─────────────────────────────────────────────────
@Component({
  selector: 'app-activity-session-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="session-panel" [class.panel-open]="isOpen()">

      <!-- ══ Panel Header ══ -->
      <div class="panel-header" *ngIf="currentAction() as action">
        <div class="panel-header-left">
          <span class="panel-activity-icon">{{ getIcon(action.activityKey) }}</span>
          <span class="panel-activity-name">{{ action.targetResult }}</span>
        </div>
        <div class="panel-timer">{{ actionTracker.formatDuration(action.duration) }}</div>
        <button class="panel-close" (click)="onCancel()" title="Cancel">✕</button>
      </div>

      <!-- ══ Scrollable Body ══ -->
      <div class="panel-body" *ngIf="currentAction() as action">

        <!-- ── WORKOUT TEMPLATE ── -->
        <ng-container *ngIf="templateType() === 'workout'">

          <!-- Week badge + Day selector -->
          <div class="tpl-section">
            <div class="tpl-week-badge">{{ phaseLabel }}</div>
            <div class="tpl-day-tabs">
              <button class="day-tab" [class.active]="workoutDay() === 'squat'"    (click)="setDay('squat')">MON Squat</button>
              <button class="day-tab" [class.active]="workoutDay() === 'bench'"    (click)="setDay('bench')">WED Bench</button>
              <button class="day-tab" [class.active]="workoutDay() === 'deadlift'" (click)="setDay('deadlift')">FRI Deadlift</button>
              <button class="day-tab" [class.active]="workoutDay() === 'open'"     (click)="setDay('open')">Open</button>
            </div>
          </div>

          <!-- Warmup checklist -->
          <div class="tpl-section">
            <div class="tpl-label">Warmup</div>
            <div class="check-row" *ngFor="let item of warmupItems; let i = index">
              <input type="checkbox" [id]="'wu-'+i"
                     [checked]="warmupChecks()[i]"
                     (change)="toggleWarmup(i)">
              <label [for]="'wu-'+i" [class.done]="warmupChecks()[i]">{{ item }}</label>
            </div>
          </div>

          <!-- Main lift sets table -->
          <div class="tpl-section">
            <div class="tpl-label">{{ mainLiftLabel() }}</div>
            <div class="sets-table">
              <div class="sets-head">
                <span>Set</span><span>Weight (lbs)</span><span>Reps</span><span>Done</span><span>Rest</span>
              </div>
              <div class="set-row" *ngFor="let s of sets(); let i = index"
                   [class.set-done]="s.done"
                   [class.set-resting]="activeRestSet() === i">
                <span class="set-num">{{ i + 1 }}</span>
                <input class="set-input" type="number" [(ngModel)]="s.weight"
                       [name]="'w'+i" placeholder="lbs" min="0">
                <input class="set-input" type="number" [(ngModel)]="s.reps"
                       [name]="'r'+i" placeholder="reps" min="0">
                <input type="checkbox" [(ngModel)]="s.done" [name]="'d'+i">
                <button class="rest-btn"
                        [class.rest-active]="activeRestSet() === i"
                        (click)="startRest(i, 90)">
                  <span *ngIf="activeRestSet() !== i">90s</span>
                  <span *ngIf="activeRestSet() === i"
                        [class.rest-urgent]="restCountdown() <= 10">
                    {{ restCountdown() }}s
                  </span>
                </button>
              </div>
            </div>
          </div>

          <!-- Accessory work -->
          <div class="tpl-section">
            <div class="tpl-label">Accessory Work</div>
            <div class="check-row" *ngFor="let item of accessoryItems(); let i = index">
              <input type="checkbox" [id]="'acc-'+i"
                     [checked]="accessoryChecks()[i]"
                     (change)="toggleAccessory(i)">
              <label [for]="'acc-'+i" [class.done]="accessoryChecks()[i]">{{ item }}</label>
            </div>
          </div>

          <!-- Notes -->
          <div class="tpl-section">
            <div class="tpl-label">Notes</div>
            <textarea class="tpl-textarea" rows="3" [(ngModel)]="workoutNotesVal"
                      placeholder="How did it feel? PRs? Form cues..."></textarea>
          </div>

        </ng-container>

        <!-- ── CODING TEMPLATE ── -->
        <ng-container *ngIf="templateType() === 'coding'">

          <div class="tpl-section">
            <div class="tpl-label">Story / Ticket</div>
            <input class="tpl-input" type="text" [(ngModel)]="storyIdVal"
                   placeholder="IQ-XXXX or task name">
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Task Description</div>
            <input class="tpl-input" type="text" [(ngModel)]="taskDescVal"
                   placeholder="What are you building?">
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Subtasks / Acceptance Criteria</div>
            <div class="check-row" *ngFor="let st of codingSubtasks(); let i = index">
              <input type="checkbox" [id]="'st-'+i"
                     [checked]="st.done"
                     (change)="toggleSubtask(i)">
              <input class="check-input-inline" type="text"
                     [(ngModel)]="st.label"
                     [name]="'stl'+i"
                     placeholder="subtask {{ i+1 }}...">
            </div>
            <button class="tpl-add-btn" (click)="addSubtask()">+ Add subtask</button>
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Notes / Blockers</div>
            <textarea class="tpl-textarea" rows="3" [(ngModel)]="codingNotesVal"
                      placeholder="Blockers, discoveries, references..."></textarea>
          </div>

        </ng-container>

        <!-- ── REDTEAM TEMPLATE ── -->
        <ng-container *ngIf="templateType() === 'redteam'">

          <div class="tpl-section">
            <div class="tpl-label">Platform</div>
            <div class="tpl-radio-row">
              <label *ngFor="let p of rtPlatforms" class="radio-opt"
                     [class.active]="rtPlatformVal === p">
                <input type="radio" [name]="'platform'" [value]="p"
                       [(ngModel)]="rtPlatformVal"> {{ p }}
              </label>
            </div>
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Target / Box Name</div>
            <input class="tpl-input" type="text" [(ngModel)]="rtTargetVal"
                   placeholder="e.g. Blunder, SQL Lab #12">
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Phase</div>
            <div class="phase-track">
              <button *ngFor="let ph of rtPhases" class="phase-btn"
                      [class.active]="rtPhaseVal === ph"
                      (click)="rtPhaseVal = ph">{{ ph }}</button>
            </div>
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Flag / Key Finding</div>
            <div class="flag-row">
              <input type="checkbox" id="flagFound" [(ngModel)]="rtFlagFoundVal">
              <label for="flagFound">Flag / root obtained</label>
            </div>
            <input *ngIf="rtFlagFoundVal" class="tpl-input" type="text"
                   [(ngModel)]="rtFlagVal" placeholder="flag{...} or note">
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Notes</div>
            <textarea class="tpl-textarea" rows="3" [(ngModel)]="rtNotesVal"
                      placeholder="Commands, payloads, steps tried..."></textarea>
          </div>

        </ng-container>

        <!-- ── PRAYER TEMPLATE ── -->
        <ng-container *ngIf="templateType() === 'prayer'">

          <div class="tpl-section">
            <div class="tpl-label">Scripture</div>
            <input class="tpl-input" type="text" [(ngModel)]="prayerScriptureVal"
                   placeholder="e.g. James 1:2-4">
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Gratitude (3 things)</div>
            <input *ngFor="let g of prayerGratitudeVals; let i = index"
                   class="tpl-input tpl-input-sm"
                   type="text"
                   [(ngModel)]="prayerGratitudeVals[i]"
                   [name]="'g'+i"
                   [placeholder]="'Grateful for ' + (i+1) + '...'">
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Reflection</div>
            <textarea class="tpl-textarea" rows="4" [(ngModel)]="prayerReflectionVal"
                      placeholder="What is God speaking to you today?"></textarea>
          </div>

        </ng-container>

        <!-- ── ARTIST TEMPLATE ── -->
        <ng-container *ngIf="templateType() === 'artist'">

          <div class="tpl-section">
            <div class="tpl-label">What are you working on?</div>
            <input class="tpl-input" type="text" [(ngModel)]="artistActivityVal"
                   placeholder="Project / piece name...">
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Progress Made</div>
            <textarea class="tpl-textarea" rows="3" [(ngModel)]="artistNotesVal"
                      placeholder="What did you create, learn, or refine?"></textarea>
          </div>

        </ng-container>

        <!-- ── GENERIC / HYDRATION TEMPLATE ── -->
        <ng-container *ngIf="templateType() === 'generic'">

          <div class="tpl-section">
            <div class="tpl-label">What did you do?</div>
            <input class="tpl-input" type="text" [(ngModel)]="genericActivityVal"
                   placeholder="Brief description...">
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Notes</div>
            <textarea class="tpl-textarea" rows="3" [(ngModel)]="genericNotesVal"
                      placeholder="Details, metrics, observations..."></textarea>
          </div>

        </ng-container>

        <!-- ── CARDIO TEMPLATE (swim, run, bike) ── -->
        <ng-container *ngIf="templateType() === 'cardio'">

          <div class="tpl-section">
            <div class="tpl-label">Activity</div>
            <div class="check-row" *ngFor="let mode of cardioModes; let i = index">
              <input type="radio" [id]="'cm-'+i" name="cardioMode"
                     [value]="mode" [(ngModel)]="cardioModeVal">
              <label [for]="'cm-'+i">{{ mode }}</label>
            </div>
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Distance / Laps</div>
            <input class="tpl-input" type="text" [(ngModel)]="cardioDistanceVal"
                   placeholder="e.g. 1500m, 30 laps, 3 miles...">
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Effort</div>
            <div class="phase-tabs">
              <button *ngFor="let e of cardioEfforts" class="phase-tab"
                      [class.active]="cardioEffortVal === e"
                      type="button" (click)="cardioEffortVal = e">{{ e }}</button>
            </div>
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Notes</div>
            <textarea class="tpl-textarea" rows="3" [(ngModel)]="cardioNotesVal"
                      placeholder="Conditions, how you felt, PRs..."></textarea>
          </div>

        </ng-container>

        <!-- ── MMA TEMPLATE (martial arts training) ── -->
        <ng-container *ngIf="templateType() === 'mma'">

          <div class="tpl-section">
            <div class="tpl-label">Training Type</div>
            <div class="check-row" *ngFor="let mode of mmaModes; let i = index">
              <input type="radio" [id]="'mma-'+i" name="mmaMode"
                     [value]="mode" [(ngModel)]="mmaModeVal">
              <label [for]="'mma-'+i">{{ mode }}</label>
            </div>
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Focus Area</div>
            <div class="phase-tabs">
              <button *ngFor="let f of mmaFocusAreas" class="phase-tab"
                      [class.active]="mmaFocusVal === f"
                      type="button" (click)="mmaFocusVal = f">{{ f }}</button>
            </div>
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Rounds</div>
            <input class="tpl-input" type="text" [(ngModel)]="mmaRoundsVal"
                   placeholder="e.g. 5x3min, 6 rounds, 45min drilling...">
          </div>

          <div class="tpl-section">
            <div class="tpl-label">Notes</div>
            <textarea class="tpl-textarea" rows="3" [(ngModel)]="mmaNotesVal"
                      placeholder="Techniques drilled, what clicked, coach feedback..."></textarea>
          </div>

        </ng-container>

      </div><!-- /panel-body -->

      <!-- ══ Panel Footer ══ -->
      <div class="panel-footer">
        <div class="complete-status" *ngIf="completeStatus()">{{ completeStatus() }}</div>
        <div class="footer-btns">
          <button class="btn-complete" (click)="onComplete()" [disabled]="isSubmitting()">
            {{ isSubmitting() ? 'Saving...' : '✓ Complete' }}
          </button>
          <button class="btn-cancel" (click)="onCancel()">✕ Cancel</button>
        </div>
      </div>

    </div><!-- /session-panel -->
  `,
  styles: [`
    /* ── Panel Shell ── */
    .session-panel {
      position: fixed;
      right: 0;
      top: 68px;
      bottom: 82px;
      width: 360px;
      display: flex;
      flex-direction: column;
      background: var(--eso-bg-panel, #120e07);
      border-left: 2px solid var(--eso-border, rgba(155,115,38,0.60));
      box-shadow: -6px 0 32px rgba(0,0,0,0.75), -1px 0 0 rgba(201,168,76,0.06);
      transform: translateX(100%);
      transition: transform 0.30s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 90;
      overflow: hidden;

      &.panel-open {
        transform: translateX(0);
      }
    }

    /* ── Header ── */
    .panel-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: var(--eso-bg-deep, #060402);
      border-bottom: 1px solid var(--eso-border, rgba(155,115,38,0.55));
      flex-shrink: 0;
    }

    .panel-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }

    .panel-activity-icon {
      font-size: 20px;
      flex-shrink: 0;
    }

    .panel-activity-name {
      font-family: 'Cinzel', serif;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1.8px;
      text-transform: uppercase;
      color: var(--eso-gold, #c9a84c);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .panel-timer {
      font-family: 'Cinzel', serif;
      font-size: 18px;
      font-weight: 700;
      color: var(--eso-gold-bright, #f2c96a);
      letter-spacing: 2px;
      text-shadow: 0 0 14px rgba(201,168,76,0.55);
      flex-shrink: 0;
    }

    .panel-close {
      background: none;
      border: 1px solid rgba(110,82,28,0.40);
      color: rgba(160,136,88,0.65);
      width: 26px;
      height: 26px;
      cursor: pointer;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: border-color 0.15s, color 0.15s;

      &:hover {
        border-color: rgba(180,60,60,0.60);
        color: rgba(200,80,80,0.90);
      }
    }

    /* ── Body ── */
    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 0;

      &::-webkit-scrollbar { width: 4px; }
      &::-webkit-scrollbar-track { background: rgba(0,0,0,0.30); }
      &::-webkit-scrollbar-thumb { background: rgba(110,82,28,0.45); }
    }

    /* ── Template Sections ── */
    .tpl-section {
      margin-bottom: 14px;
    }

    .tpl-label {
      font-family: 'Cinzel', serif;
      font-size: 9px;
      letter-spacing: 1.8px;
      text-transform: uppercase;
      color: var(--eso-gold-mid, #9a7830);
      margin-bottom: 6px;
    }

    .tpl-input {
      width: 100%;
      padding: 7px 9px;
      background: rgba(0,0,0,0.45);
      border: 1px solid rgba(110,82,28,0.40);
      color: var(--eso-text, #e2cfa8);
      font-family: 'Open Sans', sans-serif;
      font-size: 12px;
      box-sizing: border-box;
      transition: border-color 0.15s;

      &:focus {
        outline: none;
        border-color: rgba(155,115,38,0.85);
      }
    }

    .tpl-input-sm {
      margin-bottom: 5px;
    }

    .tpl-textarea {
      width: 100%;
      padding: 7px 9px;
      background: rgba(0,0,0,0.45);
      border: 1px solid rgba(110,82,28,0.40);
      color: var(--eso-text, #e2cfa8);
      font-family: 'Open Sans', sans-serif;
      font-size: 12px;
      box-sizing: border-box;
      resize: vertical;
      min-height: 70px;
      transition: border-color 0.15s;

      &:focus {
        outline: none;
        border-color: rgba(155,115,38,0.85);
      }
    }

    /* ── Workout Specific ── */
    .tpl-week-badge {
      display: inline-block;
      padding: 3px 10px;
      background: rgba(201,168,76,0.10);
      border: 1px solid rgba(201,168,76,0.35);
      color: var(--eso-gold, #c9a84c);
      font-family: 'Cinzel', serif;
      font-size: 9px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .tpl-day-tabs {
      display: flex;
      gap: 3px;
    }

    .day-tab, .phase-tab {
      flex: 1;
      padding: 5px 4px;
      font-family: 'Cinzel', serif;
      font-size: 7.5px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      background: rgba(0,0,0,0.40);
      border: 1px solid rgba(110,82,28,0.40);
      color: rgba(160,136,88,0.70);
      cursor: pointer;
      transition: all 0.15s;

      &:hover { border-color: rgba(155,115,38,0.70); color: var(--eso-text, #e2cfa8); }

      &.active {
        background: rgba(201,168,76,0.14);
        border-color: var(--eso-gold, #c9a84c);
        color: var(--eso-gold-bright, #f2c96a);
        box-shadow: inset 0 0 6px rgba(201,168,76,0.15);
      }
    }

    .phase-tabs {
      display: flex;
      gap: 4px;
    }

    /* ── Sets Table ── */
    .sets-table {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .sets-head {
      display: grid;
      grid-template-columns: 28px 1fr 1fr 28px 50px;
      gap: 4px;
      padding: 0 4px;
      font-family: 'Cinzel', serif;
      font-size: 8px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: rgba(110,88,40,0.75);
    }

    .set-row {
      display: grid;
      grid-template-columns: 28px 1fr 1fr 28px 50px;
      gap: 4px;
      align-items: center;
      padding: 4px;
      background: rgba(0,0,0,0.30);
      border: 1px solid rgba(80,58,18,0.30);
      transition: background 0.15s, border-color 0.15s;

      &.set-done {
        background: rgba(40,80,40,0.18);
        border-color: rgba(40,120,40,0.35);
      }

      &.set-resting {
        background: rgba(20,40,80,0.22);
        border-color: rgba(40,80,180,0.45);
      }
    }

    .set-num {
      font-family: 'Cinzel', serif;
      font-size: 11px;
      color: rgba(160,136,88,0.65);
      text-align: center;
    }

    .set-input {
      width: 100%;
      padding: 4px 5px;
      background: rgba(0,0,0,0.50);
      border: 1px solid rgba(80,58,18,0.35);
      color: var(--eso-text-bright, #fff8e8);
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      transition: border-color 0.15s;

      &:focus { outline: none; border-color: rgba(155,115,38,0.80); }
      /* hide number spinners */
      &::-webkit-outer-spin-button,
      &::-webkit-inner-spin-button { -webkit-appearance: none; }
      -moz-appearance: textfield;
    }

    .rest-btn {
      width: 100%;
      padding: 4px 2px;
      font-family: 'Cinzel', serif;
      font-size: 9px;
      background: rgba(20,35,70,0.60);
      border: 1px solid rgba(40,80,170,0.45);
      color: rgba(100,140,220,0.85);
      cursor: pointer;
      transition: all 0.15s;
      text-align: center;

      &:hover { border-color: rgba(60,110,220,0.70); color: #a0b8f0; }

      &.rest-active {
        background: rgba(20,50,130,0.70);
        border-color: rgba(80,130,255,0.80);
        color: #c0d8ff;
      }
    }

    .rest-urgent { color: #ff8080 !important; animation: urgent-pulse 0.5s ease-in-out infinite; }

    @keyframes urgent-pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.5; }
    }

    /* ── Checkboxes ── */
    .check-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;

      input[type=checkbox] { flex-shrink: 0; accent-color: var(--eso-gold, #c9a84c); cursor: pointer; }

      label {
        font-size: 11px;
        color: var(--eso-text-dim, #a08858);
        cursor: pointer;
        transition: color 0.15s;

        &.done { color: rgba(60,160,60,0.75); text-decoration: line-through; }
      }
    }

    .check-input-inline {
      flex: 1;
      padding: 3px 7px;
      background: rgba(0,0,0,0.40);
      border: 1px solid rgba(80,58,18,0.35);
      color: var(--eso-text, #e2cfa8);
      font-size: 11px;

      &:focus { outline: none; border-color: rgba(155,115,38,0.80); }
    }

    .tpl-add-btn {
      margin-top: 5px;
      background: none;
      border: 1px dashed rgba(110,82,28,0.40);
      color: rgba(160,136,88,0.65);
      padding: 4px 10px;
      font-family: 'Cinzel', serif;
      font-size: 9px;
      letter-spacing: 0.8px;
      cursor: pointer;
      transition: all 0.15s;

      &:hover { border-color: rgba(155,115,38,0.70); color: var(--eso-gold, #c9a84c); }
    }

    /* ── RedTeam Phase Track ── */
    .phase-track {
      display: flex;
      gap: 3px;
      flex-wrap: wrap;
    }

    .phase-btn {
      padding: 4px 8px;
      font-family: 'Cinzel', serif;
      font-size: 8px;
      letter-spacing: 0.6px;
      background: rgba(0,0,0,0.40);
      border: 1px solid rgba(80,58,18,0.40);
      color: rgba(160,136,88,0.65);
      cursor: pointer;
      transition: all 0.15s;

      &:hover { border-color: rgba(155,115,38,0.60); color: var(--eso-text, #e2cfa8); }

      &.active {
        background: rgba(180,50,50,0.18);
        border-color: rgba(180,60,60,0.70);
        color: #e08080;
      }
    }

    /* ── Platform radio ── */
    .tpl-radio-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .radio-opt {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border: 1px solid rgba(80,58,18,0.35);
      color: rgba(160,136,88,0.65);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;

      input[type=radio] { display: none; }

      &.active {
        border-color: rgba(155,115,38,0.75);
        color: var(--eso-gold, #c9a84c);
        background: rgba(201,168,76,0.08);
      }
    }

    /* ── Flag row ── */
    .flag-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;

      input[type=checkbox] { accent-color: rgba(60,180,60,0.90); }
      label { font-size: 11px; color: var(--eso-text-dim, #a08858); }
    }

    /* ── Footer ── */
    .panel-footer {
      flex-shrink: 0;
      padding: 10px 14px;
      border-top: 1px solid var(--eso-border, rgba(155,115,38,0.55));
      background: var(--eso-bg-deep, #060402);
    }

    .complete-status {
      font-size: 11px;
      color: var(--eso-gold, #c9a84c);
      text-align: center;
      padding: 4px 0 8px;
      font-family: 'Cinzel', serif;
      letter-spacing: 0.5px;
    }

    .footer-btns {
      display: flex;
      gap: 8px;
    }

    .btn-complete {
      flex: 2;
      padding: 9px 12px;
      background: rgba(40,80,40,0.50);
      border: 1px solid rgba(60,150,60,0.65);
      color: rgba(100,220,100,0.90);
      font-family: 'Cinzel', serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.15s;

      &:hover:not(:disabled) {
        background: rgba(40,100,40,0.65);
        border-color: rgba(80,200,80,0.80);
        box-shadow: 0 0 12px rgba(60,180,60,0.25);
      }

      &:disabled { opacity: 0.45; cursor: not-allowed; }
    }

    .btn-cancel {
      flex: 1;
      padding: 9px 10px;
      background: rgba(60,20,20,0.40);
      border: 1px solid rgba(120,40,40,0.55);
      color: rgba(180,80,80,0.80);
      font-family: 'Cinzel', serif;
      font-size: 10px;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.15s;

      &:hover {
        background: rgba(80,25,25,0.55);
        border-color: rgba(160,60,60,0.75);
      }
    }
  `]
})
export class ActivitySessionPanelComponent implements OnDestroy {

  protected readonly actionTracker = inject(ActionTrackerService);
  private readonly http = inject(HttpClient);

  readonly currentAction = toSignal(
    this.actionTracker.getCurrentAction(),
    { initialValue: null }
  );

  readonly isOpen = computed(() => !!this.currentAction());

  readonly templateType = computed(() => {
    const key = this.currentAction()?.activityKey ?? '';
    if (key === 'workout-mma')      return 'mma';
    if (key === 'workout-cardio')   return 'cardio';
    if (key.startsWith('workout'))  return 'workout';
    if (key === 'prayer-routine')   return 'prayer';
    if (key === 'htb-medium' || key.startsWith('redteam')) return 'redteam';
    if (key === 'coding-routine' || key === 'deep-focus' || key === 'dev-story') return 'coding';
    if (key.startsWith('art'))      return 'artist';
    return 'generic';
  });

  // ── UI state ──────────────────────────────────────────────
  readonly completeStatus = signal('');
  readonly isSubmitting   = signal(false);

  // ── Rest timer ────────────────────────────────────────────
  readonly restCountdown  = signal(0);
  readonly activeRestSet  = signal<number | null>(null);
  private restTimerRef: ReturnType<typeof setInterval> | null = null;

  // ── Workout state ─────────────────────────────────────────
  readonly workoutDay     = signal<WorkoutDay>(detectWorkoutDay());
  readonly warmupChecks   = signal<boolean[]>([false, false, false, false, false]);
  readonly sets           = signal<SetRow[]>([]);
  readonly accessoryChecks = signal<boolean[]>([false, false, false, false, false]);
  workoutNotesVal = '';

  readonly warmupItems    = WARMUP_ITEMS;
  readonly accessoryItems = computed(() => ACCESSORY_BY_DAY[this.workoutDay()] ?? []);
  readonly mainLiftLabel  = computed(() => {
    const d = this.workoutDay();
    if (d === 'squat')    return 'Back Squat';
    if (d === 'bench')    return 'Bench Press';
    if (d === 'deadlift') return 'Conventional Deadlift';
    return 'Main Lift';
  });

  get phaseLabel(): string {
    return getPhaseInfo(getCurrentProgramWeek()).label;
  }

  // ── Coding state ──────────────────────────────────────────
  storyIdVal   = '';
  taskDescVal  = '';
  readonly codingSubtasks = signal<{ label: string; done: boolean }[]>([
    { label: '', done: false },
    { label: '', done: false },
    { label: '', done: false },
  ]);
  codingNotesVal = '';

  // ── RedTeam state ─────────────────────────────────────────
  readonly rtPlatforms: RTPlatform[] = ['HTB', 'PortSwigger', 'TryHackMe', 'Other'];
  readonly rtPhases: RedTeamPhase[]  = ['Recon', 'Initial Access', 'Exploitation', 'Post-Exploit', 'Report'];
  rtPlatformVal:  RTPlatform  = 'HTB';
  rtTargetVal     = '';
  rtPhaseVal: RedTeamPhase = 'Recon';
  rtFlagFoundVal  = false;
  rtFlagVal       = '';
  rtNotesVal      = '';

  // ── Prayer state ──────────────────────────────────────────
  prayerScriptureVal  = '';
  prayerGratitudeVals = ['', '', ''];
  prayerReflectionVal = '';

  // ── Artist / Generic state ────────────────────────────────
  artistActivityVal = '';
  artistNotesVal    = '';
  genericActivityVal = '';
  genericNotesVal    = '';

  // ── Cardio state ──────────────────────────────────────
  readonly mmaModes       = ['Technical Drilling', 'Shadow Boxing', 'Pad Work', 'Sparring', 'Competition'];
  readonly mmaFocusAreas  = ['Standup', 'Clinch', 'Ground'];
  mmaModeVal              = 'Technical Drilling';
  mmaFocusVal             = 'Standup';
  mmaRoundsVal            = '';
  mmaNotesVal             = '';

  readonly cardioModes    = ['Swim', 'Run', 'Bike', 'Walk', 'Other'];
  readonly cardioEfforts  = ['Easy', 'Moderate', 'Hard'];
  cardioModeVal           = 'Swim';
  cardioDistanceVal       = '';
  cardioEffortVal         = 'Moderate';
  cardioNotesVal          = '';

  // Track which action session has already been initialized to avoid re-init on every tick
  private initializedForAction: string | null = null;

  constructor() {
    // Initialize workout sets only when a NEW action session starts (not on every 1-second tick)
    effect(() => {
      const action = this.currentAction();
      const type = this.templateType();
      if (action && type === 'workout') {
        const sessionKey = `${action.activityKey}-${action.startTime.getTime()}`;
        if (this.initializedForAction !== sessionKey) {
          this.initializedForAction = sessionKey;
          const day = untracked(() => this.workoutDay());
          this.initWorkoutSets(day);
        }
      } else if (!action) {
        this.initializedForAction = null;
      }
    });
  }

  ngOnDestroy(): void {
    this.clearRestTimer();
  }

  // ── Workout methods ───────────────────────────────────────

  setDay(day: WorkoutDay): void {
    this.workoutDay.set(day);
    this.initWorkoutSets(day);
  }

  private initWorkoutSets(day: WorkoutDay): void {
    const phase   = getPhaseInfo(getCurrentProgramWeek());
    const weight  = suggestWeight(day);
    const newSets: SetRow[] = [];
    for (let i = 0; i < phase.sets; i++) {
      newSets.push({ weight, reps: phase.reps, done: false });
    }
    this.sets.set(newSets);
    this.warmupChecks.set(WARMUP_ITEMS.map(() => false));
    this.accessoryChecks.set(ACCESSORY_BY_DAY[day].map(() => false));
  }

  toggleWarmup(i: number): void {
    const arr = [...this.warmupChecks()];
    arr[i] = !arr[i];
    this.warmupChecks.set(arr);
  }

  toggleAccessory(i: number): void {
    const arr = [...this.accessoryChecks()];
    arr[i] = !arr[i];
    this.accessoryChecks.set(arr);
  }

  startRest(setIdx: number, seconds: number): void {
    this.clearRestTimer();
    this.activeRestSet.set(setIdx);
    this.restCountdown.set(seconds);
    this.restTimerRef = setInterval(() => {
      const next = this.restCountdown() - 1;
      if (next <= 0) {
        this.clearRestTimer();
        this.activeRestSet.set(null);
        this.restCountdown.set(0);
        // audible cue via Web Audio
        this.playRestEndBeep();
      } else {
        this.restCountdown.set(next);
      }
    }, 1000);
  }

  private clearRestTimer(): void {
    if (this.restTimerRef !== null) {
      clearInterval(this.restTimerRef);
      this.restTimerRef = null;
    }
  }

  private playRestEndBeep(): void {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } catch {}
  }

  // ── Coding methods ────────────────────────────────────────

  toggleSubtask(i: number): void {
    const arr = [...this.codingSubtasks()];
    arr[i] = { ...arr[i], done: !arr[i].done };
    this.codingSubtasks.set(arr);
  }

  addSubtask(): void {
    this.codingSubtasks.set([...this.codingSubtasks(), { label: '', done: false }]);
  }

  // ── Icon helper ───────────────────────────────────────────

  getIcon(activityKey: string): string {
    const map: Record<string, string> = {
      'workout-strength': '⚔',
      'coding-routine':   '💻',
      'htb-medium':       '🛡',
      'prayer-routine':   '🙏',
      'art-drawing':      '🎨',
      'deep-focus':       '🧠',
      'hydration':        '💧',
      'daily-log':        '⚡',
    };
    return map[activityKey] ?? '◆';
  }

  // ── Complete / Cancel ─────────────────────────────────────

  onComplete(): void {
    const action = this.currentAction();
    if (!action || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    const notes      = this.buildNotes();
    const activityType = ACTIVITY_TYPE_MAP[action.activityKey] ?? 'personal-project';
    const durationMin  = Math.max(1, Math.round(action.duration / 60));

    this.http.post<{ xp?: number; xpAwards?: Array<{ class: string; xp: number }>; message?: string; error?: string }>(
      `${environment.apiUrl}/api/activities`,
      { activityType, duration: durationMin, notes }
    ).subscribe({
      next: (res) => {
        const xp = res.xp ?? '?';
        const multiLabel = res.xpAwards && res.xpAwards.length > 1
          ? ' [' + res.xpAwards.map(a => `${a.class} +${a.xp}`).join(', ') + ']'
          : '';
        this.completeStatus.set(`✓ +${xp} XP${multiLabel} — Journal updated`);
        this.clearRestTimer();
        setTimeout(() => {
          this.isSubmitting.set(false);
          this.actionTracker.completeAction();
          this.completeStatus.set('');
          this.resetTemplateState();
        }, 1400);
      },
      error: (err) => {
        const msg = err?.error?.message ?? 'Journal write failed';
        this.completeStatus.set(`⚠ ${msg} — recorded locally`);
        this.clearRestTimer();
        setTimeout(() => {
          this.isSubmitting.set(false);
          this.actionTracker.completeAction();
          this.completeStatus.set('');
          this.resetTemplateState();
        }, 2500);
      }
    });
  }

  onCancel(): void {
    this.clearRestTimer();
    this.actionTracker.cancelAction();
    this.resetTemplateState();
  }

  // ── Notes builder ─────────────────────────────────────────

  private buildNotes(): string {
    const t = this.templateType();

    if (t === 'workout') {
      const day     = this.workoutDay();
      const lift    = this.mainLiftLabel();
      const phase   = this.phaseLabel;
      const warmDone = this.warmupChecks().filter(Boolean).length;
      const setData  = this.sets()
        .map((s, i) => `Set${i+1} ${s.weight}lbs×${s.reps}${s.done ? '✓' : '—'}`)
        .join(' | ');
      const accDone  = this.accessoryChecks().filter(Boolean).length;
      const accTotal = this.accessoryChecks().length;
      const parts = [
        `${lift} (${phase})`,
        setData || 'no sets entered',
        `Warmup: ${warmDone}/${WARMUP_ITEMS.length}`,
        `Accessories: ${accDone}/${accTotal}`,
        `Day: ${day.charAt(0).toUpperCase() + day.slice(1)}`,
      ];
      if (this.workoutNotesVal.trim()) parts.push(this.workoutNotesVal.trim());
      return parts.join(' | ');
    }

    if (t === 'coding') {
      const subtasksDone = this.codingSubtasks().filter(s => s.done && s.label).length;
      const subtasksTotal = this.codingSubtasks().filter(s => s.label).length;
      const parts = [];
      if (this.storyIdVal.trim())   parts.push(this.storyIdVal.trim());
      if (this.taskDescVal.trim())  parts.push(this.taskDescVal.trim());
      if (subtasksTotal > 0)        parts.push(`Subtasks: ${subtasksDone}/${subtasksTotal}`);
      if (this.codingNotesVal.trim()) parts.push(this.codingNotesVal.trim());
      return parts.join(' | ') || 'Deep work session';
    }

    if (t === 'redteam') {
      const parts = [
        `${this.rtPlatformVal}: ${this.rtTargetVal || 'target'}`,
        `Phase: ${this.rtPhaseVal}`,
      ];
      if (this.rtFlagFoundVal) parts.push(`Flag: ${this.rtFlagVal || 'obtained'}`);
      if (this.rtNotesVal.trim()) parts.push(this.rtNotesVal.trim());
      return parts.join(' | ');
    }

    if (t === 'prayer') {
      const parts = [];
      if (this.prayerScriptureVal.trim()) parts.push(`Scripture: ${this.prayerScriptureVal.trim()}`);
      const grateItems = this.prayerGratitudeVals.filter(g => g.trim());
      if (grateItems.length) parts.push(`Gratitude: ${grateItems.join(', ')}`);
      if (this.prayerReflectionVal.trim()) parts.push(this.prayerReflectionVal.trim());
      return parts.join(' | ') || 'Morning prayer';
    }

    if (t === 'mma') {
      const parts = [
        this.mmaModeVal,
        `Focus: ${this.mmaFocusVal}`,
      ];
      if (this.mmaRoundsVal.trim()) parts.push(`Rounds: ${this.mmaRoundsVal.trim()}`);
      if (this.mmaNotesVal.trim())  parts.push(this.mmaNotesVal.trim());
      return parts.join(' | ');
    }

    if (t === 'cardio') {
      const parts = [
        `${this.cardioModeVal}`,
        this.cardioDistanceVal.trim() ? `Distance: ${this.cardioDistanceVal.trim()}` : null,
        `Effort: ${this.cardioEffortVal}`,
      ].filter(Boolean) as string[];
      if (this.cardioNotesVal.trim()) parts.push(this.cardioNotesVal.trim());
      return parts.join(' | ');
    }

    if (t === 'artist') {
      const parts = [];
      if (this.artistActivityVal.trim()) parts.push(this.artistActivityVal.trim());
      if (this.artistNotesVal.trim())    parts.push(this.artistNotesVal.trim());
      return parts.join(' | ') || 'Art session';
    }

    // generic
    const parts = [];
    if (this.genericActivityVal.trim()) parts.push(this.genericActivityVal.trim());
    if (this.genericNotesVal.trim())     parts.push(this.genericNotesVal.trim());
    return parts.join(' | ') || 'Session completed';
  }

  private resetTemplateState(): void {
    this.workoutNotesVal    = '';
    this.storyIdVal         = '';
    this.taskDescVal        = '';
    this.codingSubtasks.set([{ label:'', done:false }, { label:'', done:false }, { label:'', done:false }]);
    this.codingNotesVal     = '';
    this.rtPlatformVal      = 'HTB';
    this.rtTargetVal        = '';
    this.rtPhaseVal         = 'Recon';
    this.rtFlagFoundVal     = false;
    this.rtFlagVal          = '';
    this.rtNotesVal         = '';
    this.prayerScriptureVal = '';
    this.prayerGratitudeVals = ['', '', ''];
    this.prayerReflectionVal = '';
    this.artistActivityVal  = '';
    this.artistNotesVal     = '';
    this.genericActivityVal = '';
    this.genericNotesVal    = '';
    this.cardioModeVal      = 'Swim';
    this.cardioDistanceVal  = '';
    this.cardioEffortVal    = 'Moderate';
    this.cardioNotesVal     = '';
    this.mmaModeVal         = 'Technical Drilling';
    this.mmaFocusVal        = 'Standup';
    this.mmaRoundsVal       = '';
    this.mmaNotesVal        = '';
  }
}
