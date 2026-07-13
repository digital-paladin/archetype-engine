import { Component, computed, signal, inject, OnInit, OnDestroy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { CommonModule } from '@angular/common';
import { QuickLogComponent } from './quick-log.component';
import { CharacterDisplayComponent } from './character-display.component';

import { BodyDiagramComponent } from './body-diagram.component';
import { XpCalculatorComponent } from './xp-calculator.component';
import { ConsumablesComponent } from './consumables/consumables.component';
import { AbilityHotbarComponent } from './ability-hotbar.component';
import { ActivitySessionPanelComponent } from './activity-session-panel.component';
import { SleepPanelComponent, SleepDayData, ActivitySummary, VitalsData } from './sleep-panel.component';
import { FoodLogPanelComponent, FoodLog } from './food-log-panel.component';
import { ActivityFeedComponent } from './activity-feed.component';
import { AcmPanelComponent } from './acm-panel.component';
import { QuestsPanelComponent } from './quests-panel.component';
import { SkillsPanelComponent } from './skills-panel.component';
import { LootDropOverlayComponent } from './loot-drop-overlay.component';
import { CharacterStatsPanelComponent } from './character-stats-panel.component';
import { ProgressionAnalyticsComponent } from './progression-analytics.component';
import { CollectionsPanelComponent } from './collections-panel.component';
import { LootDropService } from './loot-drop.service';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { XpProjectionService, XPProjection } from './xp-projection.service';
import { SocketService } from './socket.service';
import { WillpowerService } from './willpower.service';
import { RotColorService } from './rot-color.service';
import { ComboService } from './combo.service';

import { StatusEffectsPanelComponent } from './status-effects-panel.component';
import { VaultPanelComponent } from './vault-panel.component';
import { CouragePanelComponent } from './courage-panel.component';
import { RewardsCatalogPanelComponent } from './rewards-catalog-panel.component';
import { TreasuryPanelComponent } from './treasury-panel.component';
import { QuestLinesPanelComponent } from './quest-lines-panel.component';
import { InventoryComponent } from './inventory.component';
import { CraftingStationComponent } from './crafting-station.component';
import { TodoistPanelComponent } from './todoist-panel.component';

type PanelId = 'character' | 'skills' | 'health' | 'xp' | 'consumables' | 'sleep' | 'acm' | 'nutrition' | 'quests' | 'quest-lines' | 'analytics' | 'buffs' | 'vault' | 'courage' | 'rewards' | 'treasury' | 'inventory' | 'crafting' | 'todoist';

const NAV_TABS: { id: PanelId; icon: string; label: string }[] = [
  { id: 'character',   icon: '⚔',  label: 'Character'   },
  { id: 'skills',      icon: '✦',  label: 'Skills'      },
  { id: 'health',       icon: '✚',  label: 'Health'      },
  { id: 'sleep',        icon: '💤', label: 'Sleep'        },
  { id: 'acm',          icon: '⚖', label: 'ACM'          },
  { id: 'nutrition',    icon: '🍖', label: 'Nutrition'    },
  { id: 'quests',       icon: '📜', label: 'Quests'       },
  { id: 'analytics',    icon: '📊', label: 'Analytics'    },
  { id: 'buffs',        icon: '⚗',  label: 'Buffs'         },
  { id: 'vault',        icon: '�', label: 'Vault'    },
  { id: 'courage',      icon: '⚔️',  label: 'Courage'  },
  { id: 'rewards',      icon: '🎁',  label: 'Rewards'  },
  { id: 'treasury',     icon: '🏦', label: 'Treasury'  },
  { id: 'quest-lines',  icon: '🗺️', label: 'Quest Lines' },
  { id: 'inventory',    icon: '🛡',  label: 'Inventory'   },
  { id: 'crafting',     icon: '⚒',  label: 'Crafting'    },
  { id: 'todoist',      icon: '✅', label: 'Quests (Todoist)' },
];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, QuickLogComponent, CharacterDisplayComponent, BodyDiagramComponent, XpCalculatorComponent, ConsumablesComponent, AbilityHotbarComponent, ActivitySessionPanelComponent, SleepPanelComponent, FoodLogPanelComponent, ActivityFeedComponent, AcmPanelComponent, QuestsPanelComponent, SkillsPanelComponent, LootDropOverlayComponent, CharacterStatsPanelComponent, ProgressionAnalyticsComponent, CollectionsPanelComponent, StatusEffectsPanelComponent, VaultPanelComponent, CouragePanelComponent, RewardsCatalogPanelComponent, TreasuryPanelComponent, QuestLinesPanelComponent, InventoryComponent, CraftingStationComponent, TodoistPanelComponent],
  template: `
    <div class="eso-game-frame">

      <!-- ══ Top Navigation Bar ══ -->
      <header class="eso-top-bar">

        <!-- Left: Character identity -->
        <div class="eso-title-group">
          <span class="eso-title-ornament">◈</span>
          <div class="eso-title-stack">
            <h1 class="eso-character-title">Digital Paladin</h1>
            <span class="eso-title-sub">Character Progression</span>
          </div>
        </div>

        <!-- Center: Icon Tab Bar -->
        <nav class="eso-tab-bar">
          <button
            *ngFor="let tab of navTabs"
            class="eso-tab"
            [class.eso-tab-active]="activePanel() === tab.id"
            (click)="setPanel(tab.id)">
            <span class="eso-tab-icon">{{ tab.icon }}</span>
            <span class="eso-tab-label">{{ tab.label }}</span>
          </button>
        </nav>

        <!-- Right: Logout -->
        <button class="eso-btn eso-btn-danger" (click)="onLogout()">⊠ Logout</button>

      </header>

      <!-- ══ Two-Column Main Layout ══ -->
      <main class="eso-main-layout">

        <!-- Left Column: Status + Character -->
        <aside class="eso-left-column">

          <!-- Vitality / Status Panel -->
          <section class="eso-panel eso-status-panel">
            <h3 class="eso-panel-title">Status</h3>

            <div class="eso-stat-group">
              <div class="eso-stat-header">
                <span class="eso-stat-label">Vitality</span>
                <span class="eso-stat-value">{{ vitality.current !== null ? (vitality.current + ' / 100') : '— / 100' }}</span>
              </div>
              <div class="eso-bar-track">
                <div class="eso-bar-fill"
                     [style.width.%]="vitality.current ?? 0"
                     [style.background]="rotColor.vitalityColor(vitality.current ?? 0)"></div>
              </div>
              <div *ngIf="vitality.current !== null" class="eso-status-badge" [ngClass]="vitalityStatusClass(vitality.status)">
                {{ vitality.status || 'Unknown' }}
              </div>
              <div *ngIf="vitality.current === null" class="eso-status-badge eso-badge-dim">
                Loading…
              </div>
            </div>

            <!-- Willpower Meter -->
            <div class="eso-stat-group">
              <div class="eso-stat-header">
                <span class="eso-stat-label">Willpower</span>
                <span class="eso-stat-value">{{ willpowerService.willpower() }} / 100</span>
              </div>
              <div class="eso-bar-track">
                <div class="eso-bar-fill"
                     [style.width.%]="willpowerService.willpower()"
                     [style.background]="rotColor.willpowerColor(willpowerService.willpower())"></div>
              </div>
              <div class="eso-status-badge" [ngClass]="willpowerService.statusClass()">
                {{ willpowerService.status() }}
              </div>
            </div>

            <!-- Rested XP Buff Banner (appears when last night's sleep ≥ 7 hrs) -->
            <div class="rested-xp-banner" *ngIf="restedMultiplier() > 1">
              <span class="rested-icon">✨</span>
              <span class="rested-text">Well-Rested Bonus</span>
              <span class="rested-value">+50% XP</span>
            </div>

            <!-- Combo Streak Badge (visible when streak ≥ 2 consecutive logging days) -->
            <div class="combo-streak" *ngIf="comboService.comboCount() >= 2">
              <span class="combo-flame">🔥</span>
              <div class="combo-info">
                <span class="combo-count">{{ comboService.comboCount() }}-DAY STREAK</span>
                <span class="combo-bonus" *ngIf="comboService.comboBonus()">{{ comboService.comboBonus() }}</span>
                <span class="combo-hint" *ngIf="!comboService.comboBonus()">Log tomorrow to activate bonus!</span>
              </div>
              <span class="combo-tier" [ngClass]="comboTierClass()">{{ comboTierLabel() }}</span>
            </div>

            <!-- Combo Broken Toast (3-second flash when streak snaps) -->
            <div class="combo-broken" *ngIf="comboService.comboBroken()">
              <span>⚡</span>
              <span>COMBO BROKEN</span>
            </div>

            <div class="eso-divider"></div>

            <div class="eso-stat-row" *ngIf="vitality.sleepDebt !== null">
              <span class="eso-label">Sleep Debt</span>
              <span class="eso-value">{{ vitality.sleepDebt }} hrs</span>
            </div>
            <div class="eso-stat-row" *ngIf="vitality.trend">
              <span class="eso-label">Trend</span>
              <span class="eso-value">{{ vitality.trend }}</span>
            </div>
            <div class="eso-flag-banner" *ngIf="vitality.flag">⚠ {{ vitality.flag }}</div>

            <!-- Fitbit Sleep Stats -->
            <div *ngIf="sleepData()" class="eso-divider"></div>
            <div *ngIf="sleepData()" class="eso-stat-row">
              <span class="eso-label">😴 Sleep Score</span>
              <span class="eso-value">{{ sleepData()!.score }} / 100</span>
            </div>
            <div *ngIf="sleepData()" class="eso-stat-row">
              <span class="eso-label">⏱ Sleep Hours</span>
              <span class="eso-value">{{ sleepData()!.hours }} hrs</span>
            </div>
            <div *ngIf="sleepData()" class="eso-stat-row">
              <span class="eso-label">⚡ Sleep Vitality</span>
              <span class="eso-value">{{ sleepData()!.vitality }} / 10</span>
            </div>
            <div *ngIf="restingHR()" class="eso-stat-row">
              <span class="eso-label">❤ Resting HR</span>
              <span class="eso-value">{{ restingHR() }} bpm</span>
            </div>

            <!-- Stress & Energy (always visible, editable) -->
            <div class="eso-divider"></div>
            <div class="eso-se-header">
              <span class="eso-label">⚔ Stress &amp; Energy</span>
              <span class="eso-se-save-status" [class.saving]="seSaveStatus() === 'saving'" [class.saved]="seSaveStatus() === 'saved'">
                <ng-container *ngIf="seSaveStatus() === 'saving'">◌ saving…</ng-container>
                <ng-container *ngIf="seSaveStatus() === 'saved'">✓ saved</ng-container>
              </span>
            </div>

            <div class="eso-stat-row eso-se-row">
              <span class="eso-label">🧠 Stress</span>
              <div class="eso-se-btn-group">
                <button *ngFor="let lvl of ['Low','Medium','High']" class="eso-se-btn"
                  [class.active]="stressEnergy()?.stress === lvl"
                  [ngClass]="'stress-btn-' + lvl.toLowerCase()"
                  (click)="setStress(lvl)">{{ lvl }}</button>
              </div>
            </div>

            <div class="eso-stat-row eso-se-row">
              <span class="eso-label">⚡ Energy</span>
              <div class="eso-se-energy-row">
                <button *ngFor="let n of energyNums" class="eso-se-energy-btn"
                  [class.active]="stressEnergy()?.energy === n"
                  [ngClass]="energyLevelClass(n)"
                  (click)="setEnergy(n)">{{ n }}</button>
              </div>
            </div>

            <div class="eso-se-mental">
              <span class="eso-label">💭 Mental</span>
              <input class="eso-se-mental-input"
                [value]="stressEnergy()?.mentalState || ''"
                placeholder="[To be logged]"
                (change)="setMentalState($any($event.target).value)" />
            </div>
          </section>

          <!-- 3D Character Display -->
          <section class="eso-panel eso-char-panel">
            <h3 class="eso-panel-title">Character</h3>
            <app-character-display
                [characterLevel]="overallLevelInfo()?.level ?? 32"
                [characterName]="'Digital Paladin'"
                [currentXP]="daysElapsed()"
                [maxXP]="365"
                [xpPercentage]="levelPct()">
            </app-character-display>
          </section>
          
          <section class="eso-panel">
            <app-status-effects-panel [compact]="true"></app-status-effects-panel>
          </section>

        </aside>

        <!-- Right: Panel Content Area (switches by activePanel) -->
        <div class="eso-panel-area">

          <!-- ── Character Panel (default) ── -->
          <ng-container *ngIf="activePanel() === 'character'">

            <!-- Character Stats Panel -->
            <app-character-stats-panel></app-character-stats-panel>

            <!-- Skill Progression -->
            <section class="eso-panel eso-xp-panel">
              <h3 class="eso-panel-title">Skill Progression</h3>
              <div *ngIf="!isLoading() && xpProjection(); else xpLoading" class="eso-xp-grid">
                <div *ngFor="let className of getClassNames()" class="eso-xp-row">
                  <div class="eso-xp-class-info">
                    <span class="eso-xp-class-name">{{ className }}</span>
                    <span class="eso-xp-totals">
                      <!-- Prefer live DB stats; fall back to file-parsed projections -->
                      <ng-container *ngIf="getDbClassStat(className) as dbStat; else fileXp">
                        <span class="eso-xp-level-badge">L{{ dbStat.level }}</span>
                        <span class="eso-xp-total-val">{{ dbStat.currentXP }} / {{ dbStat.xpToNextLevel }} XP</span>
                        <span class="eso-xp-pct">({{ dbStat.percentToNext }}%)</span>
                        <span class="eso-xp-daily-val">+{{ xpProjection()?.[className]?.avgDailyXP }}/day</span>
                      </ng-container>
                      <ng-template #fileXp>
                        <span class="eso-xp-total-val">{{ xpProjection()?.[className]?.totalXP }} XP</span>
                        <span class="eso-xp-daily-val">+{{ xpProjection()?.[className]?.avgDailyXP }}/day</span>
                      </ng-template>
                    </span>
                  </div>
                  <div class="eso-xp-projections">
                    <span class="eso-proj-val">6mo: {{ xpProjection()?.[className]?.projected6mo }}</span>
                    <span class="eso-proj-val">12mo: {{ xpProjection()?.[className]?.projected12mo }}</span>
                  </div>
                </div>
              </div>
              <ng-template #xpLoading>
                <div class="eso-loading-text">Loading progression data...</div>
              </ng-template>
            </section>

            <!-- Recent Gains -->
            <section class="eso-panel eso-gains-panel" *ngIf="recentXpGains.length > 0">
              <h3 class="eso-panel-title">Recent Gains</h3>
              <div class="eso-gains-list">
                <div *ngFor="let gain of recentXpGains" class="eso-gain-row">
                  <span class="eso-gain-class">{{ gain.className }}</span>
                  <span class="eso-gain-amount">+{{ gain.amount }} XP</span>
                  <span class="eso-gain-date">{{ gain.date | date:'MMM d, yyyy' }}</span>
                </div>
              </div>
            </section>

            <!-- Quest Log -->
            <section class="eso-panel eso-quest-panel">
              <h3 class="eso-panel-title">Quest Log</h3>
              <ng-container *ngIf="questLog && questLog.quests.length; else noQuests">
                <div *ngFor="let quest of questLog.quests" class="eso-quest-entry">
                  <div class="eso-quest-class-name">◆ {{ quest.className }}</div>
                  <ul class="eso-quest-activities">
                    <li *ngFor="let activity of quest.activities">{{ activity }}</li>
                  </ul>
                </div>
              </ng-container>
              <ng-template #noQuests>
                <div class="eso-empty-text">No active quests for today.</div>
              </ng-template>
            </section>

            <!-- Collections (Titles, Trophies & Armor) -->
            <app-collections-panel></app-collections-panel>

            <!-- Log Activity section removed — logging is done via Quest Activities and ACL -->

          </ng-container>

          <!-- ── Skills Panel ── -->
          <ng-container *ngIf="activePanel() === 'skills'">
            <app-skills-panel></app-skills-panel>
          </ng-container>

          <!-- Journal tab removed — Quests tab (📜) provides the same view -->

          <!-- ── Health Panel ── -->
          <ng-container *ngIf="activePanel() === 'health'">
            <app-body-diagram></app-body-diagram>
            <app-sleep-panel
              [activities]="activitiesData()"
              [vitals]="vitalsData()">
            </app-sleep-panel>
          </ng-container>

          <!-- ── XP Calculator Panel (disabled) ── -->

          <!-- ── Consumables Panel ── -->
          <!-- ── Consumables Panel (disabled) ── -->

          <!-- ── ACM Panel ── -->
          <ng-container *ngIf="activePanel() === 'acm'">
            <app-acm-panel [selectedDate]="selectedDate()"></app-acm-panel>
          </ng-container>

          <!-- ── Sleep Panel ── -->
          <ng-container *ngIf="activePanel() === 'sleep'">
            <app-sleep-panel
              [today]="sleepData()"
              [week]="weekSleep()"
              [month]="monthSleep()"
              [sleepDebt]="vitality.sleepDebt">
            </app-sleep-panel>
          </ng-container>

          <!-- ── Nutrition Panel ── -->
          <ng-container *ngIf="activePanel() === 'nutrition'">
            <app-food-log-panel [food]="foodData()" [vitals]="vitalsData()"></app-food-log-panel>
          </ng-container>

          <!-- ── Quests Panel ── -->
          <ng-container *ngIf="activePanel() === 'quests'">
            <app-quests-panel (dateChanged)="onQuestDateChanged($event)"></app-quests-panel>
          </ng-container>

          <!-- ── Analytics Panel ── -->
          <ng-container *ngIf="activePanel() === 'analytics'">
            <app-progression-analytics></app-progression-analytics>
          </ng-container>

          <!-- ── Buffs & Debuffs Panel ── -->
          <ng-container *ngIf="activePanel() === 'buffs'">
            <app-status-effects-panel></app-status-effects-panel>
          </ng-container>

          <!-- ── Strategy Vault Panel ── -->
          <ng-container *ngIf="activePanel() === 'vault'">
            <app-vault-panel></app-vault-panel>
          </ng-container>

          <!-- ── Courage Panel ── -->
          <ng-container *ngIf="activePanel() === 'courage'">
            <app-courage-panel></app-courage-panel>
          </ng-container>

          <!-- ── Rewards Catalog Panel ── -->
          <ng-container *ngIf="activePanel() === 'rewards'">
            <app-rewards-catalog-panel></app-rewards-catalog-panel>
          </ng-container>

          <!-- ── Treasury Panel ── -->
          <ng-container *ngIf="activePanel() === 'treasury'">
            <app-treasury-panel></app-treasury-panel>
          </ng-container>

          <!-- ── Quest Lines Panel ── -->
          <ng-container *ngIf="activePanel() === 'quest-lines'">
            <app-quest-lines-panel></app-quest-lines-panel>
          </ng-container>

          <!-- ── Inventory Panel ── -->
          <ng-container *ngIf="activePanel() === 'inventory'">
            <app-inventory></app-inventory>
          </ng-container>

          <!-- ── Crafting Station Panel ── -->
          <ng-container *ngIf="activePanel() === 'crafting'">
            <app-crafting-station></app-crafting-station>
          </ng-container>

          <!-- ── Todoist Quest Pointer Panel ── -->
          <ng-container *ngIf="activePanel() === 'todoist'">
            <app-todoist-panel></app-todoist-panel>
          </ng-container>

        </div>
      </main>

      <!-- ══ Activity Session Panel (slides in from right) ══ -->
      <app-activity-session-panel></app-activity-session-panel>

      <!-- ══ Ability Hotbar ══ -->
      <app-ability-hotbar></app-ability-hotbar>

      <!-- ══ Loot Drop Overlay (renders on top of everything when a drop fires) ══ -->
      <app-loot-drop-overlay></app-loot-drop-overlay>

    </div>
  `,
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {
  readonly navTabs = NAV_TABS;
  activePanel = signal<PanelId>('character');

  xpProjection        = signal<XPProjection | null>(null);
  isLoading           = signal(true);
  overallLevelInfo    = signal<{ level: number; nextLevel: number; nextLevelDate: string; daysRemaining: number } | null>(null);
  /** DB-backed skill tree stats (level + current XP per class). Populated from /api/character/stats. */
  dbSkillTrees        = signal<Array<{ id: string; name: string; level: number; currentXP: number; xpToNextLevel: number; percentToNext: number; totalCareerXP: number }> | null>(null);
  daysElapsed         = computed(() => Math.max(0, 365 - (this.overallLevelInfo()?.daysRemaining ?? 365)));
  levelPct            = computed(() => Math.round((this.daysElapsed() / 365) * 100));
  sleepData           = signal<{ score: number; hours: number; vitality: number; efficiency: number; deep_min: number; rem_min: number; light_min: number; awake_min: number; source?: string } | null>(null);
  weekSleep           = signal<SleepDayData[] | null>(null);
  monthSleep          = signal<SleepDayData[] | null>(null);
  activitiesData      = signal<ActivitySummary | null>(null);
  restingHR           = signal<number | null>(null);
  vitalsData          = signal<VitalsData | null>(null);
  foodData            = signal<FoodLog | null>(null);
  selectedDate        = signal(new Date().toLocaleDateString('en-CA'));
  xpProjectionService = inject(XpProjectionService);
  socketService = inject(SocketService);
  readonly willpowerService = inject(WillpowerService);
  readonly rotColor = inject(RotColorService);
  readonly lootDrop    = inject(LootDropService);
  readonly comboService = inject(ComboService);

  /** 1.5× when Fitbit reports ≥7 hours of sleep last night, otherwise 1.0. */
  restedMultiplier  = computed(() => (this.sleepData()?.hours ?? 0) >= 7 ? 1.5 : 1.0);
  /** Combined rested × combo multiplier forwarded to the quick-log component. */
  totalXpMultiplier = computed(() => this.restedMultiplier() * this.comboService.comboMultiplier());
  private authService = inject(AuthService);
  private router = inject(Router);
  private http = inject(HttpClient);

  vitality = {
    current: null as number | null,
    status: '',
    sleepDebt: null as number | null,
    trend: '',
    flag: ''
  };

  stressEnergy = signal<{ stress: string | null; energy: number | null; mentalState: string } | null>(null);
  seSaveStatus = signal<'' | 'saving' | 'saved'>('');
  private seSave$ = new Subject<void>();
  readonly energyNums = [1,2,3,4,5,6,7,8,9,10];

  recentXpGains: { className: string; amount: number; date: string }[] = [];
  questLog: { quests: { className: string; activities: string[] }[] } = { quests: [] };

  constructor() {
    this.xpProjectionService.getVitalityStatus().subscribe({
      next: (vitality: any) => { this.vitality = vitality; },
      error: (err: any) => { console.error('[Dashboard] Vitality fetch error:', err); }
    });

    this.xpProjectionService.getProjections().subscribe({
      next: (data: any) => { this.xpProjection.set(data); this.isLoading.set(false); },
      error: (err: any) => { console.error('[Dashboard] Projections fetch error:', err); this.isLoading.set(false); }
    });

    this.socketService.onXpProjectionUpdate().subscribe((data: any) => {
      this.xpProjection.set(data);
    });

    // Fetch Fitbit data on load, then refresh every 15 minutes
    this.fetchFitbitData();
    interval(15 * 60 * 1000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.fetchFitbitData());

    this.xpProjectionService.getRecentGains().subscribe({
      next: (gains: any) => { this.recentXpGains = gains; },
      error: (err: any) => { console.error('[Dashboard] Recent gains fetch error:', err); }
    });

    this.http.get<any>(`${environment.apiUrl}/api/character/stats`).subscribe({
      next: (data: any) => {
        if (data?.overallLevelInfo) this.overallLevelInfo.set(data.overallLevelInfo);
        if (Array.isArray(data?.skillTrees) && data.skillTrees.length > 0) {
          this.dbSkillTrees.set(data.skillTrees.map((t: any) => ({
            id:            t.id,
            name:          t.name,
            level:         t.level,
            currentXP:     t.currentXP,
            xpToNextLevel: t.xpToNextLevel,
            percentToNext: t.percentToNext,
            totalCareerXP: t.totalCareerXP,
          })));
        }
      },
      error: () => {}
    });

    const todayStr = new Date().toLocaleDateString('en-CA');
    this.http.get<any[]>(`${environment.apiUrl}/api/quests/today?date=${todayStr}`).subscribe({
      next: (classes: any[]) => {
        this.questLog = {
          quests: (classes || []).map((c: any) => ({
            className: c.name,
            activities: (c.fields || [])
              .filter((f: any) => f.value && f.value !== '[To be logged]')
              .map((f: any) => `${f.label}: ${f.value}`)
          })).filter((q: any) => q.activities.length > 0)
        };
      },
      error: (err: any) => { console.error('[Dashboard] Quest log fetch error:', err); }
    });

    // Debounced save for Stress & Energy
    this.seSave$.pipe(debounceTime(800), takeUntilDestroyed()).subscribe(() => this.saveStressEnergy());

    // Ensure today's journal entry exists (creates from template if missing)
    this.http.get(`${environment.apiUrl}/api/journal/today`).subscribe({
      next: (res: any) => { console.log(`[Dashboard] Journal entry ready: ${res.date}`); },
      error: (err: any) => { console.error('[Dashboard] Could not ensure today\'s journal entry:', err); }
    });

  }

  private fetchFitbitData(): void {
    const localDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

    // Sleep — today
    this.http.get<{ success: boolean; sleep: { score: number; hours: number; vitality: number; efficiency: number; deep_min: number; rem_min: number; light_min: number; awake_min: number }; source: string; requiresAuth?: boolean; error?: string }>(
      `${environment.apiUrl}/api/fitbit/sleep/today?date=${localDate}`
    ).subscribe({
      next: (res) => {
        if (res.requiresAuth) {
          console.warn(`[Dashboard] Fitbit sleep requires re-authorization. Visit /api/fitbit/auth to grant sleep scope.`);
        } else if (res.success && res.sleep) {
          this.sleepData.set({ ...res.sleep, source: res.source });
          this.willpowerService.resetForNewSleep();
          console.log(`[Dashboard] Sleep loaded (${res.source}): score=${res.sleep.score} hrs=${res.sleep.hours} vitality=${res.sleep.vitality}`);
        }
      },
      error: () => { /* Non-fatal */ }
    });

    // Sleep — 7-day history
    this.http.get<{ success: boolean; days: SleepDayData[] }>(
      `${environment.apiUrl}/api/fitbit/sleep/week`
    ).subscribe({
      next: (res) => {
        if (res.success && res.days) {
          this.weekSleep.set(res.days);
          console.log(`[Dashboard] Sleep week loaded: ${res.days.length} days`);
        }
      },
      error: () => { /* Non-fatal */ }
    });

    
    // Sleep — month history
    this.http.get<{ success: boolean; history: any[] }>(`${environment.apiUrl}/api/daily-metrics/sleep-history`).subscribe({
      next: (res) => {
        if (res.success && res.history) {
          this.monthSleep.set(res.history);
          console.log(`[Dashboard] Sleep month loaded: ${res.history.length} days`);
        }
      },
      error: () => { /* Non-fatal */ }
    });

    // Activities — today
    this.http.get<{ success: boolean } & ActivitySummary>(
      `${environment.apiUrl}/api/fitbit/activities/today?date=${localDate}`
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.activitiesData.set({ steps: res.steps, activeMinutes: res.activeMinutes, caloriesOut: res.caloriesOut, activities: res.activities });
          if (res.restingHR) this.restingHR.set(res.restingHR);
          console.log(`[Dashboard] Fitbit activities: ${res.activities.length} logged, ${res.steps} steps${res.restingHR ? ', HR=' + res.restingHR : ''}`);
        }
      },
      error: () => { /* Non-fatal */ }
    });

    // Vitals — weight, SpO2, VO2 max, respiratory rate
    this.http.get<{ success: boolean } & VitalsData>(
      `${environment.apiUrl}/api/fitbit/vitals/today?date=${localDate}`
    ).subscribe({
      next: (res) => {
        if (res.success) {
          const { success, ...vitals } = res;
          this.vitalsData.set(vitals as VitalsData);
          console.log('[Dashboard] Vitals loaded:', vitals);
        }
      },
      error: () => { /* Non-fatal */ }
    });

    // Stress & Energy — today
    this.http.get<{ success: boolean; metrics: { stress: { stress: string | null; energy: number | null; mentalState: string } } }>(
      `${environment.apiUrl}/api/daily-metrics?date=${localDate}`
    ).subscribe({
      next: (res) => {
        if (res.success && res.metrics?.stress) {
          this.stressEnergy.set(res.metrics.stress);
        }
      },
      error: () => { /* Non-fatal */ }
    });

    // Nutrition — food log + macros
    console.log(`[Dashboard] Fetching food log for local date: ${localDate}`);
    this.http.get<{ success: boolean } & FoodLog>(
      `${environment.apiUrl}/api/fitbit/nutrition/today?date=${localDate}`
    ).subscribe({
      next: (res) => {
        if (res.success) {
          const { success, ...food } = res;
          this.foodData.set(food as FoodLog);
          console.log(`[Dashboard] Food log loaded: ${food.entries.length} entries, ${food.totals.protein}g protein`);
        }
      },
      error: () => { /* Non-fatal */ }
    });
  }

  private boundNavigateToPanel!: EventListener;

  ngOnInit(): void {
    this.boundNavigateToPanel = (event: Event) => {
      const { panelId } = (event as CustomEvent).detail;
      this.setPanel(panelId);
    };
    window.addEventListener('navigate-to-panel', this.boundNavigateToPanel);
  }

  ngOnDestroy(): void {
    window.removeEventListener('navigate-to-panel', this.boundNavigateToPanel);
  }

  setPanel(panel: PanelId) {
    this.activePanel.set(panel);
    // Trigger panel-specific character animation
    const animMap: Partial<Record<PanelId, string>> = {
      acm:      'Praying',
      crafting: 'sword-idle',
    };
    const anim = animMap[panel] ?? 'idle';
    window.dispatchEvent(new CustomEvent('play-animation', { detail: { name: anim, loop: true } }));
  }

  onQuestDateChanged(date: string): void {
    const prev = this.selectedDate();
    this.selectedDate.set(date);
    if (date !== prev) {
      this.fetchFitbitForDate(date);
    }
  }

  private fetchFitbitForDate(date: string): void {
    this.sleepData.set(null);
    this.foodData.set(null);
    this.vitalsData.set(null);
    this.activitiesData.set(null);

    this.http.get<any>(`${environment.apiUrl}/api/fitbit/sleep/today?date=${date}`).subscribe({
      next: (res) => {
        if (res.success && res.sleep) {
          this.sleepData.set({ ...res.sleep, source: res.source });
          console.log(`[Dashboard] Sleep loaded for ${date}: score=${res.sleep.score}`);
        }
      },
      error: () => { /* Non-fatal */ }
    });

    this.http.get<{ success: boolean } & FoodLog>(
      `${environment.apiUrl}/api/fitbit/nutrition/today?date=${date}`
    ).subscribe({
      next: (res) => {
        if (res.success) {
          const { success, ...food } = res;
          this.foodData.set(food as FoodLog);
          console.log(`[Dashboard] Nutrition loaded for ${date}: ${food.entries.length} entries`);
        }
      },
      error: () => { /* Non-fatal */ }
    });

    this.http.get<any>(`${environment.apiUrl}/api/fitbit/vitals/today?date=${date}`).subscribe({
      next: (res) => {
        if (res.success) {
          const { success, ...vitals } = res;
          this.vitalsData.set(vitals as VitalsData);
        }
      },
      error: () => { /* Non-fatal */ }
    });

    this.http.get<{ success: boolean } & ActivitySummary>(
      `${environment.apiUrl}/api/fitbit/activities/today?date=${date}`
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.activitiesData.set({ steps: res.steps, activeMinutes: res.activeMinutes, caloriesOut: res.caloriesOut, activities: res.activities });
          if (res.restingHR) this.restingHR.set(res.restingHR);
        }
      },
      error: () => { /* Non-fatal */ }
    });
  }

  getClassNames(): string[] {
    const projection = this.xpProjection();
    return projection ? Object.keys(projection) : [];
  }

  /**
   * Looks up live DB class stats by display name (case-insensitive, handles 'Developer',
   * 'Warrior', 'Sage', etc. as returned by /api/character/stats → skillTrees[].name).
   * Returns null when character_stats hasn't been seeded yet (falls back to file data).
   */
  getDbClassStat(className: string): { level: number; currentXP: number; xpToNextLevel: number; percentToNext: number } | null {
    const trees = this.dbSkillTrees();
    if (!trees) return null;
    const lower = className.toLowerCase().replace(/[\s_-]/g, '');
    return trees.find(t => {
      const name = t.name.toLowerCase().replace(/[\s_-]/g, '');
      // Exact or fuzzy (Redteamer ↔ RedTeamOperator ↔ redteamer)
      return name === lower || name.includes(lower) || lower.includes(name);
    }) ?? null;
  }

  setStress(level: string): void {
    const cur = this.stressEnergy() ?? { stress: null, energy: null, mentalState: '' };
    this.stressEnergy.set({ ...cur, stress: level });
    this.seSave$.next();
  }

  setEnergy(n: number): void {
    const cur = this.stressEnergy() ?? { stress: null, energy: null, mentalState: '' };
    this.stressEnergy.set({ ...cur, energy: n });
    this.seSave$.next();
  }

  setMentalState(text: string): void {
    const cur = this.stressEnergy() ?? { stress: null, energy: null, mentalState: '' };
    this.stressEnergy.set({ ...cur, mentalState: text || '[To be logged]' });
    this.seSave$.next();
  }

  private saveStressEnergy(): void {
    const se = this.stressEnergy();
    if (!se) return;
    const localDate = new Date().toLocaleDateString('en-CA');
    this.seSaveStatus.set('saving');
    this.http.post(`${environment.apiUrl}/api/daily-metrics`, {
      date: localDate,
      metrics: { stress: se }
    }).subscribe({
      next: () => { this.seSaveStatus.set('saved'); setTimeout(() => this.seSaveStatus.set(''), 2000); },
      error: (e) => { console.error('[Dashboard] Stress save failed:', e); this.seSaveStatus.set(''); }
    });
  }

  stressLevelClass(stress: string | null): string {
    if (stress === 'High') return 'stress-high';
    if (stress === 'Medium') return 'stress-medium';
    if (stress === 'Low') return 'stress-low';
    return '';
  }

  energyLevelClass(energy: number | null): string {
    if (energy === null) return '';
    if (energy >= 8) return 'energy-high';
    if (energy >= 5) return 'energy-mid';
    return 'energy-low';
  }

  vitalityStatusClass(status: string): string {
    switch (status) {
      case 'Peak Condition': return 'vitality-peak';
      case 'Normal':         return 'vitality-normal';
      case 'Fatigued':       return 'vitality-fatigued';
      case 'Exhausted':      return 'vitality-exhausted';
      case 'Burnout':        return 'vitality-burnout';
      default:               return '';
    }
  }

  onActivityLogged(event: { xp: number; activityType: string }) {
    // Record combo first so guaranteeLoot() reflects the freshly-incremented count
    this.comboService.recordActivity();
    // Roll for a loot drop with pity + optional combo guarantee
    this.lootDrop.roll(event.activityType, this.comboService.guaranteeLoot());

    this.xpProjectionService.getProjections().subscribe({
      next: (data: any) => { this.xpProjection.set(data); },
      error: (err: any) => { console.error('[Dashboard] Projections refresh error:', err); }
    });
    this.xpProjectionService.getQuestLog().subscribe({
      next: (log: any) => { this.questLog = log; },
      error: (err: any) => { console.error('[Dashboard] Quest log refresh error:', err); }
    });
    this.xpProjectionService.getRecentGains().subscribe({
      next: (gains: any) => { this.recentXpGains = gains; },
      error: (err: any) => { console.error('[Dashboard] Recent gains refresh error:', err); }
    });
  }

  comboTierClass(): string {
    const n = this.comboService.comboCount();
    if (n >= 7) return 'tier-max';
    if (n >= 5) return 'tier-gold';
    if (n >= 3) return 'tier-silver';
    return '';
  }

  comboTierLabel(): string {
    const n = this.comboService.comboCount();
    if (n >= 7) return '★ MAX';
    if (n >= 5) return '▲▲';
    if (n >= 3) return '▲';
    return '';
  }

  onLogout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
