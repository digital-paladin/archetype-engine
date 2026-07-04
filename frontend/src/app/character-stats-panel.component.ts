import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

interface SkillTreeStat {
  id: string;
  name: string;
  level: number;
  currentXP: number;
  xpToNextLevel: number;
  percentToNext: number;
  tier: string;
  rustStatus?: string;
}

interface AcmMetrics {
  pleasureCapacity: number;
  mentalClarity: number;
  physicalVitality: number;
  spiritualAlignment: number;
  lastUpdated: string;
}

interface RpgLift {
  value: string;
  numericValue?: number;
  target?: string;
}

interface OverallLevelInfo {
  level: number;
  nextLevel: number;
  nextLevelDate: string;
  daysRemaining: number;
}

interface CharStatsResponse {
  sageStreak: number;
  acmMetrics?: AcmMetrics;
  rpgStats?: { squat: RpgLift; deadlift: RpgLift; benchPress: RpgLift; overheadPress?: RpgLift; };
  skillTrees?: SkillTreeStat[];
  overallLevelInfo?: OverallLevelInfo;
}

const CLASS_ICONS: Record<string, string> = {
  developer:            '💻',
  sage:                 '🙏',
  warrior:              '⚔️',
  artist:               '🎨',
  redteamer:            '🕵️',
  'financial strategist': '💰',
  survivalist:          '🛌'
};

const TIER_CLASS: Record<string, string> = {
  'Grandmaster': 'tier-gm',
  'Master':      'tier-master',
  'Expert':      'tier-expert',
  'Adept':       'tier-adept',
  'Novice':      'tier-novice',
  'Foundation':  'tier-novice',
};

