import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { WillpowerService } from './willpower.service';
import { HotbarSessionService } from './hotbar-session.service';
import { DisciplinesRowComponent } from './disciplines-row.component';
import { SkillBarSwitcherComponent, SkillActivateEvent } from './skill-bar-switcher.component';
import { Skill, ExerciseSet } from './skill-tree.data';

@Component({
  selector: 'app-ability-hotbar',
  standalone: true,
  imports: [CommonModule, DisciplinesRowComponent, SkillBarSwitcherComponent],
  template: `
    <div class="hotbar-frame">

      <!-- ⚡ WP Depleted toast (fades out after 3s) -->
      <div class="wp-depleted-toast" *ngIf="showDepletedToast()">
        ⚡ WP Depleted — running on reserve
      </div>

      <!-- Background ornament line -->
      <div class="hotbar-top-border"></div>

      <div class="hotbar-inner">

        <!-- WP mini indicator (left anchor) -->
        <div class="hotbar-wp-mini">
          <div class="wp-mini-label">WP</div>
          <div class="wp-mini-track">
            <div class="wp-mini-fill"
                 [ngClass]="wp.barClass()"
                 [style.height.%]="wp.willpower()">
            </div>
          </div>
          <div class="wp-mini-value">{{ wp.willpower() }}</div>
        </div>

        <!-- ── Skill Bar Switcher (replaces flat ability list) ── -->
        <app-skill-bar-switcher
          [activeSkillId]="currentSkillId()"
          (skillActivated)="onSkillActivated($event)"
          (exerciseLogged)="onExerciseLogged($event)">
        </app-skill-bar-switcher>

        <!-- Daily reset button -->
        <button class="hotbar-reset-btn" (click)="onResetWillpower()" title="New Day — Reset Willpower to 100">
          <span class="reset-icon">☀</span>
          <span class="reset-label">New Day</span>
        </button>

        <!-- Commit open sessions to journal -->
        <button class="hotbar-reset-btn hotbar-commit-btn"
                *ngIf="hotbarSession.hasActiveSession('mma') || hotbarSession.hasActiveSession('strength') || hotbarSession.hasActiveSession('swimming') || hotbarSession.hasActiveSession('coding') || hotbarSession.hasActiveSession('redteam') || hotbarSession.hasActiveSession('guitar') || hotbarSession.hasActiveSession('sage')"
                (click)="onCommitSessions()"
                title="Commit session activity to journal">
          <span class="reset-icon">📓</span>
          <span class="reset-label">Log</span>
        </button>

      </div>

      <!-- Disciplines row (beneath hotbar) -->
      <div class="hotbar-disciplines">
        <app-disciplines-row></app-disciplines-row>
      </div>

    </div>
  `,
  styles: [`
    :host {
      display: block;
      position: sticky;
      bottom: 0;
      z-index: 100;
      flex-shrink: 0;
    }

    /* ── Frame ── */
    .hotbar-frame {
      position: relative;
      background: linear-gradient(
        180deg,
        rgba(4, 3, 1, 0.92) 0%,
        rgba(8, 6, 2, 0.98) 100%
      );
      border-top: 2px solid rgba(201, 168, 76, 0.55);
      box-shadow:
        0 -4px 24px rgba(0,0,0,0.85),
        0 -1px 0 rgba(201,168,76,0.08);
      backdrop-filter: blur(6px);
    }

    .hotbar-top-border {
      height: 1px;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(201, 168, 76, 0.20) 15%,
        rgba(242, 201, 106, 0.45) 50%,
        rgba(201, 168, 76, 0.20) 85%,
        transparent 100%
      );
    }

    .hotbar-inner {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px 24px 8px;
      gap: 12px;
    }

    /* ── WP Mini Indicator ── */
    .hotbar-wp-mini {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      margin-right: 4px;
    }

    .wp-mini-label {
      font-family: 'Cinzel', serif;
      font-size: 8px;
      letter-spacing: 1.5px;
      color: rgba(56, 168, 40, 0.75);
      text-transform: uppercase;
    }

    .wp-mini-track {
      width: 8px;
      height: 40px;
      background: rgba(0, 0, 0, 0.60);
      border: 1px solid rgba(38, 100, 28, 0.45);
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      overflow: hidden;
    }

    .wp-mini-fill {
      width: 100%;
      transition: height 0.5s ease;
    }

    .wp-mini-value {
      font-size: 9px;
      color: rgba(80, 200, 60, 0.80);
      font-weight: 700;
    }

    /* ── Slots Container ── */
    .hotbar-slots {
      display: flex;
      align-items: flex-end;
      gap: 4px;
    }

    /* ── Individual Ability Slot ── */
    .ability-slot {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      width: 68px;
      height: 68px;
      padding: 0 4px 6px;
      background: linear-gradient(180deg, #0e0b05 0%, #1a1408 100%);
      border: 1px solid rgba(110, 82, 28, 0.55);
      cursor: pointer;
      transition:
        background 0.15s,
        border-color 0.15s,
        box-shadow 0.15s,
        transform 0.10s;
      overflow: hidden;
      user-select: none;

      &:hover {
        background: linear-gradient(180deg, #1a1408 0%, #221a09 100%);
        border-color: rgba(201, 168, 76, 0.50);
        box-shadow: 0 0 12px rgba(201, 168, 76, 0.18);
        transform: translateY(-2px);

        .slot-icon { opacity: 1; transform: scale(1.1); }
      }

      &:active {
        transform: translateY(0) scale(0.96);
      }

      /* ── Active (timer running) ── */
      &.slot-active {
        background: linear-gradient(180deg, #1a1408 0%, #252010 100%);
        border-color: rgba(201, 168, 76, 0.90);
        box-shadow:
          0 0 0 1px rgba(201, 168, 76, 0.30),
          0 0 18px rgba(201, 168, 76, 0.45),
          inset 0 0 14px rgba(201, 168, 76, 0.12);
        animation: hotbar-slot-pulse 2.2s ease-in-out infinite;

        .slot-icon { opacity: 1; filter: drop-shadow(0 0 6px rgba(201,168,76,0.7)); }
        .slot-label { color: rgba(242, 201, 106, 0.95); }
      }

      /* ── Depleted (not enough WP) ── */
      &.slot-depleted:not(.slot-active) {
        opacity: 0.45;
        cursor: not-allowed;
        &:hover { transform: none; box-shadow: none; }
      }
    }

    /* ── Key Badge (top-left) ── */
    .slot-key {
      position: absolute;
      top: 4px;
      left: 5px;
      font-size: 9px;
      font-family: 'Cinzel', serif;
      color: rgba(160, 136, 88, 0.75);
      letter-spacing: 0.5px;
      line-height: 1;
    }

    /* ── Timer (top-left, replaces key badge when active) ── */
    .slot-timer {
      position: absolute;
      top: 3px;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 10px;
      font-weight: 700;
      color: rgba(242, 201, 106, 1);
      font-family: 'Cinzel', serif;
      letter-spacing: 0.5px;
      line-height: 1;
      text-shadow: 0 0 10px rgba(201, 168, 76, 0.8);
    }

    /* ── Slot Icon ── */
    .slot-icon {
      font-size: 26px;
      opacity: 0.72;
      transition: opacity 0.15s, transform 0.15s, filter 0.15s;
      line-height: 1;
      margin-bottom: 1px;
    }

    /* ── Slot Label ── */
    .slot-label {
      font-family: 'Cinzel', serif;
      font-size: 7.5px;
      letter-spacing: 0.8px;
      color: rgba(160, 136, 88, 0.80);
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
      text-align: center;
    }

    /* ── WP Cost Badge (top-right) ── */
    .slot-wp-cost {
      position: absolute;
      top: 3px;
      right: 4px;
      font-size: 8px;
      color: rgba(180, 50, 50, 0.80);
      font-weight: 700;
      line-height: 1;
    }

    /* ── WP Regen Badge (top-right, green) ── */
    .slot-wp-regen {
      position: absolute;
      top: 3px;
      right: 4px;
      font-size: 8px;
      color: rgba(60, 180, 60, 0.85);
      font-weight: 700;
      line-height: 1;
    }

    /* ── Active Bottom Bar ── */
    .slot-active-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(201, 168, 76, 0.8) 30%,
        rgba(242, 201, 106, 1) 50%,
        rgba(201, 168, 76, 0.8) 70%,
        transparent 100%
      );
      animation: hotbar-bar-sweep 1.8s linear infinite;
    }

    /* ── Separator Ornament ── */
    .hotbar-sep {
      font-size: 14px;
      color: rgba(201, 168, 76, 0.35);
      margin: 0 4px;
      padding-bottom: 8px;
      align-self: flex-end;
    }

    /* ── Ultimate Slot (slightly taller + gold tint) ── */
    .ability-ultimate {
      width: 72px;
      height: 72px;
      border-color: rgba(201, 168, 76, 0.45);
      background: linear-gradient(180deg, #0e0b05 0%, #1e1808 100%);

      &.slot-active {
        background: linear-gradient(180deg, #1e1808 0%, #2a2210 100%);
      }

      .slot-icon { font-size: 30px; }
    }

    /* ── Daily Reset Button ── */
    .hotbar-reset-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      width: 44px;
      height: 44px;
      margin-left: 8px;
      background: rgba(14, 11, 5, 0.90);
      border: 1px solid rgba(110, 82, 28, 0.40);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
      align-self: flex-end;
      margin-bottom: 4px;

      &:hover {
        border-color: rgba(201, 168, 76, 0.55);
        box-shadow: 0 0 10px rgba(201, 168, 76, 0.18);
        .reset-icon { color: rgba(242, 201, 106, 0.95); }
        .reset-label { color: rgba(201, 168, 76, 0.80); }
      }
    }

    .reset-icon {
      font-size: 16px;
      color: rgba(160, 136, 88, 0.65);
      transition: color 0.15s;
    }

    .reset-label {
      font-family: 'Cinzel', serif;
      font-size: 6px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: rgba(106, 80, 32, 0.75);
      transition: color 0.15s;
    }

    /* ── Commit Sessions Button (gold tint when active sessions exist) ── */
    .hotbar-commit-btn {
      border-color: rgba(201, 168, 76, 0.55);
      animation: hotbar-slot-pulse 2.5s ease-in-out infinite;

      .reset-icon { color: rgba(201, 168, 76, 0.85); }
      .reset-label { color: rgba(201, 168, 76, 0.75); }

      &:hover {
        border-color: rgba(201, 168, 76, 0.90);
        box-shadow: 0 0 14px rgba(201, 168, 76, 0.35);
      }
    }

    /* ── WP Fill Classes ── */
    .eso-bar-willpower-high     { background: linear-gradient(0deg, #163516 0%, #34a830 100%); }
    .eso-bar-willpower-med      { background: linear-gradient(0deg, #223816 0%, #7ab830 100%); }
    .eso-bar-willpower-low      { background: linear-gradient(0deg, #3a3010 0%, #b8a030 100%); }
    .eso-bar-willpower-depleted { background: linear-gradient(0deg, #3a1510 0%, #b83820 100%); }

    /* ── Keyframe Animations ── */
    @keyframes hotbar-slot-pulse {
      0%, 100% {
        box-shadow:
          0 0 0 1px rgba(201, 168, 76, 0.25),
          0 0 12px rgba(201, 168, 76, 0.35),
          inset 0 0 10px rgba(201, 168, 76, 0.08);
      }
      50% {
        box-shadow:
          0 0 0 1px rgba(201, 168, 76, 0.45),
          0 0 28px rgba(201, 168, 76, 0.65),
          inset 0 0 18px rgba(201, 168, 76, 0.20);
      }
    }

    @keyframes hotbar-bar-sweep {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }

    /* ── Depleted Toast ── */
    .wp-depleted-toast {
      position: absolute;
      top: -36px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(184, 56, 32, 0.92);
      border: 1px solid rgba(235, 87, 87, 0.60);
      color: #fff;
      font-size: 0.75rem;
      padding: 5px 14px;
      white-space: nowrap;
      animation: toast-fadein 0.3s ease;
      z-index: 10;
      pointer-events: none;
    }

    @keyframes toast-fadein {
      from { opacity: 0; transform: translateX(-50%) translateY(6px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* ── Disciplines Row Wrapper ── */
    .hotbar-disciplines {
      padding: 0 24px 4px;
      border-top: 1px solid rgba(201, 168, 76, 0.08);
    }
  `]
})
export class AbilityHotbarComponent implements OnInit, OnDestroy {
  protected readonly wp             = inject(WillpowerService);
  protected readonly hotbarSession  = inject(HotbarSessionService);
  protected readonly activeSkillId  = signal<string | null>(null);

