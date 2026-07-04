import {
  Component, OnInit, OnDestroy, inject,
  signal, computed, Output, EventEmitter,
  Input, ChangeDetectionStrategy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

import { SkillUnlockService }             from './skill-unlock.service';
import { WillpowerService }               from './willpower.service';
import { ALL_SKILLS, SKILL_BARS, COMBOS, SKILL_MAP, Skill, SkillBar, ExerciseSet, ComboDefinition } from './skill-tree.data';
import { SKILL_ICON_SRC } from './skill-icon.data';
import { environment } from '../environments/environment';

/** Emitted to the parent (ability-hotbar) when a non-exercise skill is chosen. */
export interface SkillActivateEvent {
  skill: Skill;
}

/** One logged set in the exercise panel. */
interface SetEntry {
  reps:   number;
  weight: number | null;   // null = bodyweight
}

@Component({
  selector: 'app-skill-bar-switcher',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- ── Combo Flash ─────────────────────────────────────────────────── -->
    <div class="combo-flash" *ngIf="comboFlash()">
      <span class="combo-flash-icon">✨</span>
      <span class="combo-flash-name">{{ comboFlash()!.name }}</span>
      <span class="combo-flash-xp">+{{ comboFlash()!.bonusXp }} XP</span>
    </div>

    <!-- ── Exercise Log Panel ─────────────────────────────────────────── -->
    <div class="exercise-panel" *ngIf="activeExercise()">
      <div class="exercise-panel-header">
        <span class="exercise-panel-icon">{{ activeExercise()!.icon }}</span>
        <span class="exercise-panel-name">{{ activeExercise()!.name }}</span>
        <span class="exercise-panel-tip">Log your sets below</span>
        <button class="exercise-panel-close" (click)="closeExercisePanel()">✕</button>
      </div>

      <div class="exercise-sets">
        <div class="exercise-set-row" *ngFor="let s of exerciseSets(); let i = index">
          <span class="set-num">Set {{ i + 1 }}</span>
          <input
            class="set-input"
            type="number"
            [(ngModel)]="s.weight"
            placeholder="lbs"
            min="0"
          />
          <span class="set-x">×</span>
          <input
            class="set-input set-reps"
            type="number"
            [(ngModel)]="s.reps"
            placeholder="reps"
            min="1"
          />
          <button class="set-remove" (click)="removeSet(i)">✕</button>
        </div>

        <div class="exercise-set-row exercise-add-row">
          <button class="exercise-btn-add" (click)="addSet()">+ Add Set</button>
          <button
            class="exercise-btn-log"
            [disabled]="exerciseSets().length === 0"
            (click)="logExercise()">
            ✓ Log {{ exerciseSets().length }} Set{{ exerciseSets().length !== 1 ? 's' : '' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Active Bar Name ─────────────────────────────────────────────── -->
    <div class="bar-title">
      <span class="bar-title-icon">{{ activeBar().icon }}</span>
      <span class="bar-title-text">{{ activeBar().name }}</span>
      <span class="bar-skill-counts">
        {{ unlockedCountFor(activeBar()) }}/{{ activeBar().skills.length }} unlocked
      </span>
    </div>

    <!-- ── Skill Slots ─────────────────────────────────────────────────── -->
    <div class="skill-slots">
      <button
        *ngFor="let skillId of activeBar().skills; let i = index"
        class="skill-slot"
        [class.skill-locked]="!isUnlocked(skillId)"
        [class.skill-active]="activeSkillId === skillId"
        [class.skill-depleted]="isWpDepleted(skillId)"
        [class.skill-exercise]="getSkill(skillId)?.isExercise"
        [title]="slotTooltip(skillId)"
        (click)="onSlotClick(skillId)">

        <!-- Key badge -->
        <span class="slot-key">{{ i < 9 ? (i + 1) : '' }}</span>

        <!-- Lock overlay -->
        <div class="slot-lock-overlay" *ngIf="!isUnlocked(skillId)">🔒</div>

        <!-- Tier pip -->
        <div class="slot-tier-pip" [ngClass]="'tier-' + (getSkill(skillId)?.tier ?? 'basic')"></div>

        <!-- Icon -->
        <img *ngIf="getIconSrc(skillId)"
             class="slot-icon-img"
             [src]="getIconSrc(skillId)!"
             [alt]="getSkill(skillId)?.name ?? skillId"
             loading="lazy">
        <span class="slot-icon"
              *ngIf="!getIconSrc(skillId)">{{ getSkill(skillId)?.icon ?? '?' }}</span>

        <!-- Label -->
        <span class="slot-label">{{ getSkill(skillId)?.name ?? skillId }}</span>

        <!-- WP badge -->
        <span class="slot-wp-cost"  *ngIf="(getSkill(skillId)?.willpowerCost  ?? 0) > 0">
          -{{ getSkill(skillId)!.willpowerCost }}
        </span>
        <span class="slot-wp-regen" *ngIf="(getSkill(skillId)?.willpowerRegen ?? 0) > 0">
          +{{ getSkill(skillId)!.willpowerRegen }}
        </span>

        <!-- Exercise dumbbell indicator -->
        <span class="slot-exercise-badge" *ngIf="getSkill(skillId)?.isExercise">⊕</span>

        <!-- Active glow bar -->
        <div class="slot-active-bar" *ngIf="activeSkillId === skillId"></div>
      </button>
    </div>

    <!-- ── Bar Selector Tabs ───────────────────────────────────────────── -->
    <div class="bar-selector">
      <button
        *ngFor="let bar of allBars"
        class="bar-tab"
        [class.bar-tab-active]="bar.id === activeBar().id"
        [ngClass]="bar.id === activeBar().id ? activeBar().colorClass : ''"
        (click)="selectBar(bar)"
        [title]="bar.name">
        <span class="bar-tab-icon">{{ bar.icon }}</span>
        <span class="bar-tab-name">{{ bar.name }}</span>
      </button>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }

    /* ── Combo Flash ─────────────────────────────────────────────────── */
    .combo-flash {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 4px 16px;
      background: linear-gradient(90deg, rgba(201,168,76,0.08), rgba(201,168,76,0.18), rgba(201,168,76,0.08));
      border-top: 1px solid rgba(201,168,76,0.3);
      border-bottom: 1px solid rgba(201,168,76,0.3);
      animation: combo-fadein 0.3s ease, combo-fadeout 0.4s ease 2.6s forwards;
      overflow: hidden;
    }
    .combo-flash-icon { font-size: 14px; }
    .combo-flash-name {
      font-family: 'Cinzel', serif;
      font-size: 11px;
      color: rgba(242,201,106,0.95);
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }
    .combo-flash-xp {
      font-size: 10px;
      color: rgba(111,207,151,0.9);
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    @keyframes combo-fadein  { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }
    @keyframes combo-fadeout { from { opacity:1; } to { opacity:0; } }

    /* ── Exercise Panel ──────────────────────────────────────────────── */
    .exercise-panel {
      background: rgba(6,5,2,0.97);
      border-top: 1px solid rgba(201,168,76,0.25);
      border-bottom: 1px solid rgba(201,168,76,0.12);
      padding: 10px 16px 8px;
    }
    .exercise-panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .exercise-panel-icon   { font-size: 18px; }
    .exercise-panel-name   { font-family: 'Cinzel', serif; font-size: 12px; color: rgba(242,201,106,0.95); flex:1; }
    .exercise-panel-tip    { font-size: 10px; color: rgba(168,145,88,0.6); }
    .exercise-panel-close  {
      background: none; border: none; color: rgba(168,145,88,0.5);
      cursor: pointer; font-size: 14px; line-height:1;
      padding: 2px 4px;
      &:hover { color: rgba(201,168,76,0.9); }
    }

    .exercise-sets { display: flex; flex-direction: column; gap: 5px; }

    .exercise-set-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .set-num {
      font-size: 10px;
      color: rgba(168,145,88,0.6);
      width: 36px;
      flex-shrink: 0;
      font-family: 'Cinzel', serif;
    }
    .set-input {
      background: rgba(201,168,76,0.06);
      border: 1px solid rgba(201,168,76,0.2);
      color: rgba(242,201,106,0.9);
      font-size: 11px;
      padding: 3px 6px;
      width: 56px;
      text-align: center;
      outline: none;
      &:focus { border-color: rgba(201,168,76,0.5); }
      &::placeholder { color: rgba(168,145,88,0.35); font-size: 10px; }
    }
    .set-reps { width: 48px; }
    .set-x { font-size: 11px; color: rgba(168,145,88,0.5); }
    .set-remove {
      background: none; border: none;
      color: rgba(168,80,80,0.5); cursor: pointer; font-size: 12px;
      &:hover { color: rgba(235,87,87,0.8); }
    }

    .exercise-add-row { margin-top: 2px; gap: 8px; }
    .exercise-btn-add {
      background: rgba(201,168,76,0.08);
      border: 1px solid rgba(201,168,76,0.22);
      color: rgba(201,168,76,0.75);
      font-size: 10px; padding: 4px 10px; cursor: pointer;
      font-family: 'Cinzel', serif; letter-spacing: 0.3px;
      transition: all 0.15s;
      &:hover { background: rgba(201,168,76,0.15); color: rgba(242,201,106,0.95); }
    }
    .exercise-btn-log {
      background: rgba(52,168,48,0.12);
      border: 1px solid rgba(52,168,48,0.30);
      color: rgba(111,207,151,0.85);
      font-size: 10px; padding: 4px 14px; cursor: pointer;
      font-family: 'Cinzel', serif; letter-spacing: 0.3px;
      transition: all 0.15s;
      &:hover:not(:disabled) { background: rgba(52,168,48,0.22); color: rgba(111,207,151,1); }
      &:disabled { opacity: 0.35; cursor: not-allowed; }
    }

    /* ── Bar Title ───────────────────────────────────────────────────── */
    .bar-title {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 16px 2px;
    }
    .bar-title-icon { font-size: 14px; }
    .bar-title-text {
      font-family: 'Cinzel', serif;
      font-size: 10px;
      color: rgba(201,168,76,0.65);
      letter-spacing: 0.8px;
      text-transform: uppercase;
      flex: 1;
    }
    .bar-skill-counts {
      font-size: 9px;
      color: rgba(168,145,88,0.45);
      letter-spacing: 0.3px;
    }

    /* ── Skill Slots ─────────────────────────────────────────────────── */
    .skill-slots {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px 10px 6px;
      justify-content: flex-start;
    }

    .skill-slot {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 58px;
      height: 68px;
      background: linear-gradient(180deg,rgba(18,15,7,0.90) 0%,rgba(10,8,3,0.96) 100%);
      border: 1px solid rgba(201,168,76,0.22);
      box-shadow: 0 0 0 1px rgba(0,0,0,0.6), inset 0 1px 0 rgba(201,168,76,0.06);
      cursor: pointer;
      transition: border-color 0.12s, box-shadow 0.12s;
      overflow: hidden;
      padding: 0 2px;

      &:hover:not(.skill-locked) {
        border-color: rgba(201,168,76,0.55);
        box-shadow: 0 0 10px rgba(201,168,76,0.25), 0 0 0 1px rgba(0,0,0,0.6);
      }
    }

    /* Locked state */
    .skill-locked {
      opacity: 0.38;
      cursor: not-allowed;
      filter: grayscale(0.6);
    }
    .slot-lock-overlay {
      position: absolute;
      top: 3px; right: 3px;
      font-size: 9px;
      opacity: 0.75;
    }

    /* Active (currently running) */
    .skill-active {
      border-color: rgba(201,168,76,0.75) !important;
      box-shadow:
        0 0 16px rgba(201,168,76,0.45),
        0 0 0 1px rgba(0,0,0,0.6),
        inset 0 0 12px rgba(201,168,76,0.12) !important;
      animation: skill-pulse 2s ease-in-out infinite;
    }

    /* WP depleted */
    .skill-depleted {
      border-color: rgba(184,56,32,0.35) !important;
      opacity: 0.55;
    }

    /* Exercise-type skill */
    .skill-exercise { border-style: dashed; }

    /* Active bar at bottom */
    .slot-active-bar {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, rgba(201,168,76,0.85), transparent);
    }

    /* Tier pip */
    .slot-tier-pip {
      position: absolute;
      top: 3px; left: 3px;
      width: 4px; height: 4px;
      border-radius: 50%;
    }
    .tier-basic        { background: rgba(168,145,88,0.55); }
    .tier-intermediate { background: rgba(111,180,207,0.70); }
    .tier-advanced     { background: rgba(168,88,168,0.75); }
    .tier-master       { background: rgba(242,180,60,0.95); }

    .slot-key {
      position: absolute;
      top: 3px; right: 4px;
      font-size: 8px;
      color: rgba(168,145,88,0.5);
      font-family: 'Cinzel', serif;
    }
    .slot-timer {
      position: absolute;
      top: 2px; right: 3px;
      font-size: 8px;
      color: rgba(242,201,106,0.9);
      font-family: monospace;
      white-space: nowrap;
    }
    .slot-icon {
      font-size: 20px;
      line-height: 1;
      margin-top: 8px;
      display: block;
    }
    .slot-icon-img {
      width: 20px;
      height: 20px;
      display: block;
      margin-top: 8px;
      filter: invert(79%) sepia(52%) saturate(338%) hue-rotate(357deg) brightness(95%) contrast(85%);
      opacity: 0.85;
      transition: opacity 0.12s;
    }
    button:hover .slot-icon-img  { opacity: 1; }
    .slot-locked  .slot-icon-img { filter: invert(100%) brightness(0.3); opacity: 0.35; }
    .slot-label {
      font-size: 8.5px;
      color: rgba(201,168,76,0.65);
      text-align: center;
      line-height: 1.15;
      margin-top: 3px;
      font-family: 'Cinzel', serif;
      letter-spacing: 0.2px;
      max-width: 54px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .slot-wp-cost {
      position: absolute;
      bottom: 4px; left: 3px;
      font-size: 7.5px;
      color: rgba(207,111,111,0.75);
    }
    .slot-wp-regen {
      position: absolute;
      bottom: 4px; left: 3px;
      font-size: 7.5px;
      color: rgba(111,207,151,0.75);
    }
    .slot-exercise-badge {
      position: absolute;
      bottom: 3px; right: 3px;
      font-size: 8px;
      color: rgba(111,180,207,0.65);
    }

    @keyframes skill-pulse {
      0%,100% { box-shadow: 0 0 10px rgba(201,168,76,0.35), 0 0 0 1px rgba(0,0,0,0.6), inset 0 0 8px rgba(201,168,76,0.08); }
      50%      { box-shadow: 0 0 24px rgba(201,168,76,0.60), 0 0 0 1px rgba(0,0,0,0.6), inset 0 0 16px rgba(201,168,76,0.18); }
    }

    /* ── Bar Selector Tabs ───────────────────────────────────────────── */
    .bar-selector {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
      padding: 6px 10px 4px;
      border-top: 1px solid rgba(201,168,76,0.10);
    }

    .bar-tab {
      display: flex;
      align-items: center;
      gap: 4px;
      background: rgba(10,8,3,0.80);
      border: 1px solid rgba(201,168,76,0.15);
      padding: 3px 9px;
      cursor: pointer;
      transition: all 0.12s;
      color: rgba(168,145,88,0.6);
      &:hover { border-color: rgba(201,168,76,0.40); color: rgba(201,168,76,0.85); }
    }
    .bar-tab-active {
      border-color: rgba(201,168,76,0.55) !important;
      background: rgba(201,168,76,0.08) !important;
      color: rgba(242,201,106,0.95) !important;
    }
    .bar-tab-icon { font-size: 13px; line-height: 1; }
    .bar-tab-name {
      font-family: 'Cinzel', serif;
      font-size: 8.5px;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }

    /* ── Bar colour accents (active tab) ────────────────────────────── */
    .bar-utility  { border-color: rgba(168,145,88,0.55)  !important; }
    .bar-redteam  { border-color: rgba(235,87,87,0.55)   !important; background: rgba(235,87,87,0.07) !important; }
    .bar-mma      { border-color: rgba(230,115,60,0.55)  !important; background: rgba(230,115,60,0.07) !important; }
    .bar-strength { border-color: rgba(111,180,207,0.55) !important; background: rgba(111,180,207,0.07) !important; }
    .bar-swimming { border-color: rgba(60,160,230,0.55)  !important; background: rgba(60,160,230,0.07) !important; }
    .bar-guitar   { border-color: rgba(168,111,207,0.55) !important; background: rgba(168,111,207,0.07) !important; }
    .bar-coding   { border-color: rgba(111,207,151,0.55) !important; background: rgba(111,207,151,0.07) !important; }
    .bar-sage     { border-color: rgba(242,201,106,0.55) !important; background: rgba(242,201,106,0.08) !important; }
  `],
})
export class SkillBarSwitcherComponent implements OnInit, OnDestroy {
  // ── Inputs ──────────────────────────────────────────────────────────────
  @Input() activeSkillId: string | null = null;

  // ── Outputs ─────────────────────────────────────────────────────────────
  @Output() skillActivated   = new EventEmitter<SkillActivateEvent>();
  @Output() exerciseLogged   = new EventEmitter<{ skill: Skill; sets: ExerciseSet[] }>();

  // ── Services ────────────────────────────────────────────────────────────
  private readonly unlock = inject(SkillUnlockService);
  private readonly wp     = inject(WillpowerService);
  private readonly http   = inject(HttpClient);

  // ── State ───────────────────────────────────────────────────────────────
  protected readonly allBars = SKILL_BARS;

  private readonly _activeBarId = signal<string>(SKILL_BARS[0].id);
  protected readonly activeBar = computed<SkillBar>(
    () => SKILL_BARS.find(b => b.id === this._activeBarId()) ?? SKILL_BARS[0]
  );

  // Exercise log panel
  protected readonly activeExercise = signal<Skill | null>(null);
  protected readonly exerciseSets   = signal<SetEntry[]>([]);

  // Combo detection — last N skill IDs activated this session
  private readonly recentSkills: string[] = [];
  private readonly COMBO_WINDOW = 6;

  protected readonly comboFlash = signal<{ name: string; bonusXp: number } | null>(null);
  private comboFlashTimeout?: ReturnType<typeof setTimeout>;

  // ── Lifecycle ────────────────────────────────────────────────────────────
  ngOnInit(): void { /* Restore last bar from storage */ }

  ngOnDestroy(): void {
    clearTimeout(this.comboFlashTimeout);
  }

  // ── Template helpers ─────────────────────────────────────────────────────

  protected getSkill(skillId: string): Skill | undefined {
    return SKILL_MAP.get(skillId);
  }

  protected getIconSrc(skillId: string): string | undefined {
    return SKILL_ICON_SRC[skillId];
  }

  protected isUnlocked(skillId: string): boolean {
    return this.unlock.isUnlocked(skillId);
  }

  protected isWpDepleted(skillId: string): boolean {
    const skill = SKILL_MAP.get(skillId);
    if (!skill || skill.willpowerCost === 0) return false;
    return this.wp.willpower() < skill.willpowerCost;
  }

  protected slotTooltip(skillId: string): string {
    const skill = SKILL_MAP.get(skillId);
    if (!skill) return skillId;
    const lockNote = this.unlock.isUnlocked(skillId) ? '' : ' [LOCKED — practice to unlock]';
    return `${skill.name}${lockNote}\n${skill.description}`;
  }

  protected unlockedCountFor(bar: SkillBar): number {
    return bar.skills.filter(id => this.unlock.isUnlocked(id)).length;
  }

  // ── Keyboard shortcuts (MMORPG-style) ──────────────────────────────────
  // 1–9  → activate Nth skill slot in active bar
  // `    → cycle to next bar
  // Shift+` → cycle to previous bar

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    // Ignore when user is typing in an input/textarea
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const key = event.key;

    // Backtick — cycle bars
    if (key === '`') {
      const bars = SKILL_BARS;
      const currentIdx = bars.findIndex(b => b.id === this._activeBarId());
      const nextIdx = event.shiftKey
        ? (currentIdx - 1 + bars.length) % bars.length
        : (currentIdx + 1) % bars.length;
      this.selectBar(bars[nextIdx]);
      event.preventDefault();
      return;
    }

    // 1–9 — activate slot
    const slotNum = parseInt(key, 10);
    if (isNaN(slotNum) || slotNum < 1 || slotNum > 9) return;

    const skills = this.activeBar().skills;
    const skillId = skills[slotNum - 1];
    if (!skillId) return;

    event.preventDefault();
    this.onSlotClick(skillId);
  }

  // ── Interactions ─────────────────────────────────────────────────────────

  protected selectBar(bar: SkillBar): void {
    this._activeBarId.set(bar.id);
    this.closeExercisePanel();
  }

  protected onSlotClick(skillId: string): void {
    // If locked, clicking unlocks it (first practice = unlock, ESO mechanic)
    if (!this.unlock.isUnlocked(skillId)) {
      this.unlock.unlock(skillId);
      return;
    }

    const skill = SKILL_MAP.get(skillId);
    if (!skill) return;

    // Exercise skills → open exercise log panel
    if (skill.isExercise) {
      if (this.activeExercise()?.id === skillId) {
        this.closeExercisePanel();
      } else {
        this.activeExercise.set(skill);
        this.exerciseSets.set([{ reps: 0, weight: null }]);
      }
      return;
    }

    // Standard skill → emit to parent for action tracking
    this.recordSkillActivation(skillId);
    this.skillActivated.emit({ skill });
  }

  // ── Exercise panel ───────────────────────────────────────────────────────

  protected addSet(): void {
    this.exerciseSets.update(sets => [...sets, { reps: 0, weight: null }]);
  }

  protected removeSet(index: number): void {
    this.exerciseSets.update(sets => sets.filter((_, i) => i !== index));
  }

  protected closeExercisePanel(): void {
    this.activeExercise.set(null);
    this.exerciseSets.set([]);
  }

  protected logExercise(): void {
    const skill = this.activeExercise();
    const sets  = this.exerciseSets();
    if (!skill || sets.length === 0) return;

    const validSets: ExerciseSet[] = sets
      .filter(s => s.reps > 0)
      .map(s => ({ reps: s.reps, weight: s.weight ?? undefined }));

    if (validSets.length === 0) return;

    // Apply WP cost, record skill activation for combos
    if (skill.willpowerCost > 0) this.wp.deplete(skill.willpowerCost);
    this.recordSkillActivation(skill.id);

    this.exerciseLogged.emit({ skill, sets: validSets });
    this.closeExercisePanel();
  }

  // ── Combo detection ──────────────────────────────────────────────────────

  private recordSkillActivation(skillId: string): void {
    this.recentSkills.push(skillId);
    if (this.recentSkills.length > this.COMBO_WINDOW) {
      this.recentSkills.shift();
    }
    this.checkCombos();
  }

  private checkCombos(): void {
    for (const combo of COMBOS) {
      if (combo.skillIds.length > this.recentSkills.length) continue;

      const tail = this.recentSkills.slice(-combo.skillIds.length);
      if (tail.every((id, i) => id === combo.skillIds[i])) {
        this.flashCombo(combo.name, combo.bonusXp);
        this.logComboToJournal(combo);
        // Clear recent to prevent re-trigger
        this.recentSkills.length = 0;
        return;
      }
    }
  }

  private logComboToJournal(combo: ComboDefinition): void {
    this.http.post(`${environment.apiUrl}/api/activities`, {
      activityType: `Combo: ${combo.name}`,
      xp: combo.bonusXp,
      notes: combo.description,
      clientDate: new Date().toLocaleDateString('en-CA')
    }).subscribe({
      next: () => console.log(`[Combo] Journal logged: ${combo.name}`),
      error: err => console.error('[Combo] Journal log failed:', err)
    });
  }

  private flashCombo(name: string, bonusXp: number): void {
    clearTimeout(this.comboFlashTimeout);
    this.comboFlash.set({ name, bonusXp });
    this.comboFlashTimeout = setTimeout(() => this.comboFlash.set(null), 3000);
  }
}
