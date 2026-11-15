export interface InventoryQuestLink {
  id: string;
  title: string;
  status: string;
  kind: string;
}

export interface InventoryItem {
  /** Stable slug. Equip toggles still send this id. */
  id: string;
  /** Database uuid. Acquisition quests store this as inventoryItemId. */
  rowId?: string;
  name: string;
  type: 'consumable' | 'equipment';
  category: 'steel-supplement' | 'recovery-gear' | 'armor' | 'weapon' | 'mount' | 'tech-hardware' | 'survivalist';
  icon: string;
  unit: string;
  description: string;
  equipped?: boolean;          // For armor only
  level?: number | null;       // Level requirement for armor
  stockStatus?: 'stocked' | 'low' | 'needed' | null;  // For supplies
  monthlyCost?: string | null;        // Display label only. Not XP.
  priority?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  acquisitionQuestId?: string | null;
  acquisitionQuest?: InventoryQuestLink | null;
}

export interface BudgetPhase {
  phase: number;
  label: string;
  dateRange: string;
  monthlyTotal: string;
  isActive: boolean;
  lineItems: { label: string; amount: string }[];
}

export interface ItemUsage {
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  timestamp: Date;
  notes?: string;
  associatedAction?: string;
}