  protected readonly showDepletedToast = signal(false);
  private depletedSub!: Subscription;
  private toastTimeout?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.depletedSub = this.wp.depleted$.subscribe(() => {
      this.showDepletedToast.set(true);
      clearTimeout(this.toastTimeout);
      this.toastTimeout = setTimeout(() => this.showDepletedToast.set(false), 3000);
    });
  }

  ngOnDestroy(): void {
    this.depletedSub?.unsubscribe();
    clearTimeout(this.toastTimeout);
  }

  /** Skill ID of the currently active animation (for glow state in switcher). */
  protected readonly currentSkillId = () => this.activeSkillId();

  protected onSkillActivated(event: SkillActivateEvent): void {
    const { skill } = event;
    // Toggle off: clicking the currently active skill returns to idle
    if (this.activeSkillId() === skill.id) {
      this.activeSkillId.set(null);
      window.dispatchEvent(new CustomEvent('play-animation', { detail: { name: 'idle', loop: true } }));
      return;
    }
    // Activate: count the press, set glow, start looping animation, navigate to quests
    this.hotbarSession.recordActivation(skill);
    this.activeSkillId.set(skill.id);
    window.dispatchEvent(new CustomEvent('play-animation', { detail: { name: skill.animation, loop: true } }));
    window.dispatchEvent(new CustomEvent('navigate-to-panel', { detail: { panelId: 'quests' } }));
  }

  protected onExerciseLogged(event: { skill: Skill; sets: ExerciseSet[] }): void {
    this.hotbarSession.recordExercise(event.skill, event.sets);
    window.dispatchEvent(new CustomEvent('navigate-to-panel', { detail: { panelId: 'quests' } }));
  }

  protected onCommitSessions(): void {
    this.hotbarSession.commitAll();
  }

  protected onResetWillpower(): void {
    this.wp.reset();
  }
}
