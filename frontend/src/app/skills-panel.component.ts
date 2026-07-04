import {
  Component, computed, inject, signal, OnInit, OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { environment } from '../environments/environment';
import { SkillUnlockService } from './skill-unlock.service';
import { RotColorService } from './rot-color.service';
import { SKILL_ICON_SRC } from './skill-icon.data';
import {
  ALL_SKILLS, SKILL_BARS, COMBOS, SKILL_MAP,
  Skill, SkillBar, ComboDefinition, SkillCategory,
} from './skill-tree.data';

const TIER_LABEL: Record<string, string> = {
  basic: 'I', intermediate: 'II', advanced: 'III', master: 'IV',
};

const BAR_COLOR: Record<string, string> = {
  utility:  'rgba(168,145,88,0.80)',
  redteam:  'rgba(235,87,87,0.85)',
  mma:      'rgba(230,115,60,0.85)',
  strength: 'rgba(111,180,207,0.85)',
  swimming: 'rgba(60,160,230,0.85)',
  guitar:   'rgba(168,111,207,0.85)',
  coding:   'rgba(111,207,151,0.85)',
  sage:     'rgba(242,201,106,0.90)',
};

const BAR_COLOR_DIM: Record<string, string> = {
  utility:  'rgba(168,145,88,0.12)',
  redteam:  'rgba(235,87,87,0.10)',
  mma:      'rgba(230,115,60,0.10)',
  strength: 'rgba(111,180,207,0.10)',
  swimming: 'rgba(60,160,230,0.10)',
  guitar:   'rgba(168,111,207,0.10)',
  coding:   'rgba(111,207,151,0.10)',
  sage:     'rgba(242,201,106,0.10)',
};

const BAR_COLOR_BORDER: Record<string, string> = {
  utility:  'rgba(168,145,88,0.35)',
  redteam:  'rgba(235,87,87,0.38)',
  mma:      'rgba(230,115,60,0.38)',
  strength: 'rgba(111,180,207,0.38)',
  swimming: 'rgba(60,160,230,0.38)',
  guitar:   'rgba(168,111,207,0.38)',
  coding:   'rgba(111,207,151,0.38)',
  sage:     'rgba(242,201,106,0.38)',
};

const BAR_BASE_RGB: Record<string, [number, number, number]> = {
  utility:  [168, 145,  88],
  redteam:  [235,  87,  87],
  mma:      [230, 115,  60],
  strength: [111, 180, 207],
  swimming: [ 60, 160, 230],
  guitar:   [168, 111, 207],
  coding:   [111, 207, 151],
  sage:     [242, 201, 106],
};

const BAR_TO_CLASS: Record<string, string> = {
  coding:   'developer',
  sage:     'sage',
  mma:      'warrior',
  strength: 'warrior',
  swimming: 'warrior',
  redteam:  'redteamer',
  guitar:   'artist',
  utility:  '',
};

interface SkillTreeStat {
  id: string;
  name: string;
  level: number;
  tier: string;
  currentXP: number;
  xpToNextLevel: number;
  percentToNext: number;
  rustStatus: 'sharp' | 'rusty' | 'very-rusty' | 'n/a';
  weeklyActivity: string;
  weeklyXPRate: number;
  estimatedWeeksToLevel: number;
}

@Component({
  selector: 'app-skills-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="sp-root">

  <!-- ── LEFT SIDEBAR: Skill Lines ─────────────────────────────── -->
  <aside class="sp-sidebar">
    <div class="sp-sidebar-header">
      <span class="sp-sidebar-ornament">✦</span>
      <span class="sp-sidebar-title">Skill Lines</span>
    </div>

    <div class="sp-category-list">
      <button
        *ngFor="let bar of allBars"
        class="sp-category-btn"
        [class.sp-category-active]="activeBarId() === bar.id"
        [style.--accent]="barColor(bar.id)"
        [style.--accent-dim]="barColorDim(bar.id)"
        [style.--accent-border]="barColorBorder(bar.id)"
        (click)="selectBar(bar.id)">

        <span class="sp-cat-icon">{{ bar.icon }}</span>
        <span class="sp-cat-name">{{ bar.name }}</span>
        <span class="sp-cat-count"
              [class.sp-cat-count-full]="unlockedCount(bar) === bar.skills.length">
          {{ unlockedCount(bar) }}/{{ bar.skills.length }}
        </span>
        <span class="sp-cat-chevron" *ngIf="activeBarId() === bar.id">▶</span>
      </button>
    </div>

    <div class="sp-sidebar-footer">
      <span class="sp-total-label">Total Unlocked</span>
      <span class="sp-total-val">{{ totalUnlocked() }} / {{ totalSkills }}</span>
      <div class="sp-total-bar-track">
        <div class="sp-total-bar-fill"
             [style.width.%]="(totalUnlocked() / totalSkills) * 100"></div>
      </div>
    </div>
  </aside>

  <!-- ── RIGHT MAIN: ESO Skill Rows + Action Bar ───────────────── -->
  <main class="sp-main">

    <!-- Skill Line Header (level number + name + XP bar) -->
    <div class="sp-line-header"
         [style.--accent]="barColor(activeBarId())"
         [style.--accent-border]="barColorBorder(activeBarId())">
      <span class="sp-line-level">{{ lineLevel() }}</span>
      <div class="sp-line-info">
        <h2 class="sp-line-name">{{ activeBar().name | uppercase }}</h2>
        <div class="sp-line-xp-track">
          <div class="sp-line-xp-fill"
               [style.width.%]="lineXpPct()"
               [style.background]="progressFillColor(activeBarId())"></div>
        </div>
      </div>
      <div class="sp-assignment-lbl">ASSIGNMENT ✦</div>
    </div>

    <!-- ── DECAY STATUS STRIP ──────────────────────────────────── -->
    <div *ngIf="activeClassStat() as cls" class="sp-decay-strip"
         [style.--accent]="barColor(activeBarId())"
         [style.--accent-border]="barColorBorder(activeBarId())"
         [attr.data-rust]="cls.rustStatus">
      <div class="sp-decay-item">
        <span class="sp-decay-icon">{{ rustStatusIcon(cls.rustStatus) }}</span>
        <div class="sp-decay-info">
          <span class="sp-decay-lbl">RUST STATUS</span>
          <span class="sp-decay-val" [style.color]="rustStatusColor(cls.rustStatus)">{{ rustStatusLabel(cls.rustStatus) }}</span>
        </div>
      </div>
      <div class="sp-decay-sep"></div>
      <div class="sp-decay-item">
        <span class="sp-decay-icon">📅</span>
        <div class="sp-decay-info">
          <span class="sp-decay-lbl">WEEKLY ACTIVITY</span>
          <span class="sp-decay-val">{{ cls.weeklyActivity }}</span>
        </div>
      </div>
      <div class="sp-decay-sep"></div>
      <div class="sp-decay-item">
        <span class="sp-decay-icon">⚡</span>
        <div class="sp-decay-info">
          <span class="sp-decay-lbl">XP / WEEK</span>
          <span class="sp-decay-val">+{{ cls.weeklyXPRate }}</span>
        </div>
      </div>
      <div class="sp-decay-sep"></div>
      <div class="sp-decay-item">
        <span class="sp-decay-icon">🎯</span>
        <div class="sp-decay-info">
          <span class="sp-decay-lbl">LVL {{ cls.level }} · {{ cls.tier | uppercase }}</span>
          <span class="sp-decay-val">{{ cls.estimatedWeeksToLevel < 999 ? '~' + cls.estimatedWeeksToLevel + ' wks to level' : 'See sheet' }}</span>
        </div>
      </div>
    </div>

    <!-- Scrollable abilities area -->
    <div class="sp-abilities-scroll">

      <!-- ULTIMATE ABILITIES -->
      <ng-container *ngIf="ultimateSkills().length">
        <div class="sp-section-hdr">ULTIMATE ABILITIES</div>
        <ng-container *ngFor="let sId of ultimateSkills()">
          <div class="sp-skill-row"
               [class.row-locked]="!isUnlocked(sId)"
               [class.row-selected]="selectedSkillId() === sId"
               [style.--accent]="barColor(activeBarId())"
               (click)="onSkillClick(sId)">
            <button class="sp-pin-btn" [class.pin-locked]="!isUnlocked(sId)"
                    (click)="$event.stopPropagation(); pinSkill(sId, true)">+</button>
            <div class="sp-row-icon-ring">
              <img *ngIf="getIconSrc(sId)" [src]="getIconSrc(sId)!" class="sp-row-icon-img" [alt]="getSkill(sId)?.name"/>
              <span *ngIf="!getIconSrc(sId)" class="sp-row-icon-em">{{ getSkill(sId)?.icon ?? '◆' }}</span>
            </div>
            <div class="sp-row-body">
              <span class="sp-row-name">{{ getSkill(sId)?.name }} {{ tierLabel(getSkill(sId)?.tier) }}</span>
              <div class="sp-row-xp-track">
                <div class="sp-row-xp-fill" [style.width.%]="isUnlocked(sId) ? 100 : 0"
                     [style.background]="barColor(activeBarId())"></div>
              </div>
            </div>
          </div>
          <!-- Inline detail strip -->
          <div *ngIf="selectedSkillId() === sId && selectedSkill() as sk"
               class="sp-inline-detail"
               [style.--accent]="barColor(activeBarId())"
               [style.--accent-border]="barColorBorder(activeBarId())">
            <p class="sid-desc">{{ sk.description }}</p>
            <div class="sid-stats">
              <span class="sid-stat"><span class="sid-lbl">TYPE</span><span class="sid-val">{{ sk.type | uppercase }}</span></span>
              <span class="sid-stat"><span class="sid-lbl">INTENSITY</span><span class="sid-val intensity-badge" [ngClass]="'ib-'+sk.intensity">{{ sk.intensity | uppercase }}</span></span>
              <span *ngIf="sk.willpowerCost > 0" class="sid-stat"><span class="sid-lbl">WP COST</span><span class="sid-val sid-cost">−{{ sk.willpowerCost }}</span></span>
              <span *ngIf="sk.willpowerRegen > 0" class="sid-stat"><span class="sid-lbl">WP REGEN</span><span class="sid-val sid-regen">+{{ sk.willpowerRegen }}</span></span>
            </div>
            <div class="sid-actions">
              <button class="sid-btn-unlock" *ngIf="!isUnlocked(sk.id)" (click)="unlockSkill(sk.id)">🔓 Unlock</button>
              <button class="sid-btn-lock"   *ngIf="isUnlocked(sk.id)"  (click)="lockSkill(sk.id)">🔒 Reset</button>
              <button class="sid-btn-close" (click)="selectedSkillId.set(null)">✕ Close</button>
            </div>
          </div>
        </ng-container>
      </ng-container>

      <!-- ACTIVE ABILITIES -->
      <ng-container *ngIf="activeSkills().length">
        <div class="sp-section-hdr">ACTIVE ABILITIES</div>
        <ng-container *ngFor="let sId of activeSkills()">
          <div class="sp-skill-row"
               [class.row-locked]="!isUnlocked(sId)"
               [class.row-selected]="selectedSkillId() === sId"
               [style.--accent]="barColor(activeBarId())"
               (click)="onSkillClick(sId)">
            <button class="sp-pin-btn" [class.pin-locked]="!isUnlocked(sId)"
                    (click)="$event.stopPropagation(); pinSkill(sId, false)">+</button>
            <div class="sp-row-icon-ring">
              <img *ngIf="getIconSrc(sId)" [src]="getIconSrc(sId)!" class="sp-row-icon-img" [alt]="getSkill(sId)?.name"/>
              <span *ngIf="!getIconSrc(sId)" class="sp-row-icon-em">{{ getSkill(sId)?.icon ?? '◆' }}</span>
            </div>
            <div class="sp-row-body">
              <span class="sp-row-name">{{ getSkill(sId)?.name }} {{ tierLabel(getSkill(sId)?.tier) }}</span>
              <div class="sp-row-xp-track">
                <div class="sp-row-xp-fill" [style.width.%]="isUnlocked(sId) ? 100 : 0"
                     [style.background]="barColor(activeBarId())"></div>
              </div>
            </div>
          </div>
          <!-- Inline detail strip -->
          <div *ngIf="selectedSkillId() === sId && selectedSkill() as sk"
               class="sp-inline-detail"
               [style.--accent]="barColor(activeBarId())"
               [style.--accent-border]="barColorBorder(activeBarId())">
            <p class="sid-desc">{{ sk.description }}</p>
            <div class="sid-stats">
              <span class="sid-stat"><span class="sid-lbl">TYPE</span><span class="sid-val">{{ sk.type | uppercase }}</span></span>
              <span class="sid-stat"><span class="sid-lbl">INTENSITY</span><span class="sid-val intensity-badge" [ngClass]="'ib-'+sk.intensity">{{ sk.intensity | uppercase }}</span></span>
              <span *ngIf="sk.willpowerCost > 0" class="sid-stat"><span class="sid-lbl">WP COST</span><span class="sid-val sid-cost">−{{ sk.willpowerCost }}</span></span>
              <span *ngIf="sk.willpowerRegen > 0" class="sid-stat"><span class="sid-lbl">WP REGEN</span><span class="sid-val sid-regen">+{{ sk.willpowerRegen }}</span></span>
            </div>
            <div class="sid-actions">
              <button class="sid-btn-unlock" *ngIf="!isUnlocked(sk.id)" (click)="unlockSkill(sk.id)">🔓 Unlock</button>
              <button class="sid-btn-lock"   *ngIf="isUnlocked(sk.id)"  (click)="lockSkill(sk.id)">🔒 Reset</button>
              <button class="sid-btn-close" (click)="selectedSkillId.set(null)">✕ Close</button>
            </div>
          </div>
        </ng-container>
      </ng-container>

      <!-- PASSIVE ABILITIES -->
      <ng-container *ngIf="passiveSkills().length">
        <div class="sp-section-hdr">PASSIVE ABILITIES</div>
        <ng-container *ngFor="let sId of passiveSkills()">
          <div class="sp-skill-row sp-skill-row-passive"
               [class.row-locked]="!isUnlocked(sId)"
               [class.row-selected]="selectedSkillId() === sId"
               [style.--accent]="barColor(activeBarId())"
               (click)="onSkillClick(sId)">
            <div class="sp-pin-spacer"></div>
            <div class="sp-row-icon-ring sp-row-icon-passive">
              <img *ngIf="getIconSrc(sId)" [src]="getIconSrc(sId)!" class="sp-row-icon-img" [alt]="getSkill(sId)?.name"/>
              <span *ngIf="!getIconSrc(sId)" class="sp-row-icon-em">{{ getSkill(sId)?.icon ?? '◆' }}</span>
            </div>
            <div class="sp-row-body">
              <div class="sp-row-passive-line">
                <span class="sp-row-name">{{ getSkill(sId)?.name }}</span>
                <span class="sp-row-passive-rank">({{ isUnlocked(sId) ? tierLabel(getSkill(sId)?.tier) : '0' }}/{{ tierLabel(getSkill(sId)?.tier) }})</span>
              </div>
            </div>
          </div>
          <!-- Inline detail strip -->
          <div *ngIf="selectedSkillId() === sId && selectedSkill() as sk"
               class="sp-inline-detail"
               [style.--accent]="barColor(activeBarId())"
               [style.--accent-border]="barColorBorder(activeBarId())">
            <p class="sid-desc">{{ sk.description }}</p>
            <div class="sid-stats">
              <span class="sid-stat"><span class="sid-lbl">TYPE</span><span class="sid-val">{{ sk.type | uppercase }}</span></span>
              <span *ngIf="sk.willpowerRegen > 0" class="sid-stat"><span class="sid-lbl">WP REGEN</span><span class="sid-val sid-regen">+{{ sk.willpowerRegen }}</span></span>
            </div>
            <div class="sid-actions">
              <button class="sid-btn-unlock" *ngIf="!isUnlocked(sk.id)" (click)="unlockSkill(sk.id)">🔓 Unlock</button>
              <button class="sid-btn-lock"   *ngIf="isUnlocked(sk.id)"  (click)="lockSkill(sk.id)">🔒 Reset</button>
              <button class="sid-btn-close" (click)="selectedSkillId.set(null)">✕ Close</button>
            </div>
          </div>
        </ng-container>
      </ng-container>

      <!-- Combos -->
      <div class="sp-combos-section" *ngIf="activeCombos().length > 0">
        <div class="sp-combos-header">
          <span class="sp-combos-icon">⚡</span>
          <span class="sp-combos-title">Skill Chains</span>
          <span class="sp-combos-sub">Execute these sequences for bonus XP</span>
        </div>
        <div class="sp-combos-grid">
          <div *ngFor="let combo of activeCombos()"
               class="sp-combo-card"
               [style.--accent]="barColor(activeBarId())"
               [style.--accent-border]="barColorBorder(activeBarId())">
            <div class="sp-combo-sequence">
              <ng-container *ngFor="let sid of combo.skillIds; let last = last">
                <div class="sp-combo-skill" [class.sp-combo-skill-locked]="!isUnlocked(sid)">
                  <span class="sp-combo-skill-icon">{{ getSkill(sid)?.icon ?? '?' }}</span>
                  <span class="sp-combo-skill-name">{{ getSkill(sid)?.name ?? sid }}</span>
                </div>
                <span class="sp-combo-arrow" *ngIf="!last">→</span>
              </ng-container>
            </div>
            <div class="sp-combo-info">
              <span class="sp-combo-name">{{ combo.name }}</span>
              <span class="sp-combo-xp">+{{ combo.bonusXp }} XP</span>
            </div>
            <p class="sp-combo-desc">{{ combo.description }}</p>
          </div>
        </div>
      </div>

    </div><!-- end sp-abilities-scroll -->

    <!-- ── ACTION BAR ──────────────────────────────────────────── -->
    <div class="sp-action-bar" [style.--accent]="barColor(activeBarId())" [style.--accent-border]="barColorBorder(activeBarId())">
      <span class="sp-bar-label">ACTION BAR</span>
      <div class="sp-bar-slots">
        <div *ngFor="let i of barSlotIndices"
             class="sp-bar-slot"
             [class.slot-filled]="!!actionBar()[i]"
             [title]="actionBar()[i] ? 'Click to remove' : 'Unlock a skill and press + to assign'"
             (click)="removeFromBar(i)">
          <ng-container *ngIf="getBarSlot(i) as sk">
            <img *ngIf="getIconSrc(sk.id)" [src]="getIconSrc(sk.id)!" class="sp-bar-img" [alt]="sk.name"/>
            <span *ngIf="!getIconSrc(sk.id)" class="sp-bar-em">{{ sk.icon }}</span>
          </ng-container>
          <span *ngIf="!actionBar()[i]" class="sp-bar-empty">◆</span>
          <span class="sp-bar-num">{{ i + 1 }}</span>
        </div>

        <div class="sp-bar-sep">|</div>

        <!-- Ultimate slot -->
        <div class="sp-bar-slot sp-bar-ultimate"
             [class.slot-filled]="!!actionBar()[5]"
             [title]="actionBar()[5] ? 'Click to remove' : 'Pin an Ultimate ability'"
             (click)="removeFromBar(5)">
          <ng-container *ngIf="getBarSlot(5) as sk">
            <img *ngIf="getIconSrc(sk.id)" [src]="getIconSrc(sk.id)!" class="sp-bar-img" [alt]="sk.name"/>
            <span *ngIf="!getIconSrc(sk.id)" class="sp-bar-em">{{ sk.icon }}</span>
          </ng-container>
          <span *ngIf="!actionBar()[5]" class="sp-bar-empty">◆</span>
          <span class="sp-bar-num">R</span>
        </div>
      </div>
    </div>

  </main>
</div>
  `,
  styles: [`
    :host { display: block; width: 100%; }

    /* ── Root ──────────────────────────────────────────────────── */
    .sp-root {
      display: flex;
      height: calc(100vh - 68px - 60px);
      min-height: 480px;
      overflow: hidden;
      background: rgba(8,6,2,0.98);
    }

    /* ── Sidebar ───────────────────────────────────────────────── */
    .sp-sidebar {
      width: 196px; flex-shrink: 0;
      display: flex; flex-direction: column;
      background: rgba(6,5,2,0.98);
      border-right: 1px solid rgba(201,168,76,0.18);
      overflow-y: auto;
    }
    .sp-sidebar-header {
      display: flex; align-items: center; gap: 8px;
      padding: 14px 14px 10px;
      border-bottom: 1px solid rgba(201,168,76,0.12);
    }
    .sp-sidebar-ornament { color: rgba(201,168,76,0.55); font-size: 14px; }
    .sp-sidebar-title {
      font-family: 'Cinzel', serif; font-size: 10px;
      color: rgba(168,145,88,0.65); letter-spacing: 1.5px; text-transform: uppercase;
    }
    .sp-category-list { flex: 1; padding: 6px 0; }
    .sp-category-btn {
      display: flex; align-items: center; gap: 8px;
      width: 100%; padding: 9px 14px 9px 12px;
      background: transparent; border: none;
      border-left: 3px solid transparent;
      cursor: pointer; transition: all 0.14s; position: relative; text-align: left;
    }
    .sp-category-btn:hover {
      background: var(--accent-dim, rgba(201,168,76,0.07));
      border-left-color: var(--accent-border, rgba(201,168,76,0.3));
    }
    .sp-category-active {
      background: var(--accent-dim, rgba(201,168,76,0.10)) !important;
      border-left-color: var(--accent, rgba(201,168,76,0.8)) !important;
    }
    .sp-cat-icon { font-size: 16px; opacity: 0.75; flex-shrink: 0; }
    .sp-cat-name {
      font-family: 'Cinzel', serif; font-size: 10px;
      color: rgba(168,145,88,0.65); letter-spacing: 0.4px; flex: 1; transition: color 0.14s;
    }
    .sp-category-active .sp-cat-name { color: rgba(242,201,106,0.95) !important; }
    .sp-cat-count { font-size: 9px; color: rgba(168,145,88,0.4); font-family: monospace; flex-shrink: 0; }
    .sp-cat-count-full { color: rgba(111,207,151,0.65) !important; }
    .sp-cat-chevron { position: absolute; right: 6px; font-size: 7px; color: var(--accent, rgba(201,168,76,0.7)); }
    .sp-sidebar-footer { padding: 12px 14px; border-top: 1px solid rgba(201,168,76,0.10); }
    .sp-total-label {
      display: block; font-size: 8.5px; color: rgba(168,145,88,0.45);
      letter-spacing: 0.8px; text-transform: uppercase; font-family: 'Cinzel', serif; margin-bottom: 4px;
    }
    .sp-total-val {
      display: block; font-family: 'Cinzel', serif;
      font-size: 13px; color: rgba(201,168,76,0.75); margin-bottom: 6px;
    }
    .sp-total-bar-track { height: 3px; background: rgba(201,168,76,0.10); }
    .sp-total-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, rgba(201,168,76,0.5), rgba(242,201,106,0.75));
      transition: width 0.4s ease;
    }

    /* ── Main ──────────────────────────────────────────────────── */
    .sp-main {
      flex: 1; display: flex; flex-direction: column; overflow: hidden;
    }

    /* Skill line header */
    .sp-line-header {
      display: flex; align-items: center; gap: 14px;
      padding: 12px 20px 10px; flex-shrink: 0;
      border-bottom: 1px solid var(--accent-border, rgba(201,168,76,0.22));
      background: linear-gradient(180deg, rgba(14,11,4,0.98), rgba(10,8,3,0.95));
    }
    .sp-line-level {
      font-family: 'Cinzel', serif; font-size: 40px; font-weight: 700;
      color: var(--accent, rgba(242,201,106,0.90));
      line-height: 1; flex-shrink: 0; min-width: 48px;
      text-shadow: 0 0 22px var(--accent-border, rgba(201,168,76,0.3));
    }
    .sp-line-info { flex: 1; }
    .sp-line-name {
      margin: 0 0 5px; font-family: 'Cinzel', serif; font-size: 17px;
      font-weight: 700; letter-spacing: 2.5px; color: rgba(242,201,106,0.95);
      text-shadow: 0 0 16px rgba(201,168,76,0.2);
    }
    .sp-line-xp-track {
      height: 5px; background: rgba(201,168,76,0.08);
      border: 1px solid rgba(201,168,76,0.12);
    }
    .sp-line-xp-fill { height: 100%; transition: width 0.5s ease; min-width: 2px; }
    .sp-assignment-lbl {
      font-family: 'Cinzel', serif; font-size: 9px;
      color: rgba(168,145,88,0.45); letter-spacing: 1.5px; text-transform: uppercase; flex-shrink: 0;
    }

    /* ── Decay strip ───────────────────────────────────────────── */
    .sp-decay-strip {
      display: flex; align-items: center; flex-shrink: 0;
      padding: 7px 20px;
      background: rgba(10,8,3,0.98);
      border-bottom: 1px solid var(--accent-border, rgba(201,168,76,0.18));
    }
    .sp-decay-strip[data-rust="rusty"]      { border-bottom-color: rgba(242,201,106,0.35); }
    .sp-decay-strip[data-rust="very-rusty"] { border-bottom-color: rgba(235,87,87,0.40); }
    .sp-decay-item {
      display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
    }
    .sp-decay-sep {
      width: 1px; height: 28px; flex-shrink: 0;
      background: rgba(201,168,76,0.12); margin: 0 8px;
    }
    .sp-decay-icon { font-size: 13px; flex-shrink: 0; line-height: 1; }
    .sp-decay-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .sp-decay-lbl {
      font-size: 7px; letter-spacing: 0.8px;
      color: rgba(168,145,88,0.45); font-family: 'Cinzel', serif; text-transform: uppercase; white-space: nowrap;
    }
    .sp-decay-val {
      font-family: 'Cinzel', serif; font-size: 10px;
      color: rgba(201,168,76,0.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* Scrollable abilities area */
    .sp-abilities-scroll { flex: 1; overflow-y: auto; padding-bottom: 8px; }

    /* Section headers */
    .sp-section-hdr {
      padding: 9px 20px 6px;
      font-family: 'Cinzel', serif; font-size: 10px; font-weight: 700;
      letter-spacing: 2px; color: rgba(168,145,88,0.55); text-transform: uppercase;
      border-bottom: 1px solid rgba(201,168,76,0.08);
      background: rgba(201,168,76,0.02);
    }

    /* ── Skill Row ─────────────────────────────────────────────── */
    .sp-skill-row {
      display: flex; align-items: center; gap: 10px;
      padding: 7px 18px 7px 14px;
      border-bottom: 1px solid rgba(201,168,76,0.05);
      cursor: pointer; transition: background 0.12s;
    }
    .sp-skill-row:hover { background: rgba(201,168,76,0.05); }
    .sp-skill-row.row-selected {
      background: rgba(201,168,76,0.10);
      border-left: 3px solid var(--accent, rgba(201,168,76,0.7));
      padding-left: 11px;
    }
    .sp-skill-row.row-locked { opacity: 0.45; }

    /* + pin button */
    .sp-pin-btn {
      width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%;
      background: transparent; border: 1px solid var(--accent, rgba(201,168,76,0.5));
      color: var(--accent, rgba(201,168,76,0.85)); font-size: 14px; line-height: 1;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: background 0.12s, color 0.12s; padding: 0;
    }
    .sp-pin-btn:hover:not(.pin-locked) {
      background: var(--accent, rgba(201,168,76,0.85));
      color: rgba(8,6,2,0.95);
    }
    .sp-pin-btn.pin-locked {
      border-color: rgba(168,145,88,0.20);
      color: rgba(168,145,88,0.25); cursor: default;
    }
    .sp-pin-spacer { width: 22px; height: 22px; flex-shrink: 0; }

    /* Icon circle */
    .sp-row-icon-ring {
      width: 46px; height: 46px; flex-shrink: 0; border-radius: 50%;
      background: rgba(0,0,0,0.55); border: 2px solid rgba(201,168,76,0.22);
      display: flex; align-items: center; justify-content: center; overflow: hidden;
    }
    .sp-row-icon-ring.sp-row-icon-passive {
      width: 36px; height: 36px;
    }
    .row-selected .sp-row-icon-ring {
      border-color: var(--accent, rgba(201,168,76,0.7));
      box-shadow: 0 0 10px var(--accent, rgba(201,168,76,0.25));
    }
    .row-locked .sp-row-icon-ring {
      background: rgba(0,0,0,0.82);
      border-color: rgba(168,145,88,0.12);
      filter: grayscale(0.6);
    }
    .sp-row-icon-img {
      width: 28px; height: 28px;
      filter: invert(79%) sepia(52%) saturate(338%) hue-rotate(357deg) brightness(95%) contrast(85%);
      opacity: 0.85;
    }
    .row-locked .sp-row-icon-img { filter: invert(100%) brightness(0.25); opacity: 0.35; }
    .sp-row-icon-passive .sp-row-icon-img { width: 22px; height: 22px; }
    .sp-row-icon-em { font-size: 24px; line-height: 1; }
    .sp-row-icon-passive .sp-row-icon-em { font-size: 18px; }

    /* Skill body (name + xp bar) */
    .sp-row-body { flex: 1; min-width: 0; }
    .sp-row-name {
      display: block; font-family: 'Cinzel', serif; font-size: 12px;
      color: rgba(201,168,76,0.75); letter-spacing: 0.5px; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; margin-bottom: 5px;
    }
    .row-selected .sp-row-name { color: rgba(242,201,106,0.95); }
    .row-locked .sp-row-name { color: rgba(168,145,88,0.40); }
    .sp-row-xp-track {
      height: 4px; background: rgba(60,60,40,0.4);
      border: 1px solid rgba(201,168,76,0.08); border-radius: 2px;
    }
    .sp-row-xp-fill {
      height: 100%; border-radius: 2px;
      transition: width 0.4s ease; min-width: 0;
      box-shadow: 0 0 6px currentColor;
    }

    /* Passive row variant */
    .sp-skill-row-passive { padding-top: 5px; padding-bottom: 5px; }
    .sp-row-passive-line { display: flex; align-items: baseline; gap: 6px; }
    .sp-row-passive-rank { font-size: 10px; color: rgba(168,145,88,0.45); font-family: monospace; }

    /* ── Inline detail strip ───────────────────────────────────── */
    .sp-inline-detail {
      margin: 0 18px 6px 46px;
      padding: 10px 14px;
      background: linear-gradient(135deg, rgba(18,15,7,0.98), rgba(12,9,4,0.99));
      border: 1px solid var(--accent-border, rgba(201,168,76,0.25));
      animation: detail-in 0.14s ease;
    }
    @keyframes detail-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .sid-desc {
      font-size: 11.5px; color: rgba(200,185,155,0.72); line-height: 1.55;
      margin: 0 0 8px; font-style: italic;
    }
    .sid-stats { display: flex; flex-wrap: wrap; gap: 6px 20px; margin-bottom: 10px; }
    .sid-stat { display: flex; flex-direction: column; gap: 1px; }
    .sid-lbl {
      font-size: 7.5px; letter-spacing: 1px; color: rgba(168,145,88,0.45);
      font-family: 'Cinzel', serif; text-transform: uppercase;
    }
    .sid-val { font-size: 10.5px; color: rgba(201,168,76,0.75); }
    .sid-cost  { color: rgba(207,111,111,0.85); }
    .sid-regen { color: rgba(111,207,151,0.85); }
    .intensity-badge { font-size: 10px; font-weight: 700; letter-spacing: 0.5px; }
    .ib-routine  { color: rgba(168,145,88,0.75); }
    .ib-moderate { color: rgba(242,201,106,0.85); }
    .ib-complex  { color: rgba(235,87,87,0.90); }
    .sid-actions { display: flex; gap: 8px; }
    .sid-btn-unlock, .sid-btn-lock, .sid-btn-close {
      font-family: 'Cinzel', serif; font-size: 9px; letter-spacing: 0.5px;
      padding: 4px 12px; cursor: pointer; border: 1px solid; background: transparent;
      transition: all 0.12s;
    }
    .sid-btn-unlock { color: rgba(111,207,151,0.85); border-color: rgba(111,207,151,0.35); }
    .sid-btn-unlock:hover { background: rgba(111,207,151,0.10); }
    .sid-btn-lock { color: rgba(168,145,88,0.5); border-color: rgba(168,145,88,0.2); }
    .sid-btn-lock:hover { background: rgba(235,87,87,0.08); color: rgba(235,87,87,0.75); border-color: rgba(235,87,87,0.3); }
    .sid-btn-close { color: rgba(168,145,88,0.4); border-color: rgba(168,145,88,0.15); margin-left: auto; }
    .sid-btn-close:hover { color: rgba(201,168,76,0.75); border-color: rgba(201,168,76,0.25); }

    /* ── Combos ────────────────────────────────────────────────── */
    .sp-combos-section {
      margin: 12px 16px 8px;
      border: 1px solid rgba(201,168,76,0.12);
      background: rgba(10,8,3,0.96); flex-shrink: 0;
    }
    .sp-combos-header {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 14px; border-bottom: 1px solid rgba(201,168,76,0.10);
      background: rgba(201,168,76,0.04);
    }
    .sp-combos-icon { font-size: 14px; }
    .sp-combos-title {
      font-family: 'Cinzel', serif; font-size: 10px;
      color: rgba(201,168,76,0.65); letter-spacing: 1.2px; text-transform: uppercase; flex: 1;
    }
    .sp-combos-sub { font-size: 9px; color: rgba(168,145,88,0.4); font-style: italic; }
    .sp-combos-grid { display: flex; flex-wrap: wrap; }
    .sp-combo-card {
      flex: 1; min-width: 220px; padding: 10px 14px;
      border-right: 1px solid rgba(201,168,76,0.08);
      border-bottom: 1px solid rgba(201,168,76,0.08);
      transition: background 0.14s;
    }
    .sp-combo-card:hover { background: rgba(201,168,76,0.04); }
    .sp-combo-sequence { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 5px; }
    .sp-combo-skill {
      display: flex; align-items: center; gap: 3px;
      padding: 2px 7px 2px 5px; background: rgba(201,168,76,0.07);
      border: 1px solid rgba(201,168,76,0.18);
    }
    .sp-combo-skill-locked { opacity: 0.40; filter: grayscale(0.5); border-color: rgba(168,145,88,0.15); }
    .sp-combo-skill-icon { font-size: 13px; line-height: 1; }
    .sp-combo-skill-name { font-family: 'Cinzel', serif; font-size: 8px; color: rgba(201,168,76,0.7); letter-spacing: 0.2px; }
    .sp-combo-arrow { font-size: 10px; color: rgba(168,145,88,0.4); }
    .sp-combo-info { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
    .sp-combo-name { font-family: 'Cinzel', serif; font-size: 10px; color: rgba(201,168,76,0.80); letter-spacing: 0.4px; }
    .sp-combo-xp { font-size: 9px; color: rgba(111,207,151,0.75); font-weight: 700; }
    .sp-combo-desc { font-size: 9.5px; color: rgba(168,145,88,0.50); margin: 0; line-height: 1.4; font-style: italic; }

    /* ── Action Bar ────────────────────────────────────────────── */
    .sp-action-bar {
      flex-shrink: 0; display: flex; align-items: center; gap: 12px;
      padding: 10px 20px; height: 66px;
      background: linear-gradient(180deg, rgba(8,6,2,0.98), rgba(14,11,4,0.99));
      border-top: 1px solid var(--accent-border, rgba(201,168,76,0.2));
    }
    .sp-bar-label {
      font-family: 'Cinzel', serif; font-size: 8px; letter-spacing: 1.5px;
      color: rgba(168,145,88,0.40); text-transform: uppercase; flex-shrink: 0;
    }
    .sp-bar-slots { display: flex; align-items: center; gap: 4px; }
    .sp-bar-slot {
      position: relative; width: 46px; height: 46px;
      background: rgba(0,0,0,0.60);
      border: 1px solid rgba(201,168,76,0.20);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: border-color 0.14s, box-shadow 0.14s;
      overflow: hidden;
    }
    .sp-bar-slot:hover { border-color: rgba(201,168,76,0.45); }
    .sp-bar-slot.slot-filled {
      border-color: var(--accent, rgba(201,168,76,0.55));
      box-shadow: inset 0 0 12px rgba(201,168,76,0.08);
    }
    .sp-bar-slot.slot-filled:hover {
      border-color: rgba(235,87,87,0.55);
      box-shadow: inset 0 0 12px rgba(235,87,87,0.10);
    }
    .sp-bar-ultimate {
      border-color: rgba(235,87,87,0.25) !important;
    }
    .sp-bar-ultimate.slot-filled { border-color: rgba(235,87,87,0.60) !important; }
    .sp-bar-img {
      width: 28px; height: 28px;
      filter: invert(79%) sepia(52%) saturate(338%) hue-rotate(357deg) brightness(95%) contrast(85%);
      opacity: 0.85;
    }
    .sp-bar-em { font-size: 22px; line-height: 1; }
    .sp-bar-empty { font-size: 10px; color: rgba(201,168,76,0.15); }
    .sp-bar-num {
      position: absolute; bottom: 1px; right: 3px;
      font-size: 8px; font-family: monospace;
      color: rgba(168,145,88,0.45); line-height: 1; pointer-events: none;
    }
    .sp-bar-ultimate .sp-bar-num { color: rgba(235,87,87,0.55); }
    .sp-bar-sep { font-size: 18px; color: rgba(168,145,88,0.2); padding: 0 2px; user-select: none; }

    /* ── Mobile: stack category sidebar above skill rows ── */
    @media (max-width: 480px) {
      .sp-root    { flex-direction: column; height: auto; min-height: unset; overflow: visible; }
      .sp-sidebar { width: 100%; height: 180px; flex-shrink: 0; border-right: none;
                    border-bottom: 1px solid rgba(201,168,76,0.18); }
      .sp-main    { flex: 1; min-height: 360px; overflow: hidden; }
    }
  `],
})
export class SkillsPanelComponent implements OnInit, OnDestroy {
  private readonly unlock    = inject(SkillUnlockService);
  private readonly http      = inject(HttpClient);
  protected readonly rotColor = inject(RotColorService);

  readonly skillTreeData   = signal<SkillTreeStat[]>([]);
  private treeSub?: Subscription;

  readonly activeClassStat = computed<SkillTreeStat | null>(() => {
    const classId = BAR_TO_CLASS[this.activeBarId()];
    if (!classId) return null;
    return this.skillTreeData().find(t => t.id === classId) ?? null;
  });

  protected readonly allBars    = SKILL_BARS;
  protected readonly totalSkills = ALL_SKILLS.length;

  protected readonly activeBarId      = signal<string>(SKILL_BARS[0].id);
  protected readonly selectedSkillId  = signal<string | null>(null);

  /** Action bar: slots 0-4 regular, slot 5 = Ultimate */
  protected readonly actionBar = signal<(string | null)[]>([null, null, null, null, null, null]);

  /** Fixed indices for ngFor over action bar regular slots */
  protected readonly barSlotIndices = [0, 1, 2, 3, 4];

  protected readonly activeBar = computed<SkillBar>(
    () => SKILL_BARS.find(b => b.id === this.activeBarId()) ?? SKILL_BARS[0]
  );

  protected readonly selectedSkill = computed<Skill | null>(
    () => { const id = this.selectedSkillId(); return id ? (SKILL_MAP.get(id) ?? null) : null; }
  );

  protected readonly activeCombos = computed<ComboDefinition[]>(
    () => COMBOS.filter(c => c.category === this.activeBarId())
  );

  protected readonly totalUnlocked = computed<number>(
    () => ALL_SKILLS.filter(s => this.unlock.isUnlocked(s.id)).length
  );

  // ── Section grouping (by intensity) ────────────────────────────────────
  protected readonly ultimateSkills = computed<string[]>(
    () => this.activeBar().skills.filter(id => this.getSkill(id)?.intensity === 'complex')
  );

  protected readonly activeSkills = computed<string[]>(
    () => this.activeBar().skills.filter(id => this.getSkill(id)?.intensity === 'moderate')
  );

  protected readonly passiveSkills = computed<string[]>(
    () => this.activeBar().skills.filter(id => this.getSkill(id)?.intensity === 'routine')
  );

  // ── Skill line level + XP bar ──────────────────────────────────────────
  protected readonly lineXpPct = computed<number>(() => {
    const bar = this.activeBar();
    if (!bar.skills.length) return 0;
    return Math.round((this.unlockedCount(bar) / bar.skills.length) * 100);
  });

  protected readonly lineLevel = computed<number>(() =>
    Math.floor((this.lineXpPct() / 100) * 50)
  );

  // ── Helpers ──────────────────────────────────────────────────────────────
  protected getSkill(id: string): Skill | undefined { return SKILL_MAP.get(id); }
  protected isUnlocked(id: string): boolean         { return this.unlock.isUnlocked(id); }
  protected unlockedCount(bar: SkillBar): number    { return bar.skills.filter(id => this.unlock.isUnlocked(id)).length; }
  protected tierLabel(tier?: string): string        { return tier ? (TIER_LABEL[tier] ?? '') : ''; }
  protected getIconSrc(skillId: string): string | undefined { return SKILL_ICON_SRC[skillId]; }
  protected barColor(id: string):       string { return BAR_COLOR[id]        ?? 'rgba(201,168,76,0.80)'; }
  protected barColorDim(id: string):    string { return BAR_COLOR_DIM[id]    ?? 'rgba(201,168,76,0.10)'; }
  protected barColorBorder(id: string): string { return BAR_COLOR_BORDER[id] ?? 'rgba(201,168,76,0.35)'; }

  protected progressFillColor(barId: string): string {
    const bar = SKILL_BARS.find(b => b.id === barId);
    if (!bar) return BAR_COLOR[barId] ?? 'rgba(201,168,76,0.80)';
    const unlocked = bar.skills.filter(id => this.unlock.isUnlocked(id)).length;
    const pct = bar.skills.length > 0 ? unlocked / bar.skills.length : 0;
    const base = BAR_BASE_RGB[barId] ?? [201, 168, 76];
    return this.rotColor.xpBarColor(base, pct);
  }

  // ── Action bar ────────────────────────────────────────────────────────────
  protected pinSkill(skillId: string, isUltimate = false): void {
    const bar = [...this.actionBar()];
    if (isUltimate) {
      bar[5] = skillId;
    } else {
      const slot = bar.findIndex((s, i) => s === null && i < 5);
      if (slot < 0) return; // all regular slots full
      bar[slot] = skillId;
    }
    this.actionBar.set(bar);
  }

  protected removeFromBar(slot: number): void {
    if (!this.actionBar()[slot]) return;
    const bar = [...this.actionBar()];
    bar[slot] = null;
    this.actionBar.set(bar);
  }

  protected getBarSlot(slot: number): Skill | null {
    const id = this.actionBar()[slot];
    return id ? (SKILL_MAP.get(id) ?? null) : null;
  }

  // ── Interactions ──────────────────────────────────────────────────────────
  protected selectBar(barId: string): void {
    this.activeBarId.set(barId);
    this.selectedSkillId.set(null);
  }

  protected onSkillClick(skillId: string): void {
    if (!this.unlock.isUnlocked(skillId)) {
      this.unlock.unlock(skillId);
    }
    this.selectedSkillId.set(
      this.selectedSkillId() === skillId ? null : skillId
    );
  }

  protected unlockSkill(id: string): void { this.unlock.unlock(id); }
  protected lockSkill(id: string):   void { this.unlock.lock(id); }

  ngOnInit(): void {
    this.treeSub = this.http
      .get<SkillTreeStat[]>(`${environment.apiUrl}/api/character/skill-trees`)
      .subscribe({ next: data => this.skillTreeData.set(data ?? []) });
  }

  ngOnDestroy(): void { this.treeSub?.unsubscribe(); }

  protected rustStatusIcon(status?: string): string {
    if (status === 'sharp')      return '✅';
    if (status === 'rusty')      return '⚠️';
    if (status === 'very-rusty') return '🔴';
    return '⏸️';
  }

  protected rustStatusLabel(status?: string): string {
    if (status === 'sharp')      return 'Sharp';
    if (status === 'rusty')      return 'Rusty';
    if (status === 'very-rusty') return 'Very Rusty';
    return 'N/A';
  }

  protected rustStatusColor(status?: string): string {
    if (status === 'sharp')      return 'rgba(111,207,151,0.85)';
    if (status === 'rusty')      return 'rgba(242,201,106,0.85)';
    if (status === 'very-rusty') return 'rgba(235,87,87,0.85)';
    return 'rgba(168,145,88,0.55)';
  }
}
