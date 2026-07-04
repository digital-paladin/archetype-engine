import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

// ── Tier system mirrors ESO item quality colours ──────────────────────────────
export type ConsumableTier = 'Legendary' | 'Epic' | 'Superior' | 'Fine' | 'Normal';
export type ConsumableType = 'Meal' | 'Drink' | 'Supplement';
export type BuffType =
  | 'Recovery'       // protein/sleep quality
  | 'Endurance'      // sustained energy, fasting support
  | 'Strength'       // strength training, muscle building
  | 'Focus'          // mental clarity, deep work
  | 'Vitality'       // overall health, LDL/inflammation
  | 'Hydration';     // fluid balance, performance

export interface Consumable {
  id: number;
  loreName: string;           // ESO-style fantasy name
  realFood: string;           // real-world food label (customize per archetype)
  tier: ConsumableTier;
  type: ConsumableType;
  buffType: BuffType;
  buffValue: string;          // e.g. "+15% XP Consolidation"
  duration: string;           // e.g. "30 min", "3 hrs"
  protein: number;            // grams
  calories: number;
  description: string;        // lore flavour text
  waterOz?: number;           // fl oz per serving (water/drink items for hydration tracking)
}

// ── Consumables Catalogue — example Paladin archetype entries (fork & customize) ─────
export const CONSUMABLES: Consumable[] = [

  // ── LEGENDARY (5) — gold ──────────────────────────────────────────────────
  {
    id: 1,
    loreName: "Warden's Chimichurri Offering",
    realFood: 'Chicken & beef chimichurri bowl',
    tier: 'Legendary',
    type: 'Meal',
    buffType: 'Strength',
    buffValue: '+15% Warrior XP · +10% Consolidation',
    duration: '3 hrs',
    protein: 37,
    calories: 400,
    description: 'A sacred offering of sun-dried herbs and flame-kissed meats. Consumed by paladins before their most demanding trials. The dual-protein fusion awakens dormant muscle memory.',
  },
  {
    id: 2,
    loreName: "Sage's Salmon Rite",
    realFood: 'Atlantic salmon fillet (6 oz)',
    tier: 'Legendary',
    type: 'Meal',
    buffType: 'Vitality',
    buffValue: '+15% Vitality Score · −8 LDL Shadow',
    duration: '4 hrs',
    protein: 34,
    calories: 280,
    description: 'Harvested from icy northern depths. The omega-3 essence binds to arterial walls, dissolving the Shadow of Inflammation with each passing hour.',
  },
  {
    id: 3,
    loreName: 'Iron Egg Benediction',
    realFood: 'Three organic eggs, sunny side up',
    tier: 'Legendary',
    type: 'Meal',
    buffType: 'Recovery',
    buffValue: '+12% XP Consolidation · +Dawn Warrior Buff',
    duration: '3 hrs',
    protein: 18,
    calories: 210,
    description: 'The egg is the oldest covenant between warrior and sunrise. Three cracked at dawn grants the Faithful Dawn Warrior title buff for the morning session. Do not break the yolk.',
  },
  {
    id: 4,
    loreName: "Vodka Phantom Harvest",
    realFood: 'Creamy chicken with squash & spinach',
    tier: 'Legendary',
    type: 'Meal',
    buffType: 'Recovery',
    buffValue: '+13% Consolidation · +Parmesan Pardon buff',
    duration: '3 hrs',
    protein: 33,
    calories: 350,
    description: 'A ghost recipe whose origins are lost to the northern mists. The creamy vodka reduction dissolves fatigue toxins; the squash channels earth energy through the spine.',
  },
  {
    id: 5,
    loreName: "Snap Rogue's Roasted Offering",
    realFood: 'Roasted salmon fillets',
    tier: 'Legendary',
    type: 'Meal',
    buffType: 'Vitality',
    buffValue: '+12% Vitality · +Focus Sharpening',
    duration: '3 hrs',
    protein: 22,
    calories: 220,
    description: 'Prepared by the Snap Kitchen alchemists using a slow-roast ritual. Compact, potent, and precise — the rogue\'s equivalent of a sealed spell scroll.',
  },

  // ── EPIC (8) — purple ─────────────────────────────────────────────────────
  {
    id: 6,
    loreName: 'Bolognese Crucible',
    realFood: 'High-protein pasta with bolognese sauce',
    tier: 'Epic',
    type: 'Meal',
    buffType: 'Strength',
    buffValue: '+12% Warrior XP · +Carb Surge (2 hrs)',
    duration: '3 hrs',
    protein: 25,
    calories: 500,
    description: 'The crucible where legumes meet beast. The Barilla alchemists infused the pasta with pea protein runes. Best consumed before compound lifts or long deep-work slates.',
  },
  {
    id: 7,
    loreName: "Portobello Knight's Melt",
    realFood: 'Portobello chicken melt sandwich (half)',
    tier: 'Epic',
    type: 'Meal',
    buffType: 'Focus',
    buffValue: '+10% Developer XP · +Cognitive Haste (2 hrs)',
    duration: '2.5 hrs',
    protein: 20,
    calories: 600,
    description: 'The mushroom is the knight\'s helm — layered, earthy, resilient. Central Market\'s melt conceals grilled chicken beneath a portobello crown. Sharpens focus for analytical combat.',
  },
  {
    id: 8,
    loreName: "Manchego Paladin's Press",
    realFood: 'Turkey & manchego panini',
    tier: 'Epic',
    type: 'Meal',
    buffType: 'Strength',
    buffValue: '+50g Protein Surge · +Endurance Covenant',
    duration: '4 hrs',
    protein: 50,
    calories: 600,
    description: 'A pressed covenant between the shepherd\'s manchego and the turkey sovereign. The highest single-serving protein yield in the known realm. Reserved for max-effort training days.',
  },
  {
    id: 9,
    loreName: 'Cava Oracle Bowl',
    realFood: 'Grain bowl — sweet potato, beef, vegetables',
    tier: 'Epic',
    type: 'Meal',
    buffType: 'Vitality',
    buffValue: '+10% All XP · +Prismatic Nourishment',
    duration: '4 hrs',
    protein: 25,
    calories: 700,
    description: 'A prophecy bowl built from seven colours of nourishment. The clay vessel channels the Oracle\'s wisdom — eat this when many systems require alignment simultaneously.',
  },
  {
    id: 10,
    loreName: "Southwest Scroll Salad",
    realFood: 'Southwest pasta salad with chicken',
    tier: 'Epic',
    type: 'Meal',
    buffType: 'Endurance',
    buffValue: '+10% Fasting Resistance · +Carb Reserve',
    duration: '3 hrs',
    protein: 13,
    calories: 380,
    description: 'An ancient recipe sealed in a clay bowl. The southwest spices create a thermal barrier against hunger. Ideal for breaking a fast without spiking the restoration cost.',
  },
  {
    id: 11,
    loreName: "Caesar's Cipher Salad",
    realFood: 'Caesar pasta salad with chicken',
    tier: 'Epic',
    type: 'Meal',
    buffType: 'Focus',
    buffValue: '+8% Developer XP · +Lore Comprehension',
    duration: '2.5 hrs',
    protein: 19,
    calories: 360,
    description: 'Named for the ancient strategic genius whose clarity of mind is encoded into each toss. The romaine matrix amplifies analytical processing. Pairs well with documentation sprints.',
  },
  {
    id: 12,
    loreName: 'Cauliflower Siege Plate',
    realFood: 'BBQ chicken & cauliflower bowl',
    tier: 'Epic',
    type: 'Meal',
    buffType: 'Strength',
    buffValue: '+11% Warrior XP · +Low-Calorie Mass',
    duration: '3 hrs',
    protein: 36,
    calories: 350,
    description: 'A siege weapon disguised as a meal. High protein, deceptively low calorie. The BBQ rune was inscribed by a warrior who sought strength without the burden of excess mass.',
  },
  {
    id: 13,
    loreName: "Grilled Chicken Rune Bites",
    realFood: 'Grilled Chicken Bites',
    tier: 'Epic',
    type: 'Meal',
    buffType: 'Strength',
    buffValue: '+30g Pure Protein · +Lean Mass Covenant',
    duration: '2 hrs',
    protein: 30,
    calories: 200,
    description: 'Each bite is a micro-inscription of the lean mass covenant. Simple, clean, and without corruption. The warrior who eats these will not carry dead weight into battle.',
  },

  // ── SUPERIOR (10) — blue ──────────────────────────────────────────────────
  {
    id: 14,
    loreName: 'Premier Strawberry Elixir',
    realFood: 'Protein shake (strawberry)',
    tier: 'Superior',
    type: 'Drink',
    buffType: 'Recovery',
    buffValue: '+30g Recovery Surge · +Fasted Protocol',
    duration: '1.5 hrs',
    protein: 30,
    calories: 160,
    description: 'A rose-hued elixir carried in silver flasks by long-distance paladins. Rapid absorption makes it the preferred break-fast ritual. The strawberry rune suppresses appetite for 90 minutes.',
  },
  {
    id: 15,
    loreName: 'Mediterranean Oracle Salad',
    realFood: 'Mediterranean salad bowl',
    tier: 'Superior',
    type: 'Meal',
    buffType: 'Vitality',
    buffValue: '+8% Vitality · +Olive Covenant',
    duration: '2.5 hrs',
    protein: 13,
    calories: 320,
    description: 'A windswept composition of sun-drenched ingredients from the coastal temples. The olive covenant reduces systemic inflammation, granting the Vitality buff for the afternoon.',
  },
  {
    id: 16,
    loreName: "Dumplings of the Wandering Cleric",
    realFood: 'Light chicken & dumplings soup',
    tier: 'Superior',
    type: 'Meal',
    buffType: 'Recovery',
    buffValue: '+Comfort Buff · +Light Restoration',
    duration: '2 hrs',
    protein: 10,
    calories: 150,
    description: 'The cleric\'s field ration — light enough to carry in a pouch, restorative enough to heal a moderate HP drain. Best for sick days, easy days, or when the body speaks softly.',
  },
  {
    id: 17,
    loreName: "Paladin's Grain Codex",
    realFood: 'Whole grain bread (2 slices)',
    tier: 'Superior',
    type: 'Meal',
    buffType: 'Endurance',
    buffValue: '+Sustained Carb Release · +Fibre Ward',
    duration: '3 hrs',
    protein: 12,
    calories: 220,
    description: 'Twenty-one ancient grains compressed into a protective ward. The Killer Codex releases energy steadily, preventing the crash that breaks lesser warriors at hour two of deep work.',
  },
  {
    id: 18,
    loreName: 'Wild Rice Pilgrim Soup',
    realFood: 'Chicken wild rice soup',
    tier: 'Superior',
    type: 'Meal',
    buffType: 'Recovery',
    buffValue: '+14g Warm Restoration · +Pilgrimage Buff',
    duration: '2 hrs',
    protein: 14,
    calories: 220,
    description: 'A pilgrim\'s bowl offered at every fire between settlements. The wild rice retains warmth long after the caldron cools. A gentle restorative — not for war, but for recovery between battles.',
  },
  {
    id: 19,
    loreName: 'Strawberry Kefir Communion',
    realFood: 'Strawberry kefir drink (20 fl oz)',
    tier: 'Superior',
    type: 'Drink',
    buffType: 'Vitality',
    buffValue: '+Gut Alignment · +10g Recovery',
    duration: '2 hrs',
    protein: 10,
    calories: 220,
    description: 'A sacred ferment communion used in morning rituals. The living cultures bind with the gut microbiome guild, negotiating a peace treaty that improves nutrient absorption across all meals.',
  },
  {
    id: 20,
    loreName: "Warrior's Vanilla Accord",
    realFood: 'Vanilla probiotic yogurt',
    tier: 'Superior',
    type: 'Meal',
    buffType: 'Vitality',
    buffValue: '+Probiotic Covenant · +5g Recovery',
    duration: '1.5 hrs',
    protein: 5,
    calories: 120,
    description: 'A soft accord between comfort and discipline. The vanilla rune calms the adrenal axis after a stressful session. The probiotic seal holds the gut covenant for 4 hours.',
  },
  {
    id: 21,
    loreName: "Protein Bar of the Travelling Mage",
    realFood: 'Yogurt-covered pretzels (strawberry)',
    tier: 'Superior',
    type: 'Meal',
    buffType: 'Endurance',
    buffValue: '+Quick Carb Surge (45 min)',
    duration: '45 min',
    protein: 3,
    calories: 130,
    description: 'A traveller\'s ration laced with a minor arcane surge. The yogurt coating delivers a brief burst of mental agility. Use only when between true meals — not a substitute for the feast.',
  },
  {
    id: 22,
    loreName: "Ember-Glazed Panera Crest",
    realFood: 'Bakery soup & sandwich combo',
    tier: 'Superior',
    type: 'Meal',
    buffType: 'Focus',
    buffValue: '+Tavern Rest · +Ambient Clarity',
    duration: '2 hrs',
    protein: 15,
    calories: 500,
    description: 'The Panera Crest Inn serves as a waypoint for travelling scholars. The ambient warmth and bread aroma triggers the Tavern Rest buff — mental clarity without formal training.',
  },
  {
    id: 23,
    loreName: 'Iron Loaf Benediction',
    realFood: 'Whole grain bread (1 slice)',
    tier: 'Superior',
    type: 'Meal',
    buffType: 'Endurance',
    buffValue: '+Slow-Burn Carb Release',
    duration: '2 hrs',
    protein: 5,
    calories: 110,
    description: 'A single slice of the Iron Loaf Codex. Reliable, consistent, never dramatic. The paladin who maintains discipline through small actions is the one who survives long campaigns.',
  },

  // ── FINE (9) — green ──────────────────────────────────────────────────────
  {
    id: 24,
    loreName: 'Premier Vanilla Covenant',
    realFood: 'Protein shake (vanilla)',
    tier: 'Fine',
    type: 'Drink',
    buffType: 'Recovery',
    buffValue: '+30g Recovery · +Minor Consolidation',
    duration: '1.5 hrs',
    protein: 30,
    calories: 160,
    description: 'The vanilla sibling of the Strawberry Elixir. Carries the same protein covenant but in a more subdued register. Favoured by scholars who prefer neutral flavour profiles during study.',
  },
  {
    id: 25,
    loreName: "Scout's Sunrise Scramble",
    realFood: '2 Eggs (any style)',
    tier: 'Fine',
    type: 'Meal',
    buffType: 'Recovery',
    buffValue: '+12g Morning Restoration',
    duration: '2 hrs',
    protein: 12,
    calories: 140,
    description: 'Two eggs — the scout\'s minimum viable dawn ritual. Not as powerful as the Iron Egg Benediction, but sufficient to open the skill tree for the morning session.',
  },
  {
    id: 26,
    loreName: "Merchant's Grain Pouch",
    realFood: 'Oatmeal (instant or rolled)',
    tier: 'Fine',
    type: 'Meal',
    buffType: 'Endurance',
    buffValue: '+Beta-Glucan Shield · +Cholesterol Ward',
    duration: '3 hrs',
    protein: 6,
    calories: 170,
    description: 'A merchant\'s staple found in every market. The beta-glucan shield deflects LDL shadow damage over 4 hours. Humble in appearance — significant in long-term cardiovascular protection.',
  },
  {
    id: 27,
    loreName: 'Sentinel Rice Foundation',
    realFood: 'White or Brown Rice (1 cup)',
    tier: 'Fine',
    type: 'Meal',
    buffType: 'Endurance',
    buffValue: '+Carb Anchor · +Training Foundation',
    duration: '3 hrs',
    protein: 4,
    calories: 200,
    description: 'The foundation of every great fortification. Not glamorous, but every champion\'s training block rests upon it. The Sentinel Rice provides the stable carb base for strenuous activity.',
  },
  {
    id: 28,
    loreName: "Guardian's Sweet Tuber",
    realFood: 'Sweet Potato (medium, baked)',
    tier: 'Fine',
    type: 'Meal',
    buffType: 'Vitality',
    buffValue: '+Beta-Carotene Aura · +Vitamin A Ward',
    duration: '3 hrs',
    protein: 4,
    calories: 130,
    description: 'The guardian tuber, grown deep in fortified soil. Its orange magic channels Vitamin A into the visual cortex. Paladins who eat the tuber are the last to suffer night blindness.',
  },
  {
    id: 29,
    loreName: "Verdant Crucifer Ward",
    realFood: 'Broccoli (steamed or roasted)',
    tier: 'Fine',
    type: 'Meal',
    buffType: 'Vitality',
    buffValue: '+Sulforaphane Armor · +Cellular Repair',
    duration: '4 hrs',
    protein: 3,
    calories: 55,
    description: 'The forest\'s natural armour. Sulforaphane runes are etched into every floret, granting passive cellular repair throughout the afternoon. Small portion, extraordinary defence.',
  },
  {
    id: 30,
    loreName: "Avocado Druid's Spread",
    realFood: 'Avocado (½ medium)',
    tier: 'Fine',
    type: 'Meal',
    buffType: 'Vitality',
    buffValue: '+Monounsaturated Ward · +LDL Reduction',
    duration: '3 hrs',
    protein: 2,
    calories: 120,
    description: 'The druid\'s fat rune, spread thin across the codex. The monounsaturated covenant reduces arterial shadow damage for 3 hours. Double the serving for a Legendary-tier LDL effect.',
  },
  {
    id: 31,
    loreName: "Cottage Sentinel Curd",
    realFood: 'Cottage Cheese (½ cup, low-fat)',
    tier: 'Fine',
    type: 'Meal',
    buffType: 'Recovery',
    buffValue: '+14g Slow-Release Protein · +Night Restoration',
    duration: '6 hrs',
    protein: 14,
    calories: 110,
    description: 'A slow sentinel stationed at the gates of sleep. The casein protein patrols the bloodstream through the night, maintaining the muscle repair covenant far beyond other consumables.',
  },
  {
    id: 32,
    loreName: "Mango Awakening Sphere",
    realFood: 'Mango (1 cup, fresh or frozen)',
    tier: 'Fine',
    type: 'Meal',
    buffType: 'Endurance',
    buffValue: '+Quick Fructose Surge · +Vitamin C Ward',
    duration: '1.5 hrs',
    protein: 1,
    calories: 100,
    description: 'A sun-sphere from the southern groves. The quick sugar release fuels the first 15 minutes of training. The Vitamin C ward activates post-effort collagen synthesis.',
  },

  // ── NORMAL (7) — white/grey ───────────────────────────────────────────────
  {
    id: 33,
    loreName: "Traveller's Banana Ration",
    realFood: 'Banana (medium)',
    tier: 'Normal',
    type: 'Meal',
    buffType: 'Endurance',
    buffValue: '+Pre-Training Fuel · +Potassium Pulse',
    duration: '1 hr',
    protein: 1,
    calories: 105,
    description: 'The most common ration in every adventurer\'s belt pouch. The potassium pulse holds cramps at bay during the first set. Reliable if unremarkable. Never leave the inn without one.',
  },
  {
    id: 34,
    loreName: "Acolyte's Tuna Compact",
    realFood: 'Canned Tuna in Water (1 can)',
    tier: 'Normal',
    type: 'Meal',
    buffType: 'Strength',
    buffValue: '+25g Compact Protein',
    duration: '2 hrs',
    protein: 25,
    calories: 110,
    description: 'The acolyte\'s first lesson in resourcefulness. Compact, shelf-stable, and potent. Lacks the ceremony of higher-tier meals but delivers the protein covenant without fail.',
  },
  {
    id: 35,
    loreName: 'Almond Cache',
    realFood: 'Almonds (1 oz / ~23 nuts)',
    tier: 'Normal',
    type: 'Meal',
    buffType: 'Endurance',
    buffValue: '+Healthy Fat Reserve · +Minor Satiety',
    duration: '1.5 hrs',
    protein: 6,
    calories: 165,
    description: 'A small cache of hardened seeds, each containing a compressed fat reserve. Not a meal — a bridge. Consume between camps when the next feast is more than 2 hours away.',
  },
  {
    id: 36,
    loreName: "Initiate's Whey Ration",
    realFood: 'Generic Whey Protein Powder (1 scoop)',
    tier: 'Normal',
    type: 'Drink',
    buffType: 'Recovery',
    buffValue: '+25g Fast Absorption Protein',
    duration: '1 hr',
    protein: 25,
    calories: 120,
    description: 'An initiate\'s first encounter with the protein arts. No lore. No ceremony. Pure function. The guild recommends progressing to Premier Elixir once finances permit.',
  },
  {
    id: 37,
    loreName: "Spartan's Black Coffee Rite",
    realFood: 'Black Coffee (8 oz)',
    tier: 'Normal',
    type: 'Drink',
    buffType: 'Focus',
    buffValue: '+Caffeine Focus (2 hrs) · +Fasted Bonus',
    duration: '2 hrs',
    protein: 0,
    calories: 5,
    description: 'The spartan\'s morning rite — no additions, no dilution. The caffeine rune ignites the prefrontal cortex. Consumed fasted, it extends the fasting window without breaking the covenant.',
  },
  {
    id: 38,
    loreName: "Squire's Green Tea Vigil",
    realFood: 'Green Tea (1 cup)',
    tier: 'Normal',
    type: 'Drink',
    buffType: 'Vitality',
    buffValue: '+EGCG Antioxidant · +Mild Focus',
    duration: '1.5 hrs',
    protein: 0,
    calories: 2,
    description: 'The squire keeps a vigil with green tea before the dawn patrol. EGCG runes suppress oxidative damage slowly. A gentle guardian — not as striking as black coffee, but it lingers longer.',
  },
  {
    id: 39,
    loreName: "Paladin's Vow of Water",
    realFood: 'Water (16–20 oz)',
    tier: 'Normal',
    type: 'Drink',
    buffType: 'Hydration',
    buffValue: '+Hydration Covenant · +All Stats Baseline',
    duration: 'Continuous',
    protein: 0,
    calories: 0,
    waterOz: 18,
    description: 'The sacred vow renewed 8 times daily. All other consumables fail without the Vow of Water as their foundation. The paladin who reaches 100 oz before midnight upholds the highest honour.',
  },
];