@Component({
  selector: 'app-character-stats-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="cs-root">

  <!-- Loading -->
  <div *ngIf="isLoading()" class="cs-loading">◈ Loading character data...</div>

  <ng-container *ngIf="!isLoading()">

    <!-- ── BACKGROUND ──────────────────────────────────────────── -->
    <div class="cs-section">

      <!-- Character banner -->
      <div class="cs-char-banner">
        <span class="cs-char-glyph">⚔</span>
        <div class="cs-char-info">
          <div class="cs-char-name">Digital Paladin</div>
          <div class="cs-char-class">
            {{ primaryClass()?.name ?? 'Adventurer' }}
            <span *ngIf="primaryClass()"> — Level {{ primaryClass()!.level }}</span>
          </div>
        </div>
        <div class="cs-equip-bonus">
          <span class="cs-equip-label">Equipment Bonus</span>
          <div class="cs-equip-stars">
            <span *ngFor="let s of equipStars()" class="cs-star filled">★</span>
            <span *ngFor="let s of equipEmpty()" class="cs-star empty">☆</span>
          </div>
        </div>
      </div>

      <div class="cs-bg-divider"></div>

      <!-- Background fields -->
      <div class="cs-bg-rows">
        <div class="cs-bg-row" *ngIf="stats()?.overallLevelInfo">
          <span class="cs-bg-label">Mortal Coil</span>
          <span class="cs-bg-val">Level {{stats()!.overallLevelInfo!.level}} <span class="cs-dim" style="font-size: 0.85em; margin-left: 6px;">(Lvl {{stats()!.overallLevelInfo!.nextLevel}} in {{stats()!.overallLevelInfo!.daysRemaining}}D)</span></span>
        </div>
        <div class="cs-bg-row">
          <span class="cs-bg-label">Title</span>
          <span class="cs-bg-val">{{ activeTitle() }}</span>
          <span class="cs-bg-arrow">▼</span>
        </div>
        <div class="cs-bg-row">
          <span class="cs-bg-label">Outfit</span>
          <span class="cs-bg-val cs-dim">Paladin Gear</span>
          <span class="cs-bg-arrow">▼</span>
        </div>
        <div class="cs-bg-row">
          <span class="cs-bg-label">Alliance Rank</span>
          <span class="cs-bg-val">◆ {{ getStreakTier(stats()?.sageStreak ?? 0) }}</span>
        </div>
        <div class="cs-bg-row">
          <span class="cs-bg-label">Bounty</span>
          <span class="cs-bg-val cs-dim cs-bounty">
            {{ stats()?.sageStreak ?? 0 }}
            <span class="cs-bounty-icon">🔥</span>
          </span>
        </div>
      </div>
    </div>

    <!-- ── ATTRIBUTES ──────────────────────────────────────────── -->
    <div class="cs-section cs-attr-section">
      <div class="cs-attr-header">
        <span class="cs-section-hdr">ATTRIBUTES</span>
        <span class="cs-attr-pts">Attribute Points: {{ attributePoints() }}</span>
      </div>

      <div class="cs-attr-bars">
        <!-- Focus (blue — Mental Clarity) -->
        <div class="cs-attr-col">
          <span class="cs-attr-label focus-lbl">Focus</span>
          <div class="cs-attr-bar">
            <div class="cs-attr-fill focus-fill" [style.width.%]="focusVal()"></div>
          </div>
          <div class="cs-attr-bottom">
            <button class="cs-plus-btn" [class.cs-plus-avail]="attributePoints() > 0"
                    [disabled]="attributePoints() === 0"
                    (click)="spendPoint('focus')">+</button>
            <span class="cs-attr-num">{{ focusVal() }}</span>
          </div>
        </div>

        <!-- Vitality (red — Physical Vitality) -->
        <div class="cs-attr-col">
          <span class="cs-attr-label vitality-lbl">Vitality</span>
          <div class="cs-attr-bar">
            <div class="cs-attr-fill vitality-fill" [style.width.%]="vitalityVal()"></div>
          </div>
          <div class="cs-attr-bottom">
            <button class="cs-plus-btn" [class.cs-plus-avail]="attributePoints() > 0"
                    [disabled]="attributePoints() === 0"
                    (click)="spendPoint('vitality')">+</button>
            <span class="cs-attr-num">{{ vitalityVal() }}</span>
          </div>
        </div>

        <!-- Energy (green — Pleasure Capacity) -->
        <div class="cs-attr-col">
          <span class="cs-attr-label energy-lbl">Energy</span>
          <div class="cs-attr-bar">
            <div class="cs-attr-fill energy-fill" [style.width.%]="energyVal()"></div>
          </div>
          <div class="cs-attr-bottom">
            <button class="cs-plus-btn" [class.cs-plus-avail]="attributePoints() > 0"
                    [disabled]="attributePoints() === 0"
                    (click)="spendPoint('energy')">+</button>
            <span class="cs-attr-num">{{ energyVal() }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── MUNDUS ───────────────────────────────────────────────── -->
    <div class="cs-section cs-mundus-section">
      <span class="cs-section-hdr">MUNDUS</span>
      <div class="cs-mundus-row">
        <span class="cs-mundus-icon">◈</span>
        <div class="cs-mundus-body">
          <span class="cs-mundus-name">Boon: {{ mundusBoonName() }}</span>
          <span class="cs-mundus-desc">{{ mundusBoonDesc() }}</span>
        </div>
        <span class="cs-mundus-arrow">↗</span>
      </div>
    </div>

    <!-- ── STAT GRID ────────────────────────────────────────────── -->
    <div class="cs-section cs-stats-section">
      <div class="cs-stats-grid">
        <div class="cs-stat-col">
          <div *ngFor="let s of leftStats()" class="cs-stat-row">
            <span class="cs-stat-lbl">{{ s.label }}</span>
            <span class="cs-stat-val" [ngClass]="s.cls">{{ s.value }}</span>
          </div>
        </div>
        <div class="cs-stat-divider"></div>
        <div class="cs-stat-col">
          <div *ngFor="let s of rightStats()" class="cs-stat-row">
            <span class="cs-stat-lbl">{{ s.label }}</span>
            <span class="cs-stat-val" [ngClass]="s.cls">{{ s.value }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── CLASS MATRIX (collapsible) ───────────────────────────── -->
    <div class="cs-section">
      <div class="cs-class-hdr" (click)="showClasses.set(!showClasses())">
        <span class="cs-section-hdr">CLASS MATRIX</span>
        <span class="cs-collapse">{{ showClasses() ? '▼' : '▶' }}</span>
      </div>
      <div *ngIf="showClasses()" class="cs-class-grid">
        <div *ngFor="let cls of classes()" class="cs-class-card">
          <div class="cs-class-row">
            <span class="cs-class-icon-em">{{ getIcon(cls.id) }}</span>
            <span class="cs-class-nm">{{ cls.name }}</span>
            <span class="cs-class-lv" [ngClass]="getTierClass(cls.tier)">L{{ cls.level }}</span>
            <span class="cs-class-rust">{{ getRustIcon(cls.rustStatus) }}</span>
          </div>
          <div class="cs-xp-row">
            <div class="cs-xp-track"><div class="cs-xp-fill" [style.width.%]="cls.percentToNext"></div></div>
            <span class="cs-xp-pct">{{ cls.percentToNext | number:'1.0-0' }}%</span>
          </div>
          <div class="cs-tier-lbl" [ngClass]="getTierClass(cls.tier)">{{ cls.tier }}</div>
        </div>
      </div>
    </div>

  </ng-container>
</div>
  `,
  styles: [`
    :host { display: block; }

    /* ── Root & shared ─────────────────────────────────────────── */
    .cs-root {
      display: flex; flex-direction: column; gap: 0;
      background: var(--eso-bg-panel, #120e07);
      font-family: 'Cinzel', serif;
      overflow-y: auto;
      height: 100%;
    }
    .cs-loading {
      padding: 40px 20px; text-align: center; font-size: 12px;
      color: var(--eso-text-dim, #a08858); letter-spacing: 1.5px;
    }
    .cs-section {
      border-bottom: 1px solid rgba(155,115,38,0.22);
      padding: 12px 16px;
    }
    .cs-section-hdr {
      font-size: 10px; font-weight: 700; letter-spacing: 2px;
      color: rgba(168,145,88,0.60); text-transform: uppercase;
    }

    /* ── BACKGROUND ────────────────────────────────────────────── */
    .cs-char-banner {
      display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
    }
    .cs-char-glyph {
      font-size: 28px; line-height: 1; flex-shrink: 0;
      filter: drop-shadow(0 0 8px rgba(201,168,76,0.35));
    }
    .cs-char-info { flex: 1; }
    .cs-char-name {
      font-size: 16px; font-weight: 700; letter-spacing: 1.5px;
      color: var(--eso-gold-bright, #f2c96a);
      text-shadow: 0 0 14px rgba(242,201,106,0.3);
    }
    .cs-char-class {
      font-size: 10px; letter-spacing: 0.5px;
      color: var(--eso-text-dim, #a08858); margin-top: 2px;
    }
    .cs-equip-bonus { text-align: right; flex-shrink: 0; }
    .cs-equip-label {
      display: block; font-size: 8px; letter-spacing: 1px;
      color: rgba(168,145,88,0.45); margin-bottom: 3px;
    }
    .cs-equip-stars { display: flex; gap: 2px; justify-content: flex-end; }
    .cs-star { font-size: 12px; }
    .cs-star.filled { color: var(--eso-gold, #c9a84c); }
    .cs-star.empty  { color: rgba(168,145,88,0.20); }

    .cs-bg-divider {
      height: 1px; background: rgba(155,115,38,0.18); margin-bottom: 10px;
    }

    .cs-bg-rows { display: flex; flex-direction: column; gap: 3px; }
    .cs-bg-row {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 0; border-bottom: 1px solid rgba(155,115,38,0.08);
    }
    .cs-bg-label {
      width: 110px; flex-shrink: 0; font-size: 10px;
      color: var(--eso-text-dim, #a08858);
    }
    .cs-bg-val { flex: 1; font-size: 11px; color: var(--eso-text, #e2cfa8); }
    .cs-bg-arrow { font-size: 9px; color: rgba(168,145,88,0.35); }
    .cs-dim { color: var(--eso-text-dim, #a08858) !important; }
    .cs-bounty { display: flex; align-items: center; gap: 4px; }
    .cs-bounty-icon { font-size: 10px; }

    /* ── ATTRIBUTES ────────────────────────────────────────────── */
    .cs-attr-section { background: rgba(201,168,76,0.025); }
    .cs-attr-header {
      display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px;
    }
    .cs-attr-pts { font-size: 10px; color: var(--eso-gold, #c9a84c); letter-spacing: 0.5px; }

    .cs-attr-bars { display: flex; gap: 16px; }
    .cs-attr-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; }

    .cs-attr-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; }
    .focus-lbl    { color: #5ba0d0; }
    .vitality-lbl { color: #e05c44; }
    .energy-lbl   { color: #4caf6e; }

    .cs-attr-bar {
      width: 100%; height: 8px;
      background: rgba(0,0,0,0.55);
      border: 1px solid rgba(201,168,76,0.15);
      overflow: hidden; position: relative;
    }
    .cs-attr-fill { height: 100%; transition: width 0.5s ease; }
    .focus-fill    { background: linear-gradient(90deg, #3a78a8, #5ba0d0); box-shadow: 0 0 8px rgba(91,160,208,0.4); }
    .vitality-fill { background: linear-gradient(90deg, #a83a2a, #e05c44); box-shadow: 0 0 8px rgba(224,92,68,0.4); }
    .energy-fill   { background: linear-gradient(90deg, #2a7a4a, #4caf6e); box-shadow: 0 0 8px rgba(76,175,110,0.4); }

    .cs-attr-bottom {
      display: flex; align-items: center; gap: 8px;
    }
    .cs-plus-btn {
      width: 20px; height: 20px; border-radius: 50%;
      background: transparent;
      border: 1px solid rgba(168,145,88,0.25);
      color: rgba(168,145,88,0.30); font-size: 14px; line-height: 1;
      cursor: default; display: flex; align-items: center; justify-content: center;
      padding: 0; font-family: 'Cinzel', serif; transition: all 0.14s;
    }
    .cs-plus-avail {
      border-color: var(--eso-gold, #c9a84c);
      color: var(--eso-gold, #c9a84c);
      cursor: pointer;
    }
    .cs-plus-avail:hover {
      background: rgba(201,168,76,0.15);
      box-shadow: 0 0 8px rgba(201,168,76,0.25);
    }
    .cs-attr-num {
      font-size: 18px; font-weight: 700; font-family: 'Cinzel', serif;
      color: var(--eso-text, #e2cfa8);
      text-shadow: 0 0 10px rgba(201,168,76,0.15);
    }

    /* ── MUNDUS ────────────────────────────────────────────────── */
    .cs-mundus-section { background: rgba(201,168,76,0.02); }
    .cs-mundus-row {
      display: flex; align-items: flex-start; gap: 10px; margin-top: 8px;
    }
    .cs-mundus-icon { font-size: 18px; color: var(--eso-gold, #c9a84c); flex-shrink: 0; margin-top: 1px; }
    .cs-mundus-body { flex: 1; }
    .cs-mundus-name {
      display: block; font-size: 12px; font-weight: 600;
      color: var(--eso-text, #e2cfa8); margin-bottom: 3px; letter-spacing: 0.5px;
    }
    .cs-mundus-desc { font-size: 10px; color: var(--eso-text-dim, #a08858); font-style: italic; }
    .cs-mundus-arrow { color: var(--eso-gold, #c9a84c); font-size: 12px; opacity: 0.6; }

    /* ── STAT GRID ─────────────────────────────────────────────── */
    .cs-stats-grid { display: flex; gap: 0; }
    .cs-stat-col { flex: 1; display: flex; flex-direction: column; gap: 1px; }
    .cs-stat-divider { width: 1px; background: rgba(155,115,38,0.20); margin: 0 10px; flex-shrink: 0; }
    .cs-stat-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 4px 2px;
      border-bottom: 1px solid rgba(155,115,38,0.07);
    }
    .cs-stat-lbl { font-size: 10px; color: var(--eso-text-dim, #a08858); }
    .cs-stat-val { font-size: 11px; font-weight: 700; color: var(--eso-text, #e2cfa8); font-family: 'Cinzel', serif; }

    /* Stat value color variants */
    .sv-focus    { color: #5ba0d0; }
    .sv-vitality { color: #e05c44; }
    .sv-energy   { color: #4caf6e; }
    .sv-spirit   { color: #c084fc; }
    .sv-lift     { color: var(--eso-gold-bright, #f2c96a); }
    .sv-streak   { color: var(--eso-gold, #c9a84c); }
    .sv-dev      { color: #7b68ee; }
    .sv-warrior  { color: #e05c44; }
    .sv-sage     { color: var(--eso-gold-bright, #f2c96a); }
    .sv-red      { color: #e05c44; }
    .sv-artist   { color: #4caf6e; }

    /* ── CLASS MATRIX ──────────────────────────────────────────── */
    .cs-class-hdr {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 10px; cursor: pointer;
    }
    .cs-class-hdr:hover .cs-section-hdr { color: rgba(201,168,76,0.80); }
    .cs-collapse { font-size: 9px; color: rgba(168,145,88,0.45); }

    .cs-class-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(155px, 1fr)); gap: 7px;
    }
    .cs-class-card {
      background: rgba(0,0,0,0.40); border: 1px solid rgba(155,115,38,0.22);
      padding: 7px 9px;
    }
    .cs-class-row { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
    .cs-class-icon-em { font-size: 13px; }
    .cs-class-nm {
      flex: 1; font-size: 10px; color: var(--eso-text, #d4b483);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .cs-class-lv {
      font-size: 10px; font-weight: 700; padding: 1px 5px;
      border: 1px solid currentColor;
    }
    .cs-class-rust { font-size: 11px; }

    /* Tier color classes */
    .tier-gm     { color: #ffd700; border-color: #ffd700 !important; }
    .tier-master { color: #c084fc; border-color: #c084fc !important; }
    .tier-expert { color: #60a5fa; border-color: #60a5fa !important; }
    .tier-adept  { color: #4ade80; border-color: #4ade80 !important; }
    .tier-novice { color: var(--eso-text-dim, #a08858); border-color: var(--eso-text-dim, #a08858) !important; }

    .cs-xp-row { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; }
    .cs-xp-track {
      flex: 1; height: 4px; background: rgba(0,0,0,0.5);
      border: 1px solid rgba(155,115,38,0.22); overflow: hidden;
    }
    .cs-xp-fill {
      height: 100%;
      background: linear-gradient(90deg, #c9a84c, #9a7830);
      transition: width 0.4s ease-out;
    }
    .cs-xp-pct {
      font-size: 9px; color: var(--eso-text-dim, #a08858); min-width: 26px;
      text-align: right;
    }
    .cs-tier-lbl { font-size: 8.5px; letter-spacing: 0.5px; text-transform: uppercase; }
  `],
})
export class CharacterStatsPanelComponent implements OnInit {
  private readonly http = inject(HttpClient);

  isLoading  = signal(true);
  stats      = signal<CharStatsResponse | null>(null);
  classes    = signal<SkillTreeStat[]>([]);
  lifts      = signal<{ name: string; value: string; target?: string }[]>([]);

  // ── Attribute allocation ─────────────────────────────────────────────────
  attributePoints  = signal<number>(3);
  private focusBon    = signal<number>(0);
  private vitalityBon = signal<number>(0);
  private energyBon   = signal<number>(0);

  focusVal    = computed(() => (this.stats()?.acmMetrics?.mentalClarity    ?? 0) + this.focusBon());
  vitalityVal = computed(() => (this.stats()?.acmMetrics?.physicalVitality ?? 0) + this.vitalityBon());
  energyVal   = computed(() => (this.stats()?.acmMetrics?.pleasureCapacity ?? 0) + this.energyBon());

  showClasses = signal<boolean>(false);

  // ── Derived character data ───────────────────────────────────────────────
  primaryClass = computed<SkillTreeStat | null>(() => {
    const cs = this.classes();
    return cs.length > 0 ? cs.reduce((a, b) => a.level >= b.level ? a : b) : null;
  });

  activeTitle = computed<string>(() => {
    const streak = this.stats()?.sageStreak ?? 0;
    if (streak >= 730) return 'Unbroken Paladin';
    if (streak >= 365) return 'Faithful Dawn Warrior';
    if (streak >= 180) return 'Iron Will Keeper';
    if (streak >= 90)  return 'Steadfast Seeker';
    return 'Paladin Initiate';
  });

  mundusBoonName = computed<string>(() => {
    const streak = this.stats()?.sageStreak ?? 0;
    if (streak >= 365) return 'The Relentless';
    if (streak >= 180) return 'The Iron Will';
    if (streak >= 90)  return 'The Consistent';
    return 'The Seeker';
  });

  mundusBoonDesc = computed<string>(() => {
    const streak = this.stats()?.sageStreak ?? 0;
    if (streak >= 365) return '+15% XP consolidation — 1 year+ unbroken streak';
    if (streak >= 180) return '+10% XP consolidation — 6 months+ streak';
    if (streak >= 90)  return '+7.5% XP consolidation — 90 days+ streak';
    return '+5% XP consolidation — base boon';
  });

  /** Equipment bonus stars — 1 per 100 sage streak days, max 5 */
  equipStars = computed<number[]>(() => {
    const n = Math.min(5, Math.floor((this.stats()?.sageStreak ?? 0) / 100));
    return Array(n).fill(0);
  });
  equipEmpty = computed<number[]>(() => Array(5 - this.equipStars().length).fill(0));

  // ── Stat grid ────────────────────────────────────────────────────────────
  leftStats = computed<{ label: string; value: string; cls: string }[]>(() => {
    const a = this.stats()?.acmMetrics;
    const ls = this.lifts();
    return [
      { label: 'Mental Clarity',    value: String(a?.mentalClarity    ?? '—'), cls: 'sv-focus'    },
      { label: 'Physical Vitality', value: String(a?.physicalVitality ?? '—'), cls: 'sv-vitality' },
      { label: 'Pleasure Capacity', value: String(a?.pleasureCapacity ?? '—'), cls: 'sv-energy'   },
      { label: 'Spiritual Align.',  value: String(a?.spiritualAlignment ?? '—'), cls: 'sv-spirit' },
      ...(ls[0] ? [{ label: 'Squat',       value: ls[0].value, cls: 'sv-lift' }] : []),
      ...(ls[1] ? [{ label: 'Deadlift',    value: ls[1].value, cls: 'sv-lift' }] : []),
      ...(ls[2] ? [{ label: 'Bench Press', value: ls[2].value, cls: 'sv-lift' }] : []),
      ...(ls[3] ? [{ label: 'OH Press',    value: ls[3].value, cls: 'sv-lift' }] : []),
    ];
  });

  rightStats = computed<{ label: string; value: string; cls: string }[]>(() => [
    { label: 'Sage Streak',    value: (this.stats()?.sageStreak ?? 0) + 'd', cls: 'sv-streak'  },
    { label: 'Developer Lv',  value: String(this.classLevel('developer')),   cls: 'sv-dev'     },
    { label: 'Warrior Lv',    value: String(this.classLevel('warrior')),     cls: 'sv-warrior' },
    { label: 'Sage Lv',       value: String(this.classLevel('sage')),        cls: 'sv-sage'    },
    { label: 'RedTeam Lv',    value: String(this.classLevel('redteamer')),   cls: 'sv-red'     },
    { label: 'Artist Lv',     value: String(this.classLevel('artist')),      cls: 'sv-artist'  },
    { label: 'Survivalist Lv',value: String(this.classLevel('survivalist')), cls: ''           },
  ]);

  // ── Lifecycle ────────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.http.get<CharStatsResponse>(`${environment.apiUrl}/api/character/stats`).subscribe({
      next: (data) => {
        this.stats.set(data);
        this.classes.set(data.skillTrees ?? []);
        if (data.rpgStats) {
          this.lifts.set([
            { name: 'Squat',          value: data.rpgStats.squat.value,       target: data.rpgStats.squat.target       },
            { name: 'Deadlift',       value: data.rpgStats.deadlift.value,    target: data.rpgStats.deadlift.target    },
            { name: 'Bench Press',    value: data.rpgStats.benchPress.value,  target: data.rpgStats.benchPress.target  },
            ...(data.rpgStats.overheadPress
              ? [{ name: 'OH Press', value: data.rpgStats.overheadPress.value, target: data.rpgStats.overheadPress.target }]
              : []),
          ]);
        }
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  getIcon(id: string): string {
    return CLASS_ICONS[id.toLowerCase()] ?? '⚔';
  }

  getTierClass(tier: string): string {
    for (const key of Object.keys(TIER_CLASS)) {
      if (tier.includes(key)) return TIER_CLASS[key];
    }
    return 'tier-novice';
  }

  getRustIcon(status?: string): string {
    if (!status)              return '';
    if (status === 'sharp')   return '✅';
    if (status === 'rusty')   return '⚠️';
    if (status === 'very-rusty') return '🔴';
    return '⏸️';
  }

  getStreakTier(days: number): string {
    if (days >= 730) return '★★★ 2-Year Legend';
    if (days >= 365) return '★★ 1-Year Master';
    if (days >= 180) return '★ 6-Month Expert';
    if (days >= 90)  return 'Adept';
    return 'Initiate';
  }

  classLevel(id: string): number {
    return this.classes().find(c => c.id.toLowerCase() === id.toLowerCase())?.level ?? 0;
  }

  spendPoint(attr: 'focus' | 'vitality' | 'energy'): void {
    if (this.attributePoints() <= 0) return;
    this.attributePoints.update(n => n - 1);
    if (attr === 'focus')    this.focusBon.update(n => n + 1);
    if (attr === 'vitality') this.vitalityBon.update(n => n + 1);
    if (attr === 'energy')   this.energyBon.update(n => n + 1);
  }
}
