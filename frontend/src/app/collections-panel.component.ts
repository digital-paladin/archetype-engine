import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

// ── Static data ──────────────────────────────────────────────────────────────

type Category = 'armor' | 'titles' | 'trophies';

interface ArmorPiece {
  id: string; name: string; slot: string;
  symbol: string; symbolColor: string; borderColor: string;
  unlockLevel: number; verse: string; description: string;
}
interface TitleDef {
  id: string; name: string; unlockStreak: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  description: string;
}
interface TrophyDef {
  id: string; name: string; icon: string;
  unlockStreak: number; description: string;
}

const ARMOR_PIECES: ArmorPiece[] = [
  {
    id: 'belt',        name: 'Belt of Truth',                slot: 'Waist',
    symbol: 'T',       symbolColor: '#f2c96a',  borderColor: '#c9a84c',
    unlockLevel: 1,    verse: 'Eph 6:14',
    description: 'Stand firm with the belt of truth buckled around your waist.',
  },
  {
    id: 'boots',       name: 'Boots of Peace',               slot: 'Feet',
    symbol: 'P',       symbolColor: '#4caf6e',  borderColor: '#2e7d4a',
    unlockLevel: 5,    verse: 'Eph 6:15',
    description: 'Feet fitted with the readiness of the gospel of peace.',
  },
  {
    id: 'breastplate', name: 'Breastplate of Righteousness', slot: 'Chest',
    symbol: 'R',       symbolColor: '#e05c44',  borderColor: '#a83a2a',
    unlockLevel: 10,   verse: 'Eph 6:14',
    description: 'The breastplate of righteousness in place.',
  },
  {
    id: 'helmet',      name: 'Helmet of Salvation',          slot: 'Head',
    symbol: 'S',       symbolColor: '#5ba0d0',  borderColor: '#3a78a8',
    unlockLevel: 15,   verse: 'Eph 6:17',
    description: 'Take the helmet of salvation.',
  },
  {
    id: 'shield',      name: 'Shield of Faith',              slot: 'Off-Hand',
    symbol: 'F',       symbolColor: '#c084fc',  borderColor: '#7c3aed',
    unlockLevel: 20,   verse: 'Eph 6:16',
    description: 'The shield of faith to extinguish all flaming arrows.',
  },
  {
    id: 'sword',       name: 'Sword of the Spirit',          slot: 'Main Hand',
    symbol: '✦',       symbolColor: '#ffd700',  borderColor: '#b8860b',
    unlockLevel: 25,   verse: 'Eph 6:17',
    description: 'The sword of the Spirit — the word of God.',
  },
];

const TITLES: TitleDef[] = [
  { id: 'initiate', name: 'Paladin Initiate',      unlockStreak: 0,   rarity: 'common',    description: 'Began the archetype journey.' },
  { id: 'seeker',   name: 'Steadfast Seeker',       unlockStreak: 90,  rarity: 'uncommon',  description: '90-day continuous streak achieved.' },
  { id: 'keeper',   name: 'Iron Will Keeper',        unlockStreak: 180, rarity: 'rare',      description: '180 days of unbroken discipline.' },
  { id: 'faithful', name: 'Faithful Dawn Warrior',  unlockStreak: 365, rarity: 'epic',      description: 'One full year of steadfast commitment.' },
  { id: 'unbroken', name: 'Unbroken Paladin',        unlockStreak: 730, rarity: 'legendary', description: 'Two years — legendary status achieved.' },
];

const TROPHIES: TrophyDef[] = [
  { id: 'week',     name: 'First Week',          icon: '◆', unlockStreak: 7,   description: 'Complete a 7-day streak'   },
  { id: 'month',    name: 'Month of Iron',        icon: '⬡', unlockStreak: 30,  description: 'Complete a 30-day streak'  },
  { id: 'century',  name: 'Iron Century',         icon: '◉', unlockStreak: 100, description: 'Complete a 100-day streak' },
  { id: 'halfyear', name: 'Half-Year Sentinel',   icon: '✦', unlockStreak: 180, description: 'Complete a 180-day streak' },
  { id: 'year',     name: 'Year-Long Warrior',    icon: '★', unlockStreak: 365, description: 'Complete a 365-day streak' },
  { id: 'twoyear',  name: 'Two-Year Legend',      icon: '♦', unlockStreak: 730, description: 'Complete a 730-day streak' },
];

