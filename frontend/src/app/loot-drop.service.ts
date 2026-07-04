import { Injectable, signal } from '@angular/core';

export type LootRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface LootReward {
  id: string;
  name: string;
  description: string;
  rarity: LootRarity;
  icon: string;
}

export interface ActiveLootDrop {
  reward: LootReward;
  activityType: string;
  /** Pity system forced this drop (10 logs without rare+ / 30 without legendary). */
  isPity?: boolean;
  /** 7-day combo streak guarantee triggered this drop. */
  isComboGuarantee?: boolean;
}

/**
 * Real-life reward list — edit these freely to reflect your personal treat economy.
 * Organized by rarity tier (common 60% → legendary 3% of drops).
 */
const REWARDS: LootReward[] = [
  // ── Common ───────────────────────────────────────────────────────────────
  { id: 'coffee',      name: 'Barista Coffee Drop',     description: 'Treat yourself to your café order of choice',            rarity: 'common',    icon: '☕' },
  { id: 'snack',       name: 'Quality Snack Break',     description: 'A premium snack or sweet of your choice — you earned it', rarity: 'common',    icon: '🍫' },
  { id: 'gaming-30',   name: '30-Min Gaming Permit',    description: 'Guilt-free 30 minutes on any game you like',             rarity: 'common',    icon: '🎮' },
  { id: 'episode',     name: 'Episode Pass',            description: 'Watch one episode of your current show — zero guilt',    rarity: 'common',    icon: '📺' },
  { id: 'power-nap',   name: 'Sanctioned Power Nap',   description: 'A guilt-free 20-minute recovery nap',                    rarity: 'common',    icon: '💤' },

  // ── Uncommon ─────────────────────────────────────────────────────────────
  { id: 'restaurant',  name: 'Feast at a Restaurant',  description: 'Dine out at a restaurant of your choosing — full meal',  rarity: 'uncommon',  icon: '🍽️' },
  { id: 'movie-night', name: 'Movie Night Unlock',     description: 'Full movie night — you pick the film and the snacks',    rarity: 'uncommon',  icon: '🎬' },
  { id: 'impulse-20',  name: '$20 Impulse Purchase',   description: 'Buy anything under $20 — no justification required',    rarity: 'uncommon',  icon: '🛍️' },
  { id: 'gaming-eve',  name: 'Gaming Evening',         description: 'A full 3-hour gaming session — sanctioned and earned',   rarity: 'uncommon',  icon: '🕹️' },
  { id: 'self-care',   name: 'Full Self-Care Ritual',  description: 'Grooming, skincare, bath — total recovery protocol',     rarity: 'uncommon',  icon: '🧴' },

  // ── Rare ─────────────────────────────────────────────────────────────────
  { id: 'new-game',    name: 'New Game Acquisition',   description: "Buy a game you've been eyeing — you've earned it",       rarity: 'rare',      icon: '🎯' },
  { id: 'clothing',    name: 'Clothing Drop',          description: 'Buy one new clothing item of your choice',               rarity: 'rare',      icon: '👔' },
  { id: 'fine-dining', name: 'Fine Dining Night',      description: 'Dinner at a nicer restaurant — the full experience',     rarity: 'rare',      icon: '🥩' },
  { id: 'hobby-50',    name: '$50 Hobby Fund',         description: 'Spend $50 on any hobby, gear, or tool you want',         rarity: 'rare',      icon: '⚗️' },

  // ── Legendary ────────────────────────────────────────────────────────────
  { id: 'weekend',     name: 'Weekend Adventure',      description: 'Plan a weekend trip or experience — go somewhere',       rarity: 'legendary', icon: '✈️' },
  { id: 'tech-drop',   name: 'Tech Upgrade',           description: 'A meaningful tech or gear purchase — go big on this one', rarity: 'legendary', icon: '💻' },
  { id: 'free-week',   name: 'Unrestricted Week',      description: 'One full week: no metrics, no tracking, no discipline rules', rarity: 'legendary', icon: '👑' },
];