// ── Filter helpers ────────────────────────────────────────────────────────────
export const TIER_ORDER: ConsumableTier[] = ['Legendary', 'Epic', 'Superior', 'Fine', 'Normal'];

export const TIER_CSS_CLASS: Record<ConsumableTier, string> = {
  Legendary: 'tier-legendary',
  Epic:      'tier-epic',
  Superior:  'tier-superior',
  Fine:      'tier-fine',
  Normal:    'tier-normal',
};

interface FoodEntry {
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

interface FoodLog {
  entries: FoodEntry[];
  totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number; water: number };
  goalCalories: number;
}

type FilterTab = 'All' | ConsumableTier | 'Meal' | 'Drink' | 'Supplement' | 'Today';

@Component({
  selector: 'app-consumables',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="consumables-panel">

      <!-- Header -->
      <div class="panel-header">
        <span class="panel-title">CONSUMABLES</span>
        <span class="panel-subtitle">{{ filteredConsumables().length }} items</span>
      </div>

      <!-- Filter tabs -->
      <div class="filter-bar">
        @for (tab of filterTabs; track tab) {
          <button
            class="filter-tab"
            [class.active]="activeFilter() === tab"
            (click)="setFilter(tab)">
            {{ tab }}
          </button>
        }
      </div>

      <!-- Main layout: grid + detail pane -->
      <div class="consumables-layout">

        <!-- Left: item grid / Today food log -->
        @if (activeFilter() !== 'Today') {
          <div class="item-grid">
            @for (item of filteredConsumables(); track item.id) {
              <div
                class="item-card"
                [class]="tierClass(item.tier)"
                [class.selected]="selectedItem()?.id === item.id"
                (click)="selectItem(item)">
                <div class="item-icon">{{ typeIcon(item.type) }}</div>
                <div class="item-info">
                  <div class="item-lore-name">{{ item.loreName }}</div>
                  <div class="item-buff-type">{{ item.buffType }}</div>
                </div>
                <div class="item-protein">{{ item.protein }}g</div>
              </div>
            }
          </div>
        } @else {
          <div class="fitbit-log-panel">
            @if (fitbitLoading()) {
              <div class="fl-loading">Loading Fitbit food log...</div>
            } @else if (fitbitLog().length > 0) {
              @for (entry of fitbitLog(); track entry.logId) {
                <div class="fl-entry" [class]="matchedConsumable(entry) ? tierClass(matchedConsumable(entry)!.tier) : ''">
                  <div class="fl-top">
                    <span class="fl-meal-type">{{ entry.mealType }}</span>
                    @if (matchedConsumable(entry)) { <span class="fl-match-badge">🔗</span> }
                  </div>
                  <div class="fl-name">{{ entry.name }}</div>
                  <div class="fl-macros">
                    <span class="fl-protein">{{ entry.protein }}g P</span>
                    <span class="fl-dot">·</span>
                    <span>{{ entry.calories }} kcal</span>
                    @if (entry.carbs > 0) { <span class="fl-dot">·</span><span>{{ entry.carbs }}g C</span> }
                  </div>
                  @if (matchedConsumable(entry)) {
                    <div class="fl-match-name">{{ matchedConsumable(entry)!.loreName }}</div>
                  }
                </div>
              }
            } @else {
              <div class="fl-empty">
                <div>No food logged in Fitbit today.</div>
                <div class="fl-empty-hint">Log meals in the Fitbit app to see them here.</div>
              </div>
            }
          </div>
        }

        <!-- Right: detail pane -->
        <div class="detail-pane">
          @if (activeFilter() === 'Today') {
            <div class="detail-header tier-fine">
              <span class="detail-icon">📊</span>
              <div>
                <div class="detail-lore-name">Today's Nutrition</div>
                <div class="detail-tier">Fitbit Live Data</div>
              </div>
            </div>
            @if (fitbitNutrition()) {
              <div class="detail-body">
                <div class="detail-stats">
                  <div class="stat-row"><span class="stat-label">PROTEIN</span><span class="stat-value buff">{{ fitbitNutrition()!.totals.protein }}g</span></div>
                  <div class="stat-row"><span class="stat-label">CALORIES</span><span class="stat-value">{{ fitbitNutrition()!.totals.calories.toLocaleString() }} kcal</span></div>
                  <div class="stat-row"><span class="stat-label">CARBS</span><span class="stat-value">{{ fitbitNutrition()!.totals.carbs }}g</span></div>
                  <div class="stat-row"><span class="stat-label">FAT</span><span class="stat-value">{{ fitbitNutrition()!.totals.fat }}g</span></div>
                  <div class="stat-row"><span class="stat-label">FIBER</span><span class="stat-value">{{ fitbitNutrition()!.totals.fiber }}g</span></div>
                  @if (fitbitNutrition()!.goalCalories > 0) {
                    <div class="stat-row"><span class="stat-label">CALORIE GOAL</span><span class="stat-value">{{ fitbitNutrition()!.goalCalories.toLocaleString() }} kcal</span></div>
                  }
                </div>
              </div>
            } @else {
              <div class="detail-empty"><span>Re-authorize Fitbit with the nutrition scope to load food data.</span></div>
            }
          } @else if (selectedItem(); as item) {
            <div class="detail-header" [class]="tierClass(item.tier)">
              <span class="detail-icon">{{ typeIcon(item.type) }}</span>
              <div>
                <div class="detail-lore-name">{{ item.loreName }}</div>
                <div class="detail-tier">{{ item.tier }}</div>
              </div>
            </div>

            <div class="detail-body">
              <p class="detail-description">{{ item.description }}</p>

              <div class="detail-stats">
                <div class="stat-row">
                  <span class="stat-label">REAL FOOD</span>
                  <span class="stat-value real-food">{{ item.realFood }}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">EFFECT</span>
                  <span class="stat-value buff">{{ item.buffValue }}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">DURATION</span>
                  <span class="stat-value">{{ item.duration }}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">PROTEIN</span>
                  <span class="stat-value">{{ item.protein }}g</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">CALORIES</span>
                  <span class="stat-value">{{ item.calories }}</span>
                </div>
              </div>

              <button class="consume-btn" [class]="tierClass(item.tier)" (click)="onConsume(item)">
                {{ consumeStatus() ? '✓ CONSUMED' : '⚗ CONSUME' }}
              </button>
              @if (consumeStatus()) {
                <div class="consume-confirm">{{ consumeStatus() }}</div>
              }
            </div>
          } @else {
            <div class="detail-empty">
              <span>Select a consumable to view details</span>
            </div>
          }
        </div>

      </div>
    </div>
  `,
  styleUrl: './consumables.component.scss',
})
export class ConsumablesComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly filterTabs: FilterTab[] = ['All', 'Meal', 'Drink', 'Legendary', 'Epic', 'Superior', 'Fine', 'Normal', 'Today'];

  activeFilter    = signal<FilterTab>('All');
  selectedItem    = signal<Consumable | null>(null);
  consumeStatus   = signal('');
  fitbitLog       = signal<FoodEntry[]>([]);
  fitbitNutrition = signal<FoodLog | null>(null);
  fitbitLoading   = signal(false);
  private consumeTimeout: ReturnType<typeof setTimeout> | null = null;

  filteredConsumables = computed(() => {
    const f = this.activeFilter();
    if (f === 'All')  return CONSUMABLES;
    if (f === 'Meal') return CONSUMABLES.filter(c => c.type === 'Meal');
    if (f === 'Drink') return CONSUMABLES.filter(c => c.type === 'Drink');
    return CONSUMABLES.filter(c => c.tier === f);
  });

  setFilter(tab: FilterTab) {
    this.activeFilter.set(tab);
    this.selectedItem.set(null);
  }

  selectItem(item: Consumable) {
    this.selectedItem.set(item);
    this.consumeStatus.set('');
  }

  ngOnInit(): void {
    this.fitbitLoading.set(true);
    const localDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
    this.http.get<any>(`${environment.apiUrl}/api/fitbit/nutrition/today?date=${localDate}`)
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) {
          this.fitbitLog.set(res.entries ?? []);
          this.fitbitNutrition.set({ entries: res.entries ?? [], totals: res.totals, goalCalories: res.goalCalories ?? 0 });
        }
        this.fitbitLoading.set(false);
      });
  }

  matchedConsumable(entry: FoodEntry): Consumable | null {
    const fitName = entry.name.toLowerCase();
    return CONSUMABLES.find(c => {
      const real = c.realFood.toLowerCase();
      const fitWords = fitName.split(/\s+/).filter((w: string) => w.length >= 4);
      const realWords = real.split(/\s+/).filter((w: string) => w.length >= 4);
      return fitWords.some((w: string) => real.includes(w)) || realWords.some((w: string) => fitName.includes(w));
    }) ?? null;
  }

  onConsume(item: Consumable): void {
    const proteinPart = item.protein > 0 ? ` · +${item.protein}g protein` : '';
    const calPart     = item.calories > 0 ? ` · ${item.calories} kcal` : '';
    this.consumeStatus.set(`${item.buffValue}${proteinPart}${calPart}`);
    if (this.consumeTimeout) clearTimeout(this.consumeTimeout);
    this.consumeTimeout = setTimeout(() => this.consumeStatus.set(''), 3000);

    this.http.post(`${environment.apiUrl}/api/consume`, {
      itemName:  item.realFood,
      protein:   item.protein,
      calories:  item.calories,
      buffValue: item.buffValue,
      clientDate: new Date().toLocaleDateString('en-CA'),
      ...(item.waterOz !== undefined && { waterOz: item.waterOz })
    }).subscribe({
      error: (err) => console.error('[CONSUME] Journal write failed:', err)
    });
  }

  tierClass(tier: ConsumableTier): string {
    return TIER_CSS_CLASS[tier];
  }

  typeIcon(type: ConsumableType): string {
    switch (type) {
      case 'Meal':       return '🍖';
      case 'Drink':      return '⚗';
      case 'Supplement': return '💊';
    }
  }
}