const CATEGORIES: { id: Category; icon: string; label: string }[] = [
  { id: 'armor',    icon: '⚔', label: 'ARMOR OF GOD' },
  { id: 'titles',   icon: '◆', label: 'TITLES'        },
  { id: 'trophies', icon: '🏆', label: 'TROPHIES'     },
];

const RARITY_COLOR: Record<string, string> = {
  common:    '#a08858',
  uncommon:  '#4ade80',
  rare:      '#60a5fa',
  epic:      '#c084fc',
  legendary: '#ffd700',
};

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-collections-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="clp-root">

  <!-- Loading -->
  <div *ngIf="isLoading()" class="clp-loading">◈ Loading collections...</div>

  <ng-container *ngIf="!isLoading()">

    <!-- ── Left sidebar ─────────────────────────────────────────── -->
    <div class="clp-sidebar">
      <!-- Search -->
      <div class="clp-filter-lbl">Filter By</div>
      <div class="clp-search-wrap">
        <input class="clp-search" type="text" placeholder="Search"
               [value]="searchTerm()" (input)="onSearch($event)">
      </div>

      <!-- Category rows -->
      <div *ngFor="let cat of CATEGORIES" class="clp-cat-row"
           [class.clp-cat-active]="activeCategory() === cat.id"
           (click)="activeCategory.set(cat.id)">
        <span class="clp-cat-icon">{{ cat.icon }}</span>
        <span class="clp-cat-nm">{{ cat.label }}</span>
        <span class="clp-cat-badge">{{ categoryCount(cat.id) }}</span>
      </div>
    </div>

    <!-- ── Right content ────────────────────────────────────────── -->
    <div class="clp-content">

      <!-- Content header -->
      <div class="clp-content-hdr">
        <span class="clp-content-title">{{ activeCategoryLabel() }}</span>
        <span class="clp-total-pill">{{ totalCount() }} total</span>
      </div>

      <!-- ══ ARMOR OF GOD ══ -->
      <ng-container *ngIf="activeCategory() === 'armor'">

        <!-- Section: Worn -->
        <div *ngIf="equippedArmor().length > 0">
          <div class="clp-section-hdr">
            EQUIPPED
            <span class="clp-section-count">{{ equippedArmor().length }} / {{ ARMOR_LEN }}</span>
          </div>
          <div class="clp-grid">
            <div *ngFor="let p of equippedArmor()" class="clp-piece clp-piece-worn"
                 (click)="toggleArmor(p)">
              <span class="clp-badge clp-badge-worn">WORN</span>
              <div class="clp-piece-icon"
                   [style.border-color]="p.borderColor"
                   [style.box-shadow]="'0 0 14px ' + p.borderColor + '66'">
                <span class="clp-piece-sym" [style.color]="p.symbolColor">{{ p.symbol }}</span>
              </div>
              <div class="clp-piece-nm">{{ p.name }}</div>
              <div class="clp-piece-verse">{{ p.verse }}</div>
            </div>
          </div>
        </div>

        <!-- Section: Not Equipped (unlocked) -->
        <div *ngIf="availableArmor().length > 0">
          <div class="clp-section-hdr">NOT EQUIPPED</div>
          <div class="clp-grid">
            <div *ngFor="let p of availableArmor()" class="clp-piece clp-piece-available"
                 (click)="toggleArmor(p)">
              <div class="clp-piece-icon" style="border-color: rgba(155,115,38,0.35)">
                <span class="clp-piece-sym" [style.color]="p.symbolColor">{{ p.symbol }}</span>
              </div>
              <div class="clp-piece-nm">{{ p.name }}</div>
              <div class="clp-piece-verse">{{ p.verse }}</div>
            </div>
          </div>
        </div>

        <!-- Section: Locked -->
        <div *ngIf="lockedArmor().length > 0">
          <div class="clp-section-hdr">NOT COLLECTED</div>
          <div class="clp-grid">
            <div *ngFor="let p of lockedArmor()" class="clp-piece clp-piece-locked">
              <span class="clp-badge clp-badge-locked">L{{ p.unlockLevel }}</span>
              <div class="clp-piece-icon clp-icon-locked">
                <span class="clp-piece-sym clp-sym-locked">{{ p.symbol }}</span>
              </div>
              <div class="clp-lock-icon">🔒</div>
              <div class="clp-piece-nm clp-name-locked">{{ p.name }}</div>
              <div class="clp-piece-verse clp-verse-locked">Level {{ p.unlockLevel }} required</div>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div *ngIf="equippedArmor().length === 0 && availableArmor().length === 0 && lockedArmor().length === 0"
             class="clp-empty">No results for "{{ searchTerm() }}"</div>

      </ng-container>

      <!-- ══ TITLES ══ -->
      <ng-container *ngIf="activeCategory() === 'titles'">

        <!-- Unlocked titles -->
        <div *ngIf="unlockedTitles().length > 0">
          <div class="clp-section-hdr">COLLECTED</div>
          <div class="clp-title-grid">
            <div *ngFor="let t of unlockedTitles()" class="clp-title-card"
                 [class.clp-title-active]="activeTitle() === t.id"
                 (click)="selectTitle(t)">
              <span *ngIf="activeTitle() === t.id" class="clp-badge clp-badge-worn">ACTIVE</span>
              <div class="clp-title-rarity" [style.color]="rarityColor(t.rarity)">{{ t.rarity | uppercase }}</div>
              <div class="clp-title-nm" [style.color]="activeTitle() === t.id ? '#f2c96a' : '#e2cfa8'">{{ t.name }}</div>
              <div class="clp-title-desc">{{ t.description }}</div>
            </div>
          </div>
        </div>

        <!-- Locked titles -->
        <div *ngIf="lockedTitles().length > 0">
          <div class="clp-section-hdr">NOT COLLECTED</div>
          <div class="clp-title-grid">
            <div *ngFor="let t of lockedTitles()" class="clp-title-card clp-title-locked">
              <span class="clp-badge clp-badge-locked">{{ t.unlockStreak }}d</span>
              <div class="clp-title-rarity" [style.color]="rarityColor(t.rarity)">{{ t.rarity | uppercase }}</div>
              <div class="clp-title-nm clp-name-locked">{{ t.name }}</div>
              <div class="clp-title-desc">{{ t.unlockStreak }}-day streak required</div>
            </div>
          </div>
        </div>

        <div *ngIf="unlockedTitles().length === 0 && lockedTitles().length === 0"
             class="clp-empty">No results for "{{ searchTerm() }}"</div>

      </ng-container>

      <!-- ══ TROPHIES ══ -->
      <ng-container *ngIf="activeCategory() === 'trophies'">

        <div *ngIf="earnedTrophies().length > 0">
          <div class="clp-section-hdr">EARNED</div>
          <div class="clp-grid">
            <div *ngFor="let t of earnedTrophies()" class="clp-piece clp-piece-available clp-trophy">
              <div class="clp-trophy-icon">{{ t.icon }}</div>
              <div class="clp-piece-nm">{{ t.name }}</div>
              <div class="clp-piece-verse">{{ t.description }}</div>
            </div>
          </div>
        </div>

        <div *ngIf="lockedTrophies().length > 0">
          <div class="clp-section-hdr">NOT EARNED</div>
          <div class="clp-grid">
            <div *ngFor="let t of lockedTrophies()" class="clp-piece clp-piece-locked clp-trophy">
              <span class="clp-badge clp-badge-locked">{{ t.unlockStreak }}d</span>
              <div class="clp-trophy-icon clp-sym-locked">{{ t.icon }}</div>
              <div class="clp-piece-nm clp-name-locked">{{ t.name }}</div>
              <div class="clp-piece-verse clp-verse-locked">{{ t.unlockStreak }}-day streak</div>
            </div>
          </div>
        </div>

        <div *ngIf="earnedTrophies().length === 0 && lockedTrophies().length === 0"
             class="clp-empty">No results for "{{ searchTerm() }}"</div>

      </ng-container>

    </div><!-- /clp-content -->

  </ng-container>