/** 25% chance any activity log triggers a drop at all. */
const TRIGGER_CHANCE = 0.25;

/**
 * Cumulative thresholds for rarity roll (single random [0,1)).
 * p < 0.03 → Legendary (3%)
 * p < 0.15 → Rare (12%)
 * p < 0.40 → Uncommon (25%)
 * p ≥ 0.40 → Common (60%)
 */
const RARITY_THRESHOLDS = { legendary: 0.03, rare: 0.15, uncommon: 0.40 };

/**
 * Pity thresholds — after this many consecutive activity logs without a drop of
 * that tier the next roll() forces a drop at that rarity (also bypasses the 25% chance).
 */
const PITY_RARE_THRESHOLD      = 10;   // 10 logs without rare+ → guaranteed rare
const PITY_LEGENDARY_THRESHOLD = 30;   // 30 logs without legendary → guaranteed legendary

const LS_PITY_RARE = 'dp-pity-not-rare';
const LS_PITY_LEG  = 'dp-pity-not-legendary';

@Injectable({ providedIn: 'root' })
export class LootDropService {
  activeDrop = signal<ActiveLootDrop | null>(null);

  private pitySinceNotRare   = parseInt(localStorage.getItem(LS_PITY_RARE) ?? '0', 10) || 0;
  private pitySinceLegendary = parseInt(localStorage.getItem(LS_PITY_LEG)  ?? '0', 10) || 0;

  /**
   * Roll for a loot drop on every logged activity.
   * - 25% base trigger chance (bypassed on pity or forceGuarantee).
   * - After 10 logs without rare+ the next call forces a rare drop.
   * - After 30 logs without legendary the next call forces a legendary drop.
   * @param forceGuarantee  Pass true when the 7-day combo streak guarantees a drop.
   */
  roll(activityType: string, forceGuarantee = false): void {
    this.pitySinceNotRare++;
    this.pitySinceLegendary++;
    this.savePity();

    const isPityRare      = this.pitySinceNotRare   >= PITY_RARE_THRESHOLD;
    const isPityLegendary = this.pitySinceLegendary >= PITY_LEGENDARY_THRESHOLD;
    const isPity          = isPityRare || isPityLegendary;

    const shouldDrop = forceGuarantee || isPity || (Math.random() <= TRIGGER_CHANCE);
    if (!shouldDrop) return;

    let rarity: LootRarity;
    if (isPityLegendary)  { rarity = 'legendary'; }
    else if (isPityRare)  { rarity = 'rare'; }
    else                  { rarity = this.rollRarity(); }

    // Reset pity counters based on what dropped
    if (rarity === 'legendary') {
      this.pitySinceNotRare   = 0;
      this.pitySinceLegendary = 0;
    } else if (rarity === 'rare') {
      this.pitySinceNotRare = 0;
      // pitySinceLegendary keeps counting toward legendary pity
    }
    this.savePity();

    const pool   = REWARDS.filter(r => r.rarity === rarity);
    const reward = pool[Math.floor(Math.random() * pool.length)];
    this.activeDrop.set({ reward, activityType, isPity, isComboGuarantee: forceGuarantee });
  }

  dismiss(): void {
    this.activeDrop.set(null);
  }

  private rollRarity(): LootRarity {
    const p = Math.random();
    if (p < RARITY_THRESHOLDS.legendary) return 'legendary';
    if (p < RARITY_THRESHOLDS.rare)      return 'rare';
    if (p < RARITY_THRESHOLDS.uncommon)  return 'uncommon';
    return 'common';
  }

  private savePity(): void {
    localStorage.setItem(LS_PITY_RARE, String(this.pitySinceNotRare));
    localStorage.setItem(LS_PITY_LEG,  String(this.pitySinceLegendary));
  }
}
