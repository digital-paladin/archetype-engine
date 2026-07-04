// ─── Rewards Catalog Model ────────────────────────────────────────────────────
// Prize pool for real-world rewards earned through discipline milestones.
// Funded by two sources:
//   1. Vault balance (SoFi "Strategy Seed Capital" goal) — from discipline dice rolls
//   2. Profit pool (10% of trading net profit) — from live strategy wins

export type PrizeCategory = 'pto' | 'mystery-box' | 'car-rental' | 'fashion-box' | 'custom';
export type FundingSource = 'vault' | 'profit' | 'either';
export type PrizeStatus = 'available' | 'pending-purchase' | 'claimed';

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  category: PrizeCategory;
  estimatedValue: number;     // dollars (0 for PTO)
  fundingSource: FundingSource;
  minBalance: number;         // min vault OR profit pool balance to be eligible
  status: PrizeStatus;
  realizedPurchase?: boolean; // true = physically purchased / experience taken
  claimedAt?: string;         // ISO date when moved to pending/claimed
  notes?: string;             // vendor, duration, sizing notes
  tags?: string[];
  // Mystery-box dice mechanic: you become your own casino
  diceSides?: number | null;  // null = no roll (direct claim when eligible)
  diceThreshold?: number | null; // roll must be >= this value to claim
  lastRollResult?: number | null; // result of most recent roll attempt
  lastRollDate?: string | null;   // ISO date of last roll
}

export interface ProfitPool {
  allocationPct: number;      // % of net trading profit directed here (default 10)
  balance: number;            // accumulated dollars available for prize claims
  totalDeposited: number;     // lifetime total (for tracking)
  lastDepositDate?: string;   // ISO date of last manual deposit
  lastDepositAmount?: number;
}

export interface CatalogData {
  items: CatalogItem[];
  profitPool: ProfitPool;
  lastUpdated: string;
}

// ─── Default Catalogue ────────────────────────────────────────────────────────

export const DEFAULT_CATALOG_ITEMS: Omit<CatalogItem, 'id' | 'status' | 'claimedAt'>[] = [
  {
    name: 'PTO Day — Sanctioned Adventure',
    description: 'Use 1 PTO day for a personal mission (hike, road trip, climbing, etc.) with zero guilt. Earned via 30-day unbroken streak.',
    category: 'pto',
    estimatedValue: 0,
    fundingSource: 'vault',
    minBalance: 0,
    notes: 'Requires 30-day unbroken streak in character-sheet. No cost — earned by discipline milestone.',
    tags: ['milestone', 'experience'],
    diceSides: null,
    diceThreshold: null,
  },
  {
    name: 'Stately Premium Fashion Box',
    description: 'One curated Stately box (premium menswear, stylist-selected). ~$150-200 value.',
    category: 'fashion-box',
    estimatedValue: 175,
    fundingSource: 'vault',
    minBalance: 175,
    notes: 'Order at stately.com. Choose style preferences upfront. Ships in ~1 week.',
    tags: ['lifestyle', 'fashion'],
    diceSides: null,
    diceThreshold: null,
  },
  {
    name: 'Mystery Box Pull (≤$100) — Your Casino',
    description: 'Pull a mystery box item valued ≤$100 (e.g., Hype, Hypedrop, Amazon mystery box). You pick the item catalog, you buy it — you own the odds.',
    category: 'mystery-box',
    estimatedValue: 75,
    fundingSource: 'vault',
    minBalance: 75,
    notes: 'Roll D6 ≥ 4 to fire. Curate your own prize list (e.g., tech accessories, streetwear, gear). Buy the pulled item yourself — bypasses house edge completely.',
    tags: ['mystery', 'variable-reward'],
    diceSides: 6,
    diceThreshold: 4,   // ≥4/6 = 50% odds — better than any mystery box site
  },
  {
    name: 'Mystery Box Pull ($100–$500) — Your Casino',
    description: 'Pull a mystery box item valued $100–$500 (e.g., limited sneakers, tech, collector items). Requires profit pool funding.',
    category: 'mystery-box',
    estimatedValue: 300,
    fundingSource: 'profit',
    minBalance: 300,
    notes: 'Roll D12 ≥ 7 to fire. Curate prize list at same value tier. Same concept — you buy the pulled item yourself.',
    tags: ['mystery', 'variable-reward', 'premium'],
    diceSides: 12,
    diceThreshold: 7,   // ≥7/12 = 50% odds
  },
  {
    name: 'Exotic Car Rental — Porsche 911 (3 days)',
    description: 'Hertz Dream Cars or Exotic Car Collection rental. Porsche 911 or equivalent. Pure experience — no resale value, no guilt.',
    category: 'car-rental',
    estimatedValue: 2500,
    fundingSource: 'profit',
    minBalance: 2500,
    notes: 'Hertz Dream Cars: book at hertz.com/dreamcars. Requires valid license + credit card hold. Reserve at least 2 weeks ahead.',
    tags: ['experience', 'luxury', 'milestone'],
    diceSides: null,
    diceThreshold: null,
  },
];
