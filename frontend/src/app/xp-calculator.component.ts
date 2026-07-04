import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { XpCalculationService, XPCalculation } from './xp-calculation.service';
import { ConsolidationService, ConsolidationResult } from './consolidation.service';
import { LevelProgressionService, SkillClass, LevelUpResult } from './level-progression.service';

/**
 * XP Calculator Component
 * Demo component to test XP calculation → consolidation → leveling workflow
 * Shows real-time XP calculations based on character-sheet.md formulas
 */
@Component({
  selector: 'app-xp-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="xp-calculator">
      <div class="calculator-header">
        <h2>⚔️ Digital Paladin XP Calculator</h2>
        <p class="subtitle">Test XP formulas from character-sheet.md</p>
      </div>

      <!-- Step 1: Activity Selection -->
      <div class="calculator-section">
        <h3>Step 1: Activity Details</h3>
        
        <div class="form-row">
          <label>Activity Type:</label>
          <select [(ngModel)]="selectedActivity" (change)="onActivityChange()">
            <option value="">-- Select Activity --</option>
            <optgroup label="Developer">
              <option value="coding-routine">Routine Coding (10/hr)</option>
              <option value="coding-complex">Complex Debugging (15/hr)</option>
              <option value="coding-architecture">Architecture Design (20/hr)</option>
              <option value="code-review-doing">Code Review - Doing (5/hr)</option>
              <option value="learning-tech">Learning New Tech (12/hr)</option>
            </optgroup>
            <optgroup label="Redteamer">
              <option value="htb-easy">HTB Easy Box (10/hr)</option>
              <option value="htb-medium">HTB Medium Box (15/hr)</option>
              <option value="htb-hard">HTB Hard Box (20/hr)</option>
              <option value="ctf-practice">CTF Practice (12/hr)</option>
              <option value="portswigger-labs">PortSwigger Labs (10/hr)</option>
            </optgroup>
            <optgroup label="Warrior">
              <option value="workout-strength">Strength Training (15/hr)</option>
              <option value="workout-cardio">Cardio (10/hr)</option>
              <option value="mma-class">MMA Class (20/hr)</option>
              <option value="swimming">Swimming (12/hr)</option>
            </optgroup>
            <optgroup label="Sage">
              <option value="prayer">Prayer/Meditation (5/hr)</option>
              <option value="bible-study">Bible Study (8/hr)</option>
            </optgroup>
          </select>
        </div>

        <div class="form-row">
          <label>Duration (hours):</label>
          <input type="number" [(ngModel)]="hours" step="0.25" min="0" max="12" 
                 placeholder="e.g., 2.5 for 2h 30min" />
        </div>

        <div class="form-row">
          <label>Intensity:</label>
          <select [(ngModel)]="intensity">
            <option value="routine">Routine (1.0x) - 70% of work</option>
            <option value="moderate">Moderate (1.35x) - 20% of work</option>
            <option value="complex">Complex (1.75x) - 10% of work</option>
          </select>
        </div>

        <div class="form-row">
          <label>Bonuses (optional):</label>
          <div class="bonus-checkboxes">
            <label *ngFor="let bonus of availableBonuses">
              <input type="checkbox" [value]="bonus.key" 
                     (change)="onBonusToggle(bonus.key, $event)" />
              {{ bonus.name }} (+{{ bonus.xp }} XP)
            </label>
          </div>
        </div>

        <button class="calculate-btn" (click)="calculatePendingXP()" 
                [disabled]="!selectedActivity || hours <= 0">
          Calculate Pending XP
        </button>
      </div>

      <!-- Step 2: Pending XP Result -->
      <div class="calculator-section" *ngIf="pendingXPResult">
        <h3>Step 2: Pending XP (Before Sleep)</h3>
        
        <div class="xp-result">
          <div class="xp-breakdown">
            <div class="breakdown-row">
              <span>Base XP:</span>
              <span>{{ hours }} hrs × {{ pendingXPResult.baseRate }}/hr × {{ pendingXPResult.intensityMultiplier }}x = 
                    {{ pendingXPResult.baseXP.toFixed(2) }} XP</span>
            </div>
            <div class="breakdown-row" *ngIf="pendingXPResult.bonuses.length > 0">
              <span>Bonuses:</span>
              <span>
                <div *ngFor="let bonus of pendingXPResult.bonuses">
                  {{ bonus.name }}: +{{ bonus.xp }} XP
                </div>
              </span>
            </div>
            <div class="breakdown-row total-row">
              <span>Pending XP:</span>
              <span class="xp-number">{{ pendingXPResult.pendingXP.toFixed(2) }} XP</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 3: Sleep Consolidation -->
      <div class="calculator-section" *ngIf="pendingXPResult">
        <h3>Step 3: Sleep Consolidation</h3>
        
        <div class="form-row">
          <label>Sleep Hours:</label>
          <input type="number" [(ngModel)]="sleepHours" step="0.25" min="0" max="12" 
                 placeholder="e.g., 6.25 for 6h 15min" />
        </div>

        <div class="form-row">
          <label>Nutrition Quality:</label>
          <select [(ngModel)]="nutritionType">
            <option value="clean">Clean (+5%): High protein, whole foods</option>
            <option value="mixed">Mixed (0%): Balanced with some treats</option>
            <option value="poor">Poor (-5%): Low protein, processed foods</option>
          </select>
        </div>

        <div class="form-row">
          <label>Hours After Last Meal:</label>
          <input type="number" [(ngModel)]="hoursAfterMeal" step="0.5" min="0" max="12" 
                 placeholder="e.g., 3 for fasted bedtime" />
        </div>

        <div class="form-row">
          <label>Skill Category:</label>
          <select [(ngModel)]="skillCategory">
            <option value="warrior">Warrior (single-day nutrition impact)</option>
            <option value="cognitive">Cognitive (3-day rolling nutrition)</option>
            <option value="sage">Sage (nutrition doesn't affect)</option>
          </select>
        </div>

        <button class="calculate-btn" (click)="calculateConsolidation()">
          Calculate Permanent XP
        </button>
      </div>

      <!-- Step 4: Permanent XP & Level Progress -->
      <div class="calculator-section" *ngIf="consolidationResult">
        <h3>Step 4: Permanent XP (After Sleep)</h3>
        
        <div class="xp-result">
          <div class="xp-breakdown">
            <div class="breakdown-row">
              <span>Sleep Quality:</span>
              <span>{{ (consolidationResult.baseSleepRate * 100).toFixed(1) }}%</span>
            </div>
            <div class="breakdown-row">
              <span>Nutrition Modifier:</span>
              <span>{{ consolidationResult.nutritionModifier >= 0 ? '+' : '' }}{{ (consolidationResult.nutritionModifier * 100).toFixed(1) }}%</span>
            </div>
            <div class="breakdown-row">
              <span>Fasting Modifier:</span>
              <span>{{ consolidationResult.fastingModifier >= 0 ? '+' : '' }}{{ (consolidationResult.fastingModifier * 100).toFixed(1) }}%</span>
            </div>
            <div class="breakdown-row total-row">
              <span>Total Consolidation Rate:</span>
              <span>{{ (consolidationResult.totalConsolidationRate * 100).toFixed(1) }}%</span>
            </div>
            <div class="breakdown-row permanent-xp-row">
              <span>Permanent XP:</span>
              <span class="xp-number large">{{ consolidationResult.permanentXP.toFixed(2) }} XP</span>
            </div>
          </div>

          <div class="consolidation-formula">
            <pre>{{ consolidationResult.breakdown }}</pre>
          </div>
        </div>

        <!-- Level Progress -->
        <div class="form-row" style="margin-top: 20px;">
          <label>Add to Skill Class:</label>
          <select [(ngModel)]="targetSkillClass">
            <option *ngFor="let cls of skillClasses" [value]="cls.id">
              {{ cls.icon }} {{ cls.name }} (Level {{ cls.currentLevel }})
            </option>
          </select>
        </div>

        <button class="calculate-btn level-up-btn" (click)="addToCharacter()">
          Add {{ consolidationResult.permanentXP.toFixed(2) }} XP to Character
        </button>
      </div>

      <!-- Level-Up Notification -->
      <div class="level-up-modal" *ngIf="levelUpResult">
        <div class="level-up-content">
          <h2>🎉 LEVEL UP!</h2>
          <p class="class-name">{{ levelUpResult.className }}</p>
          <p class="level-change">{{ levelUpResult.oldLevel }} → {{ levelUpResult.newLevel }}</p>
          <p class="tier-change" *ngIf="levelUpResult.tierChange">
            {{ levelUpResult.tierChange }}
          </p>
          <p class="overflow-xp" *ngIf="levelUpResult.overflowXP > 0">
            Overflow XP: {{ levelUpResult.overflowXP.toFixed(2) }}
          </p>
          <button (click)="levelUpResult = null">Continue</button>
        </div>
      </div>

      <!-- Character Progress Display -->
      <div class="calculator-section character-progress">
        <h3>Character Progress</h3>
        <div class="skill-classes-grid">
          <div class="skill-class-card" *ngFor="let cls of skillClasses">
            <div class="class-header">
              <span class="class-icon">{{ cls.icon }}</span>
              <span class="class-name">{{ cls.name }}</span>
            </div>
            <div class="class-level">Level {{ cls.currentLevel }}</div>
            <div class="class-tier">{{ cls.tier }}</div>
            <div class="xp-progress-bar">
              <div class="xp-progress-fill" 
                   [style.width.%]="cls.progressToNextLevel"></div>
            </div>
            <div class="xp-text">
              {{ cls.currentXP.toFixed(0) }} / {{ cls.xpForNextLevel }} XP
              ({{ cls.progressToNextLevel.toFixed(1) }}%)
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .xp-calculator {
      max-width: 900px;
      margin: 20px auto;
      padding: 20px;
      font-family: 'Open Sans', sans-serif;
      color: #e2cfa8;
      background: #0d0a06;
    }

    .calculator-header {
      text-align: center;
      margin-bottom: 24px;
      padding: 20px;
      background: linear-gradient(180deg, rgba(40,28,8,0.95) 0%, rgba(18,12,4,0.98) 100%);
      border: 1px solid rgba(155,115,38,0.65);
      position: relative;
    }
    .calculator-header::before { content: '◈'; position: absolute; top: -8px; left: -8px; color: #c9a84c; font-size: 12px; }
    .calculator-header::after  { content: '◈'; position: absolute; bottom: -8px; right: -8px; color: #c9a84c; font-size: 12px; }

    .calculator-header h2 {
      margin: 0;
      font-family: 'Cinzel', 'Palatino Linotype', serif;
      font-size: 22px;
      font-weight: 700;
      color: #f2c96a;
      letter-spacing: 2px;
      text-shadow: 0 0 18px rgba(201,168,76,0.3);
    }

    .subtitle {
      margin: 8px 0 0 0;
      color: #a08858;
      font-size: 10px;
      letter-spacing: 2px;
      text-transform: uppercase;
      font-family: 'Cinzel', serif;
    }

    .calculator-section {
      background: #120e07;
      border: 1px solid rgba(155,115,38,0.55);
      padding: 18px;
      margin-bottom: 16px;
      position: relative;
    }
    .calculator-section::before { content: '◈'; position: absolute; top: -8px; left: -8px; color: #c9a84c; font-size: 11px; pointer-events: none; }
    .calculator-section::after  { content: '◈'; position: absolute; bottom: -8px; right: -8px; color: #c9a84c; font-size: 11px; pointer-events: none; }

    .calculator-section h3 {
      margin: 0 0 14px 0;
      font-family: 'Cinzel', 'Palatino Linotype', serif;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      color: #c9a84c;
      border-bottom: 1px solid rgba(155,115,38,0.55);
      padding-bottom: 8px;
    }
    .calculator-section h3::before { content: '◆  '; font-size: 7px; vertical-align: 1px; }

    .form-row { margin-bottom: 13px; }
    .form-row label {
      display: block; margin-bottom: 4px;
      font-family: 'Cinzel', serif;
      font-size: 10px; font-weight: 600;
      color: #a08858; letter-spacing: 1.8px; text-transform: uppercase;
    }
    .form-row select,
    .form-row input {
      width: 100%; padding: 8px 10px;
      background: #090705;
      border: 1px solid rgba(110,82,28,0.40);
      color: #e2cfa8; font-size: 13px;
      font-family: 'Open Sans', sans-serif;
      border-radius: 0;
      transition: border-color 0.2s;
    }
    .form-row select:focus,
    .form-row input:focus {
      outline: none;
      border-color: rgba(155,115,38,0.90);
      box-shadow: 0 0 0 2px rgba(201,168,76,0.10);
    }
    .form-row select option  { background: #120e07; color: #e2cfa8; }

    .bonus-checkboxes { display: flex; flex-direction: column; gap: 6px; }
    .bonus-checkboxes label {
      display: flex; align-items: center; gap: 8px;
      color: #e2cfa8; cursor: pointer;
      font-family: 'Open Sans', sans-serif;
      font-size: 13px;
      text-transform: none; letter-spacing: 0;
    }

    .calculate-btn {
      width: 100%;
      padding: 11px;
      background: linear-gradient(180deg, rgba(55,38,10,0.92) 0%, rgba(20,14,4,0.96) 100%);
      border: 1px solid rgba(155,115,38,0.65);
      color: #c9a84c;
      font-family: 'Cinzel', 'Palatino Linotype', serif;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.2s;
      border-radius: 0;
    }
    .calculate-btn:hover:not(:disabled) {
      border-color: #c9a84c;
      color: #f2c96a;
      box-shadow: 0 0 16px rgba(201,168,76,0.22);
    }
    .calculate-btn:disabled { opacity: 0.38; cursor: not-allowed; }

    .level-up-btn {
      background: linear-gradient(180deg, rgba(12,45,12,0.92) 0%, rgba(5,20,5,0.96) 100%);
      border-color: rgba(40,130,40,0.65);
      color: #70c070;
    }
    .level-up-btn:hover:not(:disabled) {
      border-color: #40c040;
      color: #aaeeaa;
      box-shadow: 0 0 16px rgba(40,160,40,0.22);
    }

    .xp-result {
      background: rgba(0,0,0,0.35);
      border: 1px solid rgba(155,115,38,0.30);
      padding: 13px;
    }
    .xp-breakdown { display: flex; flex-direction: column; gap: 8px; }
    .breakdown-row {
      display: flex; justify-content: space-between;
      padding: 6px 8px;
      border-bottom: 1px solid rgba(110,82,28,0.18);
      font-size: 13px;
    }
    .total-row {
      border-top: 1px solid rgba(201,168,76,0.40);
      border-bottom: none; font-weight: 700; color: #c9a84c;
    }
    .permanent-xp-row {
      background: rgba(201,168,76,0.08);
      border: 1px solid rgba(201,168,76,0.35);
      font-size: 16px;
    }
    .xp-number { color: #f2c96a; font-weight: 700; }
    .xp-number.large { font-size: 18px; }
    .consolidation-formula {
      margin-top: 14px; padding: 12px;
      background: rgba(0,0,0,0.50);
      border: 1px solid rgba(80,58,18,0.30);
      font-size: 11px; line-height: 1.6;
    }
    .consolidation-formula pre { margin: 0; color: #88c888; white-space: pre-wrap; font-family: 'Courier New', monospace; }

    .level-up-modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.3s ease;
    }

    .level-up-content {
      background: linear-gradient(180deg, rgba(40,28,8,0.97) 0%, rgba(18,12,4,0.99) 100%);
      border: 1px solid rgba(201,168,76,0.8);
      padding: 40px;
      text-align: center;
      animation: scaleIn 0.3s ease;
      position: relative;
      box-shadow: 0 0 40px rgba(201,168,76,0.18);
    }
    .level-up-content::before { content: '◈'; position: absolute; top: -9px; left: -9px; color: #f2c96a; font-size: 14px; }
    .level-up-content::after  { content: '◈'; position: absolute; bottom: -9px; right: -9px; color: #f2c96a; font-size: 14px; }

    .level-up-content h2 {
      margin: 0;
      font-family: 'Cinzel', serif;
      font-size: 30px;
      color: #f2c96a;
      letter-spacing: 3px;
      text-shadow: 0 0 24px rgba(201,168,76,0.45);
    }

    .class-name {
      font-family: 'Cinzel', serif;
      font-size: 20px;
      color: #e2cfa8;
      margin: 10px 0;
      letter-spacing: 1.5px;
    }

    .level-change {
      font-family: 'Cinzel', serif;
      font-size: 28px;
      font-weight: 700;
      color: #f2c96a;
      margin: 14px 0;
      text-shadow: 0 0 16px rgba(201,168,76,0.4);
    }

    .tier-change {
      font-size: 16px;
      color: #88c888;
      margin: 10px 0;
    }
    .overflow-xp {
      font-size: 13px;
      color: #a08858;
      margin: 10px 0;
    }
    .level-up-content button {
      margin-top: 20px;
      padding: 10px 28px;
      background: linear-gradient(180deg, rgba(55,38,10,0.92) 0%, rgba(20,14,4,0.96) 100%);
      border: 1px solid rgba(155,115,38,0.65);
      color: #c9a84c;
      font-family: 'Cinzel', serif;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.2s;
    }
    .level-up-content button:hover {
      border-color: #c9a84c; color: #f2c96a;
      box-shadow: 0 0 14px rgba(201,168,76,0.20);
    }

    .character-progress {
      background: linear-gradient(180deg, rgba(30,22,8,0.70) 0%, rgba(14,10,4,0.80) 100%);
    }
    .skill-classes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(195px, 1fr));
      gap: 12px; margin-top: 12px;
    }

    .skill-class-card {
      background: rgba(0,0,0,0.30);
      border: 1px solid rgba(80,58,18,0.35);
      padding: 14px;
      transition: border-color 0.2s;
    }
    .skill-class-card:hover {
      border-color: rgba(155,115,38,0.55);
      background: rgba(35,24,8,0.50);
    }
    .class-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .class-icon { font-size: 22px; }
    .class-name {
      font-family: 'Cinzel', serif;
      font-size: 12px; font-weight: 600;
      color: #e2cfa8; letter-spacing: 0.5px;
    }
    .class-level {
      font-family: 'Cinzel', serif;
      font-size: 18px; font-weight: 700;
      color: #f2c96a; margin-bottom: 4px;
      text-shadow: 0 0 10px rgba(201,168,76,0.3);
    }
    .class-tier {
      font-size: 10px; color: #a08858;
      text-transform: uppercase; letter-spacing: 1px;
      margin-bottom: 8px; font-family: 'Cinzel', serif;
    }
    .xp-progress-bar {
      height: 7px;
      background: rgba(0,0,0,0.65);
      border: 1px solid rgba(80,58,18,0.40);
      overflow: hidden; margin-bottom: 5px;
    }
    .xp-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #6b3808 0%, #c8781a 55%, #f0a830 100%);
      transition: width 0.5s ease;
    }
    .xp-text { font-size: 10px; color: #a08858; text-align: center; }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes scaleIn {
      from { transform: scale(0.8); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  `]
})
export class XpCalculatorComponent implements OnInit {
  // Step 1: Activity inputs
  selectedActivity: string = '';
  hours: number = 2;
  intensity: 'routine' | 'moderate' | 'complex' = 'routine';
  selectedBonuses: string[] = [];
  availableBonuses: { key: string; name: string; xp: number }[] = [];

  // Step 2: Pending XP result
  pendingXPResult: XPCalculation | null = null;

  // Step 3: Consolidation inputs
  sleepHours: number = 6.25;
  nutritionType: 'clean' | 'mixed' | 'poor' = 'mixed';
  hoursAfterMeal: number = 3;
  skillCategory: 'warrior' | 'cognitive' | 'sage' = 'cognitive';

  // Step 4: Consolidation result
  consolidationResult: ConsolidationResult | null = null;
  targetSkillClass: string = 'developer';
  skillClasses: SkillClass[] = [];

  // Level-up notification
  levelUpResult: LevelUpResult | null = null;

  constructor(
    private xpCalc: XpCalculationService,
    private consolidation: ConsolidationService,
    private levelProg: LevelProgressionService
  ) {}

  ngOnInit(): void {
    this.loadSkillClasses();
    this.loadAvailableBonuses();

    // Subscribe to character progress changes
    this.levelProg.progress$.subscribe(progress => {
      this.skillClasses = Object.values(progress.classes);
    });
  }

  loadSkillClasses(): void {
    this.skillClasses = this.levelProg.getAllSkillClasses();
  }

  loadAvailableBonuses(): void {
    // Load common bonuses (will be filtered by activity category later)
    const allBonuses = this.xpCalc.getBonusesByCategory();
    this.availableBonuses = allBonuses.map(bonus => ({
      key: Object.keys(this.xpCalc['commonBonuses']).find(
        k => this.xpCalc['commonBonuses'][k] === bonus
      )!,
      name: bonus.name,
      xp: bonus.xp
    }));
  }

  onActivityChange(): void {
    // Reset bonuses when activity changes
    this.selectedBonuses = [];
    this.pendingXPResult = null;
    this.consolidationResult = null;
  }

  onBonusToggle(bonusKey: string, event: any): void {
    if (event.target.checked) {
      this.selectedBonuses.push(bonusKey);
    } else {
      this.selectedBonuses = this.selectedBonuses.filter(k => k !== bonusKey);
    }
  }

  calculatePendingXP(): void {
    if (!this.selectedActivity || this.hours <= 0) return;

    this.pendingXPResult = this.xpCalc.calculatePendingXP(
      this.selectedActivity,
      this.hours,
      this.intensity,
      this.selectedBonuses
    );

    console.log('[XP Calculator] Pending XP calculated:', this.pendingXPResult);
  }

  calculateConsolidation(): void {
    if (!this.pendingXPResult) return;

    const sleepQuality = this.consolidation.assessSleepQuality(this.sleepHours);
    const nutrition = {
      type: this.nutritionType,
      description: this.nutritionType === 'clean' ? 'High protein, whole foods' :
                   this.nutritionType === 'mixed' ? 'Balanced with some treats' :
                   'Low protein, processed foods'
    };
    const now = new Date();
    const bedtime = new Date(now);
    const lastMeal = new Date(bedtime.getTime() - (this.hoursAfterMeal * 60 * 60 * 1000));
    const fasting = this.consolidation.assessFasting(lastMeal, bedtime);

    this.consolidationResult = this.consolidation.consolidateXP(
      this.pendingXPResult.pendingXP,
      sleepQuality,
      nutrition,
      fasting,
      this.skillCategory
    );

    console.log('[XP Calculator] Consolidation calculated:', this.consolidationResult);
  }

  addToCharacter(): void {
    if (!this.consolidationResult) return;

    const levelUpResult = this.levelProg.addXP(
      this.targetSkillClass,
      this.consolidationResult.permanentXP
    );

    if (levelUpResult) {
      this.levelUpResult = levelUpResult;
    }

    // Reload skill classes to show updated progress
    this.loadSkillClasses();
    console.log('[XP Calculator] Added XP to character:', this.targetSkillClass);
  }
}