</div>
  `,
  styles: [`
    :host { display: block; height: 100%; }

    /* ── Root ────────────────────────────────────────────────────── */
    .clp-root {
      display: flex; height: 100%;
      background: var(--eso-bg-panel, #120e07);
      font-family: 'Cinzel', serif;
      overflow: hidden;
    }
    .clp-loading {
      flex: 1; display: flex; align-items: center; justify-content: center;
      font-size: 12px; letter-spacing: 1.5px;
      color: var(--eso-text-dim, #a08858);
    }

    /* ── Left sidebar ────────────────────────────────────────────── */
    .clp-sidebar {
      width: 215px; flex-shrink: 0;
      background: rgba(0,0,0,0.38);
      border-right: 1px solid rgba(155,115,38,0.20);
      display: flex; flex-direction: column;
      padding: 0;
    }
    .clp-filter-lbl {
      font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
      color: rgba(168,145,88,0.50); padding: 12px 14px 6px;
    }
    .clp-search-wrap { padding: 0 10px 10px; }
    .clp-search {
      width: 100%; box-sizing: border-box;
      background: rgba(0,0,0,0.55); border: 1px solid rgba(155,115,38,0.30);
      color: var(--eso-text, #e2cfa8); font-family: 'Cinzel', serif;
      font-size: 11px; padding: 5px 9px; outline: none;
    }
    .clp-search:focus { border-color: rgba(201,168,76,0.55); }
    .clp-search::placeholder { color: rgba(168,145,88,0.35); }

    .clp-cat-row {
      display: flex; align-items: center; gap: 9px;
      padding: 9px 14px; cursor: pointer;
      border-left: 3px solid transparent;
      transition: background 0.12s;
    }
    .clp-cat-row:hover { background: rgba(201,168,76,0.06); }
    .clp-cat-active {
      background: rgba(201,168,76,0.10);
      border-left-color: var(--eso-gold, #c9a84c);
    }
    .clp-cat-icon { font-size: 12px; opacity: 0.8; }
    .clp-cat-nm {
      flex: 1; font-size: 10px; letter-spacing: 1.5px; font-weight: 700;
      color: var(--eso-text, #d4b483);
    }
    .clp-cat-active .clp-cat-nm { color: var(--eso-gold, #c9a84c); }
    .clp-cat-badge {
      font-size: 9px; color: rgba(168,145,88,0.50);
      background: rgba(0,0,0,0.35); border: 1px solid rgba(155,115,38,0.20);
      padding: 1px 5px; min-width: 16px; text-align: center;
    }

    /* ── Right content area ────────────────────────────────────────── */
    .clp-content {
      flex: 1; overflow-y: auto; padding: 0;
      display: flex; flex-direction: column; gap: 0;
    }
    .clp-content-hdr {
      display: flex; justify-content: space-between; align-items: center;
      padding: 11px 18px 10px;
      border-bottom: 1px solid rgba(155,115,38,0.20);
      background: rgba(0,0,0,0.30);
      position: sticky; top: 0; z-index: 1;
    }
    .clp-content-title {
      font-size: 14px; font-weight: 700; letter-spacing: 3px;
      color: var(--eso-gold-bright, #f2c96a);
      text-shadow: 0 0 20px rgba(242,201,106,0.25);
    }
    .clp-total-pill {
      font-size: 9px; letter-spacing: 1px;
      color: rgba(168,145,88,0.45);
      border: 1px solid rgba(155,115,38,0.18); padding: 2px 8px;
    }

    /* ── Section headers ─────────────────────────────────────────── */
    .clp-section-hdr {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 18px 7px;
      font-size: 9.5px; font-weight: 700; letter-spacing: 2px;
      color: rgba(168,145,88,0.55);
      border-bottom: 1px solid rgba(155,115,38,0.12);
    }
    .clp-section-count {
      font-size: 9px; color: rgba(168,145,88,0.40);
      background: rgba(0,0,0,0.35); border: 1px solid rgba(155,115,38,0.15);
      padding: 1px 6px;
    }

    /* ── Armor grid ──────────────────────────────────────────────── */
    .clp-grid {
      display: flex; flex-wrap: wrap; gap: 8px;
      padding: 12px 18px;
    }
    .clp-piece {
      width: 130px; min-height: 160px;
      background: rgba(0,0,0,0.45);
      border: 1px solid rgba(155,115,38,0.20);
      padding: 10px 8px 8px;
      display: flex; flex-direction: column; align-items: center;
      gap: 5px; position: relative; transition: border-color 0.15s;
      cursor: default;
    }
    .clp-piece-available { cursor: pointer; }
    .clp-piece-available:hover {
      border-color: rgba(201,168,76,0.45);
      background: rgba(201,168,76,0.045);
    }
    .clp-piece-worn {
      cursor: pointer;
      border-color: var(--eso-gold, #c9a84c);
      background: rgba(201,168,76,0.06);
    }
    .clp-piece-worn:hover { background: rgba(201,168,76,0.10); }
    .clp-piece-locked { opacity: 0.55; }

    .clp-piece-icon {
      width: 60px; height: 60px; margin-top: 4px;
      background: rgba(0,0,0,0.55);
      border: 2px solid rgba(155,115,38,0.30);
      display: flex; align-items: center; justify-content: center;
      position: relative;
    }
    .clp-icon-locked { filter: grayscale(0.8); }
    .clp-piece-sym { font-size: 26px; font-weight: 900; font-family: 'Cinzel', serif; }
    .clp-sym-locked { opacity: 0.35; }
    .clp-lock-icon { font-size: 12px; margin-top: -4px; }

    .clp-piece-nm {
      font-size: 10px; font-weight: 700; text-align: center;
      color: var(--eso-text, #d4b483); letter-spacing: 0.3px;
      line-height: 1.3;
    }
    .clp-piece-verse {
      font-size: 9px; color: var(--eso-text-dim, #a08858);
      text-align: center; letter-spacing: 0.3px;
    }
    .clp-name-locked { color: rgba(168,145,88,0.40) !important; }
    .clp-verse-locked { color: rgba(168,145,88,0.30) !important; }

    /* Badges */
    .clp-badge {
      position: absolute; top: 5px; right: 5px;
      font-size: 7.5px; font-weight: 700; letter-spacing: 0.8px;
      padding: 2px 5px;
    }
    .clp-badge-worn {
      background: rgba(201,168,76,0.20); border: 1px solid var(--eso-gold, #c9a84c);
      color: var(--eso-gold-bright, #f2c96a);
    }
    .clp-badge-locked {
      background: rgba(0,0,0,0.50); border: 1px solid rgba(100,100,100,0.40);
      color: rgba(168,145,88,0.55);
    }

    /* Trophy variant */
    .clp-trophy .clp-piece-icon { display: none; }
    .clp-trophy-icon { font-size: 32px; margin: 8px 0 2px; }

    /* ── Title cards ─────────────────────────────────────────────── */
    .clp-title-grid {
      display: flex; flex-wrap: wrap; gap: 8px;
      padding: 12px 18px;
    }
    .clp-title-card {
      width: 190px; min-height: 95px;
      background: rgba(0,0,0,0.45);
      border: 1px solid rgba(155,115,38,0.20);
      padding: 10px 12px;
      display: flex; flex-direction: column; gap: 4px;
      position: relative; cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .clp-title-card:hover { border-color: rgba(201,168,76,0.40); background: rgba(201,168,76,0.04); }
    .clp-title-active {
      border-color: var(--eso-gold, #c9a84c);
      background: rgba(201,168,76,0.07);
      box-shadow: 0 0 16px rgba(201,168,76,0.18);
    }
    .clp-title-locked { opacity: 0.55; cursor: default; }
    .clp-title-locked:hover { border-color: rgba(155,115,38,0.20) !important; background: rgba(0,0,0,0.45) !important; }

    .clp-title-rarity {
      font-size: 8px; letter-spacing: 2px; font-weight: 700;
      margin-bottom: 2px;
    }
    .clp-title-nm {
      font-size: 13px; font-weight: 700; letter-spacing: 0.5px;
      color: var(--eso-text, #e2cfa8);
      line-height: 1.2;
    }
    .clp-title-desc {
      font-size: 10px; color: var(--eso-text-dim, #a08858);
      font-style: italic; margin-top: 2px;
    }

    /* ── Empty state ─────────────────────────────────────────────── */
    .clp-empty {
      padding: 40px 18px; text-align: center;
      font-size: 11px; color: rgba(168,145,88,0.35);
      letter-spacing: 0.5px;
    }

    /* ── Mobile: sidebar collapses to horizontal top nav bar ── */
    @media (max-width: 600px) {
      .clp-root    { flex-direction: column; overflow: unset; }
      .clp-sidebar {
        width: 100%; height: auto; flex-direction: row;
        flex-wrap: wrap; align-items: center; gap: 4px;
        overflow-x: auto; -webkit-overflow-scrolling: touch;
        border-right: none; border-bottom: 1px solid rgba(155,115,38,0.20);
        padding: 6px 10px;
      }
      .clp-filter-lbl  { display: none; }
      .clp-search-wrap { padding: 0; flex: 0 0 100%; margin-bottom: 4px; }
      .clp-cat-row {
        padding: 5px 10px; border-left: none;
        border-bottom: 2px solid transparent; white-space: nowrap;
      }
      .clp-cat-active {
        border-bottom-color: var(--eso-gold, #c9a84c) !important;
        background: transparent !important;
        border-left-color: transparent !important;
      }
    }
  `],
})
export class CollectionsPanelComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly CATEGORIES  = CATEGORIES;
  readonly ARMOR_LEN   = ARMOR_PIECES.length;

  isLoading     = signal(true);
  sageStreak    = signal(0);
  maxClassLevel = signal(1);

  activeCategory = signal<Category>('armor');
  searchTerm     = signal<string>('');
  equippedPieces = signal<Set<string>>(new Set<string>());
  activeTitle    = signal<string>('initiate');

  // ── Computed: character level (highest class level, min 1) ──────────────
  characterLevel = computed(() => Math.max(this.maxClassLevel(), 1));

  // ── Computed: sectioned armor arrays ────────────────────────────────────
  equippedArmor = computed(() => {
    const equipped = this.equippedPieces();
    const level    = this.characterLevel();
    const term     = this.searchTerm().toLowerCase();
    return ARMOR_PIECES
      .filter(p => equipped.has(p.id) && level >= p.unlockLevel)
      .filter(p => !term || p.name.toLowerCase().includes(term));
  });

  availableArmor = computed(() => {
    const equipped = this.equippedPieces();
    const level    = this.characterLevel();
    const term     = this.searchTerm().toLowerCase();
    return ARMOR_PIECES
      .filter(p => !equipped.has(p.id) && level >= p.unlockLevel)
      .filter(p => !term || p.name.toLowerCase().includes(term));
  });

  lockedArmor = computed(() => {
    const level = this.characterLevel();
    const term  = this.searchTerm().toLowerCase();
    return ARMOR_PIECES
      .filter(p => level < p.unlockLevel)
      .filter(p => !term || p.name.toLowerCase().includes(term));
  });

  // ── Computed: sectioned title arrays ────────────────────────────────────
  unlockedTitles = computed(() => {
    const streak = this.sageStreak();
    const term   = this.searchTerm().toLowerCase();
    return TITLES
      .filter(t => streak >= t.unlockStreak)
      .filter(t => !term || t.name.toLowerCase().includes(term));
  });

  lockedTitles = computed(() => {
    const streak = this.sageStreak();
    const term   = this.searchTerm().toLowerCase();
    return TITLES
      .filter(t => streak < t.unlockStreak)
      .filter(t => !term || t.name.toLowerCase().includes(term));
  });

  // ── Computed: trophy arrays ──────────────────────────────────────────────
  earnedTrophies = computed(() => {
    const streak = this.sageStreak();
    const term   = this.searchTerm().toLowerCase();
    return TROPHIES
      .filter(t => streak >= t.unlockStreak)
      .filter(t => !term || t.name.toLowerCase().includes(term));
  });

  lockedTrophies = computed(() => {
    const streak = this.sageStreak();
    const term   = this.searchTerm().toLowerCase();
    return TROPHIES
      .filter(t => streak < t.unlockStreak)
      .filter(t => !term || t.name.toLowerCase().includes(term));
  });

  // ── Computed: header helpers ─────────────────────────────────────────────
  activeCategoryLabel = computed(() =>
    CATEGORIES.find(c => c.id === this.activeCategory())?.label ?? '',
  );

  totalCount = computed(() => {
    const cat = this.activeCategory();
    if (cat === 'armor')   return ARMOR_PIECES.length;
    if (cat === 'titles')  return TITLES.length;
    return TROPHIES.length;
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.http.get<any>(`${environment.apiUrl}/api/character/stats`).subscribe({
      next: (data) => {
        const streak     = data.sageStreak ?? 0;
        const skillTrees = data.skillTrees ?? [];
        const maxLv      = skillTrees.length > 0
          ? Math.max(...skillTrees.map((st: any) => st.level ?? 0))
          : 1;

        this.sageStreak.set(streak);
        this.maxClassLevel.set(maxLv);

        // Equip Belt of Truth by default if level qualifies
        if (maxLv >= 1) {
          this.equippedPieces.set(new Set(['belt']));
        }

        // Set active title from streak
        if (streak >= 730)      this.activeTitle.set('unbroken');
        else if (streak >= 365) this.activeTitle.set('faithful');
        else if (streak >= 180) this.activeTitle.set('keeper');
        else if (streak >= 90)  this.activeTitle.set('seeker');
        else                    this.activeTitle.set('initiate');

        this.isLoading.set(false);
      },
      error: () => {
        // Show with default values on error
        this.equippedPieces.set(new Set(['belt']));
        this.isLoading.set(false);
      },
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  toggleArmor(piece: ArmorPiece): void {
    if (this.characterLevel() < piece.unlockLevel) return;
    const next = new Set(this.equippedPieces());
    if (next.has(piece.id)) next.delete(piece.id);
    else next.add(piece.id);
    this.equippedPieces.set(next);
  }

  selectTitle(title: TitleDef): void {
    if (this.sageStreak() < title.unlockStreak) return;
    this.activeTitle.set(title.id);
  }

  onSearch(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  // ── Sidebar category count badges ────────────────────────────────────────
  categoryCount(id: Category): number {
    if (id === 'armor')    return this.equippedArmor().length;
    if (id === 'titles')   return this.unlockedTitles().length;
    return this.earnedTrophies().length;
  }

  rarityColor(rarity: string): string {
    return RARITY_COLOR[rarity] ?? '#a08858';
  }
}
