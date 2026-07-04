export interface InventoryItem {
  id: string;
  name: string;
  type: 'consumable' | 'equipment';
  category: 'steel-supplement' | 'recovery-gear' | 'armor' | 'weapon' | 'mount' | 'tech-hardware' | 'survivalist';
  icon: string;
  unit: string;
  description: string;
  equipped?: boolean;          // For armor only
  level?: number;              // Level requirement for armor
  stockStatus?: 'stocked' | 'low' | 'needed';  // For supplies
  monthlyCost?: string;        // e.g. '$50-60'
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
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
