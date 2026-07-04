import { Component, Input, OnChanges, OnInit, OnDestroy, signal, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { VitalsData } from './sleep-panel.component';
import { environment } from '../environments/environment';

export interface FoodEntry {
  name: string;
  brand?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  amount: number;
  unit: string;
  mealType: string;
  logId: number;
}

export interface FoodLog {
  entries: FoodEntry[];
  totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number; water: number };
  goalCalories: number;
}

@Component({
  selector: 'app-food-log-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="food-panel">

      <!-- ── Daily Macros Summary ── -->
      <section class="eso-panel macro-card" *ngIf="food; else noFood">
        <div class="panel-header">
          <h3 class="eso-panel-title">🍖 Nutrition — Today</h3>
          <span class="entry-count">{{ food.entries.length }} item{{ food.entries.length !== 1 ? 's' : '' }}</span>
        </div>

        <!-- Calorie progress bar -->
        <div class="calorie-section">
          <div class="calorie-row">
            <span class="calorie-val" [ngClass]="calorieClass()">{{ food.totals.calories | number:'1.0-0' }}</span>
            <span class="calorie-sep"> / </span>
            <span class="calorie-goal">{{ food.goalCalories || '—' }} kcal</span>
            <span class="calorie-remain" *ngIf="food.goalCalories">
              &nbsp;· {{ remaining() > 0 ? (remaining() | number:'1.0-0') + ' left' : 'goal reached' }}
            </span>
          </div>
          <div class="eso-bar-track" *ngIf="food.goalCalories">
            <div class="eso-bar-fill calorie-bar"
                 [style.width.%]="caloriePercent()"
                 [ngClass]="calorieBarClass()"></div>
          </div>
        </div>

        <!-- Macro breakdown row -->
        <div class="macro-grid">
          <div class="macro-tile macro-protein">
            <span class="macro-val">{{ food.totals.protein | number:'1.0-0' }}g</span>
            <span class="macro-label">Protein</span>
          </div>
          <div class="macro-tile macro-carbs">
            <span class="macro-val">{{ food.totals.carbs | number:'1.0-0' }}g</span>
            <span class="macro-label">Carbs</span>
          </div>
          <div class="macro-tile macro-fat">
            <span class="macro-val">{{ food.totals.fat | number:'1.0-0' }}g</span>
            <span class="macro-label">Fat</span>
          </div>
          <div class="macro-tile macro-fiber">
            <span class="macro-val">{{ food.totals.fiber | number:'1.0-0' }}g</span>
            <span class="macro-label">Fiber</span>
          </div>
        </div>

        <!-- Macro stacked bar -->
        <div class="macro-bar-track" *ngIf="food.totals.calories > 0">
          <div class="macro-bar-seg seg-protein"
               [style.width.%]="proteinCalPct()"></div>
          <div class="macro-bar-seg seg-carbs"
               [style.width.%]="carbsCalPct()"></div>
          <div class="macro-bar-seg seg-fat"
               [style.width.%]="fatCalPct()"></div>
        </div>
        <div class="macro-bar-legend">
          <span class="legend-dot dot-protein"></span><span>Protein</span>
          <span class="legend-dot dot-carbs"></span><span>Carbs</span>
          <span class="legend-dot dot-fat"></span><span>Fat</span>
        </div>

        <!-- Protein Goal (from Fitbit weight) -->
        <div class="protein-goal-row" *ngIf="proteinGoal() !== null">
          <div class="pgr-labels">
            <span class="pgr-title">Protein Goal</span>
            <span class="pgr-sub">{{vitals!.weight}}lbs × 0.64</span>
            <span class="pgr-ratio">{{ food!.totals.protein | number:'1.0-0' }}g&nbsp;/&nbsp;{{ proteinGoal() }}g</span>
          </div>
          <div class="eso-bar-track pgr-bar-track">
            <div class="eso-bar-fill pgr-bar"
                 [style.width.%]="proteinPercent()"
                 [ngClass]="proteinGoalBarClass()"></div>
          </div>
        </div>

        <div class="eso-divider"></div>

        <!-- Meal groups -->
        <div class="meal-groups" *ngIf="food.entries.length > 0; else noEntries">
          <div *ngFor="let meal of mealGroups()" class="meal-group">
            <div class="meal-header">
              <span class="meal-name">{{ meal.mealType }}</span>
              <span class="meal-cals">{{ meal.totalCalories | number:'1.0-0' }} kcal · {{ meal.totalProtein | number:'1.0-0' }}g protein</span>
            </div>
            <div *ngFor="let item of meal.items" class="food-row">
              <div class="food-name-section">
                <span class="food-name">{{ item.name }}</span>
                <span class="food-brand" *ngIf="item.brand"> — {{ item.brand }}</span>
                <span class="food-amount"> · {{ item.amount }} {{ item.unit }}</span>
              </div>
              <div class="food-macros">
                <span class="food-cal">{{ item.calories }} kcal</span>
                <span class="food-prot">{{ item.protein }}g P</span>
                <span class="food-carb" *ngIf="item.carbs > 0">{{ item.carbs }}g C</span>
                <span class="food-fat" *ngIf="item.fat > 0">{{ item.fat }}g F</span>
              </div>
            </div>
          </div>
        </div>
        <ng-template #noEntries>
          <div class="empty-meals">No food logged yet today.</div>
        </ng-template>

        <div class="eso-divider"></div>

        <!-- Fasting Tracker -->
        <div class="fasting-section">
          <div class="fasting-hdr">⏱ Fasting Tracker</div>
          <div class="fasting-inputs">
            <div class="fasting-field">
              <label class="fasting-label">{{ prevMealLabel() }}</label>
              <input class="fasting-time" type="time"
                     [value]="prevLastMeal()" (change)="setPrevLastMeal($event)">
            </div>
            <div class="fasting-field fasting-field--days">
              <label class="fasting-label">Days ago</label>
              <div class="fasting-days-ctrl">
                <button class="fasting-days-btn" (click)="decDays()" [disabled]="fastExtraDays() === 0">−</button>
                <span class="fasting-days-val">{{ fastExtraDays() }}</span>
                <button class="fasting-days-btn" (click)="incDays()">+</button>
              </div>
            </div>
            <div class="fasting-arrow">→</div>
            <div class="fasting-field">
              <label class="fasting-label">Today's First Meal</label>
              <input class="fasting-time" type="time"
                     [value]="currFirstMeal()" (change)="setCurrFirstMeal($event)">
            </div>
          </div>
          <div class="fasting-result" *ngIf="fastingDuration() as fd">
            <span class="fasting-duration">{{ fd.total }}</span>
            <span class="fasting-tier" [ngClass]="fastingTierClass()">{{ fastingTier() }}</span>
          </div>
          <div class="fasting-empty" *ngIf="!fastingDuration()">
            Enter both timestamps to calculate fasting window
          </div>
        </div>

        <div class="eso-divider"></div>

        <!-- ── Food Notes ── -->
        <div class="food-notes-section">
          <div class="food-notes-hdr">
            <span>📝 Food Notes</span>
            <span class="food-notes-save"
                  [class.is-saving]="noteStatus() === 'saving'"
                  [class.is-saved]="noteStatus() === 'saved'">
              <ng-container *ngIf="noteStatus() === 'saving'">◌ saving...</ng-container>
              <ng-container *ngIf="noteStatus() === 'saved'">✓ saved</ng-container>
            </span>
          </div>
          <textarea
            class="food-notes-area"
            placeholder="Log meals, snacks, observations, diet quality notes..."
            [ngModel]="foodNotes()"
            (ngModelChange)="onNoteChange($event)">
          </textarea>

          <!-- Estimate Macros button -->
          <div class="estimate-row">
            <button class="estimate-btn"
                    [disabled]="!foodNotes().trim() || estimateLoading()"
                    (click)="estimateMacros()">
              <ng-container *ngIf="!estimateLoading()">📊 Estimate Macros from Notes</ng-container>
              <ng-container *ngIf="estimateLoading()">◌ Querying USDA...</ng-container>
            </button>
            <span class="estimate-note">via USDA FoodData Central</span>
          </div>

          <!-- Estimate results -->
          <div class="estimate-results" *ngIf="estimateItems().length > 0">
            <div class="estimate-results-hdr">
              🧪 Estimated (Notes Only)
              <button class="estimate-clear" (click)="clearEstimate()">clear</button>
            </div>

            <!-- Per-item rows -->
            <div *ngFor="let item of estimateItems()" class="estimate-item"
                 [class.confidence-high]="item.confidence === 'high'"
                 [class.confidence-med]="item.confidence === 'medium'"
                 [class.confidence-low]="item.confidence === 'low'">
              <div class="ei-names">
                <span class="ei-query">{{ item.query }}</span>
                <span class="ei-match">{{ item.bestMatch }}</span>
                <span class="ei-conf" [class.conf-high]="item.confidence === 'high'"
                                       [class.conf-med]="item.confidence === 'medium'"
                                       [class.conf-low]="item.confidence === 'low'">
                  {{ item.confidence }}
                </span>
              </div>
              <div class="ei-macros">
                <span class="ei-cal">{{ item.calories }} kcal</span>
                <span class="ei-prot">{{ item.protein }}g P</span>
                <span class="ei-carb" *ngIf="item.carbs > 0">{{ item.carbs }}g C</span>
                <span class="ei-fat"  *ngIf="item.fat   > 0">{{ item.fat   }}g F</span>
              </div>
            </div>

            <!-- Estimated sub-total -->
            <div class="estimate-subtotal">
              <span class="est-label">Notes Est.</span>
              <div class="ei-macros">
                <span class="ei-cal">{{ estimatedTotals()?.calories }} kcal</span>
                <span class="ei-prot">{{ estimatedTotals()?.protein }}g P</span>
                <span class="ei-carb">{{ estimatedTotals()?.carbs }}g C</span>
                <span class="ei-fat">{{ estimatedTotals()?.fat }}g F</span>
              </div>
            </div>

            <!-- Combined total (Fitbit + Notes) -->
            <div class="estimate-combined" *ngIf="combinedTotals()">
              <span class="est-label combined-label">⊕ Combined (Fitbit + Notes)</span>
              <div class="ei-macros">
                <span class="ei-cal combined-val">{{ combinedTotals()?.calories }} kcal</span>
                <span class="ei-prot">{{ combinedTotals()?.protein }}g P</span>
                <span class="ei-carb">{{ combinedTotals()?.carbs }}g C</span>
                <span class="ei-fat">{{ combinedTotals()?.fat }}g F</span>
              </div>
            </div>

          </div>

          <!-- Error state -->
          <div class="estimate-error" *ngIf="estimateError()">⚠ {{ estimateError() }}</div>
        </div>

      </section>

      <!-- ── Empty State ── -->
      <ng-template #noFood>
        <section class="eso-panel macro-card">
          <h3 class="eso-panel-title">🍖 Nutrition — Today</h3>
          <div class="empty-meals">Fetching food log...</div>
        </section>
      </ng-template>

    </div>
  `,
  styles: [`
    .food-panel { display: flex; flex-direction: column; gap: 14px; }

    .macro-card {
      background: var(--eso-panel-bg, #1a1610);
      border: 1px solid var(--eso-border, #3d2f1a);
      border-radius: 6px;
      padding: 14px 16px;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .entry-count {
      font-size: 0.65rem;
      color: var(--eso-text-dim, #8a7a5a);
      background: rgba(201,168,76,0.12);
      border: 1px solid rgba(201,168,76,0.25);
      border-radius: 3px;
      padding: 1px 6px;
    }

    /* ── Calories ── */
    .calorie-section { margin-bottom: 10px; }
    .calorie-row {
      display: flex;
      align-items: baseline;
      gap: 2px;
      margin-bottom: 5px;
    }
    .calorie-val { font-size: 1.5rem; font-weight: 700; }
    .calorie-sep, .calorie-goal { color: var(--eso-text-dim, #8a7a5a); font-size: 0.85rem; }
    .calorie-remain { font-size: 0.7rem; color: var(--eso-text-dim, #8a7a5a); }
    .cal-low    { color: #6fcf97; }
    .cal-ok     { color: #c9a84c; }
    .cal-high   { color: #f2994a; }
    .cal-over   { color: #eb5757; }

    .calorie-bar { transition: width 0.5s ease; }
    .cal-bar-low     { background: linear-gradient(90deg, #6fcf97, #27ae60); }
    .cal-bar-ok      { background: linear-gradient(90deg, #c9a84c, #a07d2e); }
    .cal-bar-high    { background: linear-gradient(90deg, #f2994a, #d9531e); }
    .cal-bar-over    { background: linear-gradient(90deg, #eb5757, #c0392b); }

    /* ── Macro grid ── */
    .macro-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 10px;
    }
    .macro-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      border-radius: 4px;
      padding: 6px 4px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .macro-val   { font-size: 1rem; font-weight: 700; }
    .macro-label { font-size: 0.6rem; color: var(--eso-text-dim, #8a7a5a); margin-top: 1px; }
    .macro-protein .macro-val { color: #6fcf97; }
    .macro-carbs   .macro-val { color: #c9a84c; }
    .macro-fat     .macro-val { color: #f2994a; }
    .macro-fiber   .macro-val { color: #9b8ec4; }

    /* ── Stacked macro bar ── */
    .macro-bar-track {
      display: flex;
      height: 6px;
      border-radius: 3px;
      overflow: hidden;
      background: rgba(255,255,255,0.06);
      gap: 1px;
    }
    .macro-bar-seg { height: 100%; border-radius: 0; transition: width 0.5s ease; }
    .seg-protein { background: #6fcf97; }
    .seg-carbs   { background: #c9a84c; }
    .seg-fat     { background: #f2994a; }

    .macro-bar-legend {
      display: flex;
      gap: 10px;
      align-items: center;
      font-size: 0.6rem;
      color: var(--eso-text-dim, #8a7a5a);
      margin-top: 4px;
    }
    .legend-dot {
      display: inline-block;
      width: 7px; height: 7px;
      border-radius: 50%;
    }
    .dot-protein { background: #6fcf97; }
    .dot-carbs   { background: #c9a84c; }
    .dot-fat     { background: #f2994a; }

    /* ── Meal groups ── */
    .meal-groups { display: flex; flex-direction: column; gap: 12px; }

    .meal-group { display: flex; flex-direction: column; gap: 4px; }

    .meal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 3px;
      border-bottom: 1px solid rgba(201,168,76,0.2);
    }
    .meal-name {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--eso-gold, #c9a84c);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .meal-cals {
      font-size: 0.65rem;
      color: var(--eso-text-dim, #8a7a5a);
    }

    .food-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 6px;
      border-radius: 3px;
      gap: 8px;
    }
    .food-row:hover { background: rgba(255,255,255,0.04); }

    .food-name-section {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }
    .food-name   { font-size: 0.75rem; color: var(--eso-text, #e0d0b0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .food-brand  { font-size: 0.65rem; color: var(--eso-text-dim, #8a7a5a); }
    .food-amount { font-size: 0.65rem; color: var(--eso-text-dim, #8a7a5a); white-space: nowrap; }

    .food-macros {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
      align-items: center;
    }
    .food-cal  { font-size: 0.7rem; color: var(--eso-text, #e0d0b0); font-weight: 600; }
    .food-prot { font-size: 0.65rem; color: #6fcf97; }
    .food-carb { font-size: 0.65rem; color: #c9a84c; }
    .food-fat  { font-size: 0.65rem; color: #f2994a; }

    .empty-meals {
      font-size: 0.8rem;
      color: var(--eso-text-dim, #8a7a5a);
      text-align: center;
      padding: 20px 0;
    }

    /* ── Protein Goal ── */
    .protein-goal-row { margin-bottom: 10px; }
    .pgr-labels {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 4px;
    }
    .pgr-title  { font-size: 0.72rem; font-weight: 600; color: #6fcf97; }
    .pgr-sub    { font-size: 0.6rem; color: var(--eso-text-dim, #8a7a5a); flex: 1; }
    .pgr-ratio  { font-size: 0.65rem; color: var(--eso-text, #e0d0b0); font-weight: 600; }
    .pgr-bar-track { height: 6px; }
    .pgr-bar { transition: width 0.5s ease; }
    .pgr-bar-under  { background: linear-gradient(90deg, #4a9a6f, #27ae60); }
    .pgr-bar-hit    { background: linear-gradient(90deg, #6fcf97, #a8e6c4); }
    .pgr-bar-over   { background: linear-gradient(90deg, #c9a84c, #f2c96a); }

    /* ── Fasting Tracker ── */
    .fasting-section { padding-top: 4px; }
    .fasting-hdr {
      font-size: 0.7rem;
      font-weight: 700;
      color: var(--eso-gold, #c9a84c);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    .fasting-inputs {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .fasting-field {
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
      min-width: 120px;
    }
    .fasting-label {
      font-size: 0.6rem;
      color: var(--eso-text-dim, #8a7a5a);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .fasting-time {
      background: rgba(0,0,0,0.55);
      border: 1px solid rgba(201,168,76,0.30);
      color: var(--eso-text, #e0d0b0);
      font-size: 0.85rem;
      font-family: monospace;
      padding: 5px 8px;
      outline: none;
      width: 100%;
      box-sizing: border-box;
      color-scheme: dark;
    }
    .fasting-time:focus { border-color: rgba(201,168,76,0.65); }
    .fasting-field--days {
      flex: 0 0 auto;
      min-width: 80px;
      align-items: center;
    }
    .fasting-days-ctrl {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 32px;
    }
    .fasting-days-btn {
      background: rgba(201,168,76,0.12);
      border: 1px solid rgba(201,168,76,0.35);
      color: var(--eso-gold, #c9a84c);
      width: 24px;
      height: 24px;
      cursor: pointer;
      font-size: 1rem;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      flex-shrink: 0;
    }
    .fasting-days-btn:hover:not(:disabled) { background: rgba(201,168,76,0.25); }
    .fasting-days-btn:disabled { opacity: 0.35; cursor: default; }
    .fasting-days-val {
      font-size: 1rem;
      font-weight: 700;
      color: var(--eso-gold-bright, #f2c96a);
      font-family: monospace;
      min-width: 20px;
      text-align: center;
    }
    .fasting-arrow {
      font-size: 1.2rem;
      color: var(--eso-text-dim, #8a7a5a);
      padding-top: 18px;
      flex-shrink: 0;
    }
    .fasting-result {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .fasting-duration {
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--eso-gold-bright, #f2c96a);
      font-family: 'Cinzel', serif;
    }
    .fasting-tier {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      padding: 2px 8px;
      border: 1px solid currentColor;
      border-radius: 2px;
    }
    .fasting-empty {
      font-size: 0.75rem;
      color: var(--eso-text-dim, #8a7a5a);
      font-style: italic;
    }
    /* Fasting tier colors */
    .tier-eating   { color: #8a7a5a; }
    .tier-12       { color: #6fcf97; }
    .tier-14       { color: #c9a84c; }
    .tier-16       { color: #f2c96a; }
    .tier-omad     { color: #9b59b6; }
    .tier-extended { color: #e74c3c; }

    /* ── Food Notes ── */
    .food-notes-section { padding-top: 4px; }
    .food-notes-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.7rem;
      font-weight: 700;
      color: var(--eso-gold, #c9a84c);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .food-notes-save {
      font-size: 0.65rem;
      font-weight: 400;
      color: var(--eso-text-dim, #8a7a5a);
      letter-spacing: 0;
      transition: color 0.2s;
    }
    .food-notes-save.is-saving { color: #c9a84c; }
    .food-notes-save.is-saved  { color: #6fcf97; }
    .food-notes-area {
      width: 100%;
      min-height: 80px;
      background: rgba(0,0,0,0.45);
      border: 1px solid rgba(201,168,76,0.30);
      color: var(--eso-text, #e0d0b0);
      font-size: 0.8rem;
      font-family: inherit;
      line-height: 1.5;
      padding: 8px 10px;
      resize: vertical;
      outline: none;
      box-sizing: border-box;
      border-radius: 3px;
      transition: border-color 0.15s;
    }
    .food-notes-area:focus { border-color: rgba(201,168,76,0.65); }
    .food-notes-area::placeholder { color: rgba(138,122,90,0.6); font-style: italic; }

    /* ── Estimate button ── */
    .estimate-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
    }
    .estimate-btn {
      background: rgba(201,168,76,0.12);
      border: 1px solid rgba(201,168,76,0.40);
      color: var(--eso-gold, #c9a84c);
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding: 5px 12px;
      cursor: pointer;
      border-radius: 3px;
      transition: background 0.15s, border-color 0.15s;
      font-family: inherit;
    }
    .estimate-btn:hover:not(:disabled) { background: rgba(201,168,76,0.22); border-color: rgba(201,168,76,0.65); }
    .estimate-btn:disabled { opacity: 0.4; cursor: default; }
    .estimate-note { font-size: 0.58rem; color: rgba(138,122,90,0.7); font-style: italic; }

    /* ── Estimate results ── */
    .estimate-results {
      margin-top: 10px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(201,168,76,0.20);
      border-radius: 4px;
      overflow: hidden;
    }
    .estimate-results-hdr {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      font-size: 0.68rem;
      font-weight: 700;
      color: var(--eso-gold, #c9a84c);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      background: rgba(201,168,76,0.07);
      border-bottom: 1px solid rgba(201,168,76,0.15);
    }
    .estimate-clear {
      background: transparent;
      border: none;
      color: rgba(138,122,90,0.75);
      font-size: 0.65rem;
      cursor: pointer;
      padding: 0 4px;
      font-family: inherit;
    }
    .estimate-clear:hover { color: var(--eso-text, #e0d0b0); }

    .estimate-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 10px;
      gap: 8px;
      border-left: 2px solid transparent;
    }
    .confidence-high { border-left-color: #6fcf97; }
    .confidence-med  { border-left-color: #c9a84c; }
    .confidence-low  { border-left-color: #555; }
    .estimate-item:not(:last-child) { border-bottom: 1px solid rgba(255,255,255,0.04); }

    .ei-names { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
    .ei-query { font-size: 0.72rem; color: var(--eso-text, #e0d0b0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ei-match { font-size: 0.6rem; color: var(--eso-text-dim, #8a7a5a); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ei-conf  { font-size: 0.55rem; padding: 1px 4px; border-radius: 2px; display: inline-block; margin-top: 1px; }
    .conf-high { background: rgba(111,207,151,0.15); color: #6fcf97; }
    .conf-med  { background: rgba(201,168,76,0.15);  color: #c9a84c; }
    .conf-low  { background: rgba(100,100,100,0.2);  color: #888; }

    .ei-macros { display: flex; gap: 6px; flex-shrink: 0; align-items: center; }
    .ei-cal  { font-size: 0.7rem; color: var(--eso-text, #e0d0b0); font-weight: 600; }
    .ei-prot { font-size: 0.65rem; color: #6fcf97; }
    .ei-carb { font-size: 0.65rem; color: #c9a84c; }
    .ei-fat  { font-size: 0.65rem; color: #f2994a; }

    .estimate-subtotal, .estimate-combined {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: rgba(255,255,255,0.04);
      border-top: 1px solid rgba(201,168,76,0.15);
    }
    .est-label { font-size: 0.65rem; font-weight: 700; color: var(--eso-gold, #c9a84c); letter-spacing: 0.04em; }
    .combined-label { color: #7bc8f2; }
    .combined-val   { color: #7bc8f2 !important; }

    .estimate-error {
      margin-top: 8px;
      font-size: 0.72rem;
      color: #eb5757;
      padding: 4px 0;
    }

    .eso-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--eso-border, #3d2f1a), transparent);
      margin: 10px 0;
    }

    .eso-bar-track {
      width: 100%;
      height: 8px;
      background: rgba(255,255,255,0.06);
      border-radius: 4px;
      overflow: hidden;
    }
    .eso-bar-fill { height: 100%; border-radius: 4px; }
  `]
})
export class FoodLogPanelComponent implements OnChanges, OnInit, OnDestroy {
  @Input() food: FoodLog | null = null;
  @Input() vitals: VitalsData | null = null;

  private readonly http = inject(HttpClient);
  private fastingTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Food Notes ──────────────────────────────────────────────────────────
  foodNotes   = signal<string>('');
  noteStatus  = signal<'idle' | 'saving' | 'saved'>('idle');
  private noteQueue = new Subject<string>();
  private noteSub?: Subscription;
  private noteSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Persist fasting duration to journal whenever both times are set (800ms debounce)
    effect(() => {
      const fd = this.fastingDuration();
      if (!fd) return;
      if (this.fastingTimer) clearTimeout(this.fastingTimer);
      this.fastingTimer = setTimeout(() => this.saveFastingToJournal(fd.totalH), 800);
    });
  }

  ngOnInit(): void {
    // Load existing food notes from journal
    const date = new Date().toLocaleDateString('en-CA');
    this.http.get<any>(`${environment.apiUrl}/api/daily-metrics?date=${date}`).subscribe({
      next: (res) => {
        if (res?.metrics?.nutrition?.foodNotes) {
          this.foodNotes.set(res.metrics.nutrition.foodNotes);
        }
      },
      error: () => {} // journal entry may not exist yet — silently ignore
    });

    // Debounced save queue (same pattern as quests-panel)
    this.noteSub = this.noteQueue.pipe(debounceTime(700)).subscribe(value => {
      this.saveNote(value);
    });
  }

  // ── Fasting tracker ──────────────────────────────────────────────────────
  prevLastMeal  = signal<string>('');
  currFirstMeal = signal<string>('');
  fastExtraDays = signal<number>(0);

  prevMealLabel = computed<string>(() => {
    const d = this.fastExtraDays();
    if (d === 0) return "Yesterday's Last Meal";
    if (d === 1) return '2 Days Ago (Last Meal)';
    return `${d + 1} Days Ago (Last Meal)`;
  });

  /** Fasting duration: spans midnight + any extra full days for 24h+ fasts */
  fastingDuration = computed<{ hours: number; minutes: number; totalH: number; total: string } | null>(() => {
    const last  = this.prevLastMeal();
    const first = this.currFirstMeal();
    if (!last || !first) return null;

    const [lh, lm] = last.split(':').map(Number);
    const [fh, fm] = first.split(':').map(Number);
    if (isNaN(lh) || isNaN(fh)) return null;

    const lastMinutes  = lh * 60 + lm;
    const firstMinutes = fh * 60 + fm;
    const extraMins    = this.fastExtraDays() * 24 * 60;
    const diffMinutes  = extraMins + (24 * 60 - lastMinutes) + firstMinutes;
    if (diffMinutes <= 0) return null;

    const hours   = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    return { hours, minutes, totalH: diffMinutes / 60,
             total: minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h` };
  });

  ngOnChanges(): void {}

  ngOnDestroy(): void {
    if (this.fastingTimer) clearTimeout(this.fastingTimer);
    if (this.noteSaveTimer) clearTimeout(this.noteSaveTimer);
    this.noteSub?.unsubscribe();
  }

  // ── Macro Estimator ───────────────────────────────────────────────────
  estimateLoading  = signal(false);
  estimateItems    = signal<any[]>([]);
  estimatedTotals  = signal<any>(null);
  combinedTotals   = signal<any>(null);
  estimateError    = signal<string>('');

  estimateMacros(): void {
    const notes = this.foodNotes().trim();
    if (!notes) return;
    this.estimateLoading.set(true);
    this.estimateError.set('');
    this.estimateItems.set([]);
    this.estimatedTotals.set(null);
    this.combinedTotals.set(null);

    const fitbitTotals = this.food?.totals
      ? { calories: this.food.totals.calories, protein: this.food.totals.protein,
          carbs: this.food.totals.carbs, fat: this.food.totals.fat, fiber: this.food.totals.fiber }
      : null;

    this.http.post<any>(`${environment.apiUrl}/api/food-estimate`, { notes, fitbitTotals }).subscribe({
      next: (res) => {
        if (res.success) {
          this.estimateItems.set(res.items ?? []);
          this.estimatedTotals.set(res.estimatedTotals ?? null);
          this.combinedTotals.set(res.combinedTotals ?? null);
        } else {
          this.estimateError.set(res.error ?? 'Estimation failed');
        }
        this.estimateLoading.set(false);
      },
      error: (err) => {
        console.error('[food-log] Estimate error:', err);
        this.estimateError.set('Failed to reach estimation service');
        this.estimateLoading.set(false);
      }
    });
  }

  clearEstimate(): void {
    this.estimateItems.set([]);
    this.estimatedTotals.set(null);
    this.combinedTotals.set(null);
    this.estimateError.set('');
  }

  onNoteChange(value: string): void {
    this.foodNotes.set(value);
    this.noteStatus.set('saving');
    this.noteQueue.next(value);
  }

  private saveNote(value: string): void {
    // Suppress empty/placeholder saves
    if (!value.trim()) {
      this.noteStatus.set('idle');
      return;
    }
    const date = new Date().toLocaleDateString('en-CA');
    this.http.post<any>(`${environment.apiUrl}/api/daily-metrics`, {
      date,
      metrics: { nutrition: { foodNotes: value } }
    }).subscribe({
      next: () => {
        this.noteStatus.set('saved');
        if (this.noteSaveTimer) clearTimeout(this.noteSaveTimer);
        this.noteSaveTimer = setTimeout(() => this.noteStatus.set('idle'), 2000);
      },
      error: (err) => {
        console.error('[food-log] Failed to save food notes:', err);
        this.noteStatus.set('idle');
      }
    });
  }

  // ── Protein goal (Fitbit weight × 0.64) ──────────────────────────────────
  proteinGoal(): number | null {
    const w = this.vitals?.weight;
    if (!w || w <= 0) return null;
    return Math.round(w * 0.64);
  }

  proteinPercent(): number {
    const goal = this.proteinGoal();
    if (!goal || !this.food) return 0;
    return Math.min(Math.round((this.food.totals.protein / goal) * 100), 110);
  }

  proteinGoalBarClass(): string {
    const pct = this.proteinPercent();
    if (pct < 70)  return 'pgr-bar-under';
    if (pct <= 100) return 'pgr-bar-hit';
    return 'pgr-bar-over';
  }

  // ── Fasting helpers ──────────────────────────────────────────────────────
  fastingTier(): string {
    const fd = this.fastingDuration();
    if (!fd) return '';
    const h = fd.totalH;
    if (h < 12) return 'Eating Window';
    if (h < 14) return '12:12 Fast';
    if (h < 16) return '14:10 Fast';
    if (h < 18) return '16:8 Fast';
    if (h < 20) return 'OMAD Approach';
    return 'Extended Fast';
  }

  fastingTierClass(): string {
    const fd = this.fastingDuration();
    if (!fd) return '';
    const h = fd.totalH;
    if (h < 12) return 'tier-eating';
    if (h < 14) return 'tier-12';
    if (h < 16) return 'tier-14';
    if (h < 18) return 'tier-16';
    if (h < 20) return 'tier-omad';
    return 'tier-extended';
  }

  setPrevLastMeal(event: Event): void {
    this.prevLastMeal.set((event.target as HTMLInputElement).value);
  }

  setCurrFirstMeal(event: Event): void {
    this.currFirstMeal.set((event.target as HTMLInputElement).value);
  }

  private saveFastingToJournal(hours: number): void {
    const date = new Date().toLocaleDateString('en-CA');
    this.http.post(`${environment.apiUrl}/api/fasting`, { hours, date }).subscribe({
      next: () => console.log(`[food-log] Fasting saved: ${hours.toFixed(2)}h`),
      error: (err) => console.error('[food-log] Failed to save fasting duration:', err)
    });
  }

  incDays(): void { this.fastExtraDays.update(d => d + 1); }
  decDays(): void { this.fastExtraDays.update(d => Math.max(0, d - 1)); }

  remaining(): number {
    if (!this.food || !this.food.goalCalories) return 0;
    return Math.max(0, this.food.goalCalories - this.food.totals.calories);
  }

  caloriePercent(): number {
    if (!this.food?.goalCalories) return 0;
    return Math.min(Math.round((this.food.totals.calories / this.food.goalCalories) * 100), 110);
  }

  calorieClass(): string {
    const pct = this.caloriePercent();
    if (pct <= 60)  return 'cal-low';
    if (pct <= 90)  return 'cal-ok';
    if (pct <= 100) return 'cal-high';
    return 'cal-over';
  }

  calorieBarClass(): string {
    const pct = this.caloriePercent();
    if (pct <= 60)  return 'cal-bar-low';
    if (pct <= 90)  return 'cal-bar-ok';
    if (pct <= 100) return 'cal-bar-high';
    return 'cal-bar-over';
  }

  /** % of total calories from protein (4 kcal/g) */
  proteinCalPct(): number {
    if (!this.food?.totals.calories) return 0;
    return Math.round(((this.food.totals.protein * 4) / this.food.totals.calories) * 100);
  }

  /** % of total calories from carbs (4 kcal/g) */
  carbsCalPct(): number {
    if (!this.food?.totals.calories) return 0;
    return Math.round(((this.food.totals.carbs * 4) / this.food.totals.calories) * 100);
  }

  /** % of total calories from fat (9 kcal/g) */
  fatCalPct(): number {
    if (!this.food?.totals.calories) return 0;
    return Math.round(((this.food.totals.fat * 9) / this.food.totals.calories) * 100);
  }

  mealGroups(): { mealType: string; items: FoodEntry[]; totalCalories: number; totalProtein: number }[] {
    if (!this.food?.entries.length) return [];

    const MEAL_ORDER = ['Breakfast', 'Morning Snack', 'Lunch', 'Afternoon Snack', 'Dinner', 'Evening Snack', 'Anytime'];
    const map = new Map<string, FoodEntry[]>();

    for (const entry of this.food.entries) {
      const list = map.get(entry.mealType) ?? [];
      list.push(entry);
      map.set(entry.mealType, list);
    }

    return [...map.entries()]
      .sort(([a], [b]) => {
        const ai = MEAL_ORDER.indexOf(a);
        const bi = MEAL_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
      .map(([mealType, items]) => ({
        mealType,
        items,
        totalCalories: items.reduce((s, i) => s + i.calories, 0),
        totalProtein:  items.reduce((s, i) => s + i.protein,  0),
      }));
  }
}
