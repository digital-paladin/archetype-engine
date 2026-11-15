import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { InventoryItem, ItemUsage, BudgetPhase } from './inventory-item.interface';
import { environment } from '../environments/environment';
import { SocketService } from './socket.service';

@Injectable({
  providedIn: 'root'
})
export class InventoryService {
  private readonly http = inject(HttpClient);
  private readonly socket = inject(SocketService);
  private items$ = new BehaviorSubject<InventoryItem[]>([]);
  private loadError$ = new BehaviorSubject<string | null>(null);
  private usageHistory$ = new BehaviorSubject<ItemUsage[]>([]);
  private recentlyUsed$ = new BehaviorSubject<ItemUsage[]>([]);
  private loaded = false;

  constructor() {
    this.loadUsageFromStorage();
    this.refreshItems();
    this.socket.onSystemNotice().subscribe(event => {
      if (event.type === 'cleared' && this.loaded) this.refreshItems();
    });
  }

  getItems(): Observable<InventoryItem[]> {
    return this.items$.asObservable();
  }

  getLoadError(): Observable<string | null> {
    return this.loadError$.asObservable();
  }

  refreshItems(): void {
    this.http.get<{ success: boolean; items: InventoryItem[] }>(`${environment.apiUrl}/api/inventory`).pipe(
      catchError(err => {
        console.error('[Inventory] Failed to load items:', err);
        this.loadError$.next('Inventory could not be loaded from the System.');
        return of(null);
      }),
    ).subscribe(res => {
      if (!res?.success) return;
      this.loaded = true;
      this.loadError$.next(null);
      this.items$.next(res.items ?? []);
    });
  }

  getUsageHistory(): Observable<ItemUsage[]> {
    return this.usageHistory$.asObservable();
  }

  getRecentlyUsed(): Observable<ItemUsage[]> {
    return this.recentlyUsed$.asObservable();
  }

  // Use an item (log consumption with timestamp)
  useItem(itemId: string, quantity: number, notes?: string, associatedAction?: string): void {
    const items = this.items$.value;
    const item = items.find(i => i.id === itemId);
    
    if (!item) {
      console.error(`[Inventory] Item not found: ${itemId}`);
      return;
    }

    const usage: ItemUsage = {
      itemId: item.id,
      itemName: item.name,
      quantity,
      unit: item.unit,
      timestamp: new Date(),
      notes,
      associatedAction
    };

    // Add to usage history
    const currentHistory = this.usageHistory$.value;
    const updatedHistory = [usage, ...currentHistory].slice(0, 100); // Keep last 100
    this.usageHistory$.next(updatedHistory);

    // Update recently used
    const recentlyUsed = this.recentlyUsed$.value;
    const updatedRecent = [usage, ...recentlyUsed].slice(0, 10); // Keep last 10
    this.recentlyUsed$.next(updatedRecent);

    this.saveUsage();

    console.log(`[Inventory] Used: ${item.name} x${quantity} ${item.unit}`);
  }

  // Update stock status for supply items. Stock is not XP.
  updateStockStatus(itemId: string, status: 'stocked' | 'low' | 'needed'): void {
    const previous = this.items$.value;
    const updated = previous.map(i =>
      i.id === itemId ? { ...i, stockStatus: status } : i
    );
    this.items$.next(updated);
    this.http.patch<{ success: boolean; item: InventoryItem }>(
      `${environment.apiUrl}/api/inventory/${itemId}`,
      { stockStatus: status },
    ).pipe(
      catchError(err => {
        console.error('[Inventory] Failed to save stock status:', err);
        this.items$.next(previous);
        this.loadError$.next('Stock status was not saved.');
        return of(null);
      }),
    ).subscribe(res => {
      if (res?.item) {
        this.items$.next(this.items$.value.map(i => i.id === res.item.id ? { ...i, ...res.item } : i));
      }
    });
  }

  // Equip/unequip equipment item — syncs to DB
  toggleEquipment(itemId: string): void {
    const items = this.items$.value;
    const item = items.find(i => i.id === itemId);

    if (!item || item.type !== 'equipment') {
      console.error(`[Inventory] Cannot equip: ${itemId}`);
      return;
    }

    // Optimistic local update
    const updatedItems = items.map(i =>
      i.id === itemId ? { ...i, equipped: !i.equipped } : i
    );
    this.items$.next(updatedItems);

    // Persist to DB
    this.http.post<{ success: boolean; equipped: boolean; equippedArmor: string[] }>(
      `${environment.apiUrl}/api/inventory/toggle-equip/${itemId}`, {}
    ).pipe(
      catchError(err => {
        console.error('[Inventory] Failed to sync equip state to DB:', err);
        // Revert optimistic update on error
        this.items$.next(items);
        return of(null);
      })
    ).subscribe(res => {
      if (res) {
        console.log(`[Inventory] ${res.equipped ? 'Equipped' : 'Unequipped'}: ${itemId}`);
      }
    });
  }

  // Get today's supplement usage count
  getTodaySupplementCount(): number {
    const today = new Date().toLocaleDateString('en-CA');
    return this.usageHistory$.value.filter(u =>
      new Date(u.timestamp).toLocaleDateString('en-CA') === today
    ).length;
  }

  // Get usage by date range
  getUsageByDateRange(startDate: Date, endDate: Date): ItemUsage[] {
    const history = this.usageHistory$.value;
    return history.filter(u => {
      const timestamp = new Date(u.timestamp);
      return timestamp >= startDate && timestamp <= endDate;
    });
  }

  // Clear old history (older than 90 days)
  pruneOldHistory(): void {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const history = this.usageHistory$.value;
    const pruned = history.filter(u => new Date(u.timestamp) >= ninetyDaysAgo);

    this.usageHistory$.next(pruned);
    this.saveUsage();

    console.log(`[Inventory] Pruned ${history.length - pruned.length} old entries`);
  }

  getBudgetData(): BudgetPhase[] {
    return [
      {
        phase: 1, label: 'Phase 1 — Foundation', dateRange: 'Current',
        monthlyTotal: '$395–530', isActive: true,
        lineItems: [
          { label: 'Steel Supplements (core)', amount: '$185–240' },
          { label: 'Grocery (reduced items)', amount: '$150–230' },
          { label: 'Recovery gear restock',   amount: '$20–40'   },
        ]
      },
      {
        phase: 2, label: 'Phase 2 — Expansion', dateRange: 'Jun–Nov 2026',
        monthlyTotal: '$485–585', isActive: false,
        lineItems: [
          { label: 'Steel Supplements (full)', amount: '$260–350' },
          { label: 'Grocery (reduced items)', amount: '$150–230' },
          { label: 'Firearms + Climbing',     amount: '$75–100'  },
        ]
      },
      {
        phase: 3, label: 'Phase 3 — Mastery', dateRange: 'Dec 2026–May 2027',
        monthlyTotal: '$450–700', isActive: false,
        lineItems: [
          { label: 'Steel + Grocery',          amount: '$395–530' },
          { label: 'OSCP + Trading tools',     amount: '$55–170'  },
        ]
      },
      {
        phase: 4, label: 'Phase 4–5 — Elite', dateRange: 'Jun 2027+',
        monthlyTotal: '$400–650', isActive: false,
        lineItems: [
          { label: 'Base (Steel + Grocery)',   amount: '$395–530' },
          { label: 'Expedition costs',         amount: 'Variable' },
        ]
      },
    ];
  }

  private saveUsage(): void {
    try {
      localStorage.setItem('inventory-usage-history', JSON.stringify(this.usageHistory$.value));
      localStorage.setItem('inventory-recently-used', JSON.stringify(this.recentlyUsed$.value));
    } catch (error) {
      console.error('[Inventory] Failed to save usage:', error);
    }
  }

  private loadUsageFromStorage(): void {
    try {
      const history = localStorage.getItem('inventory-usage-history');
      const recent = localStorage.getItem('inventory-recently-used');
      if (history) this.usageHistory$.next(JSON.parse(history));
      if (recent) this.recentlyUsed$.next(JSON.parse(recent));
    } catch (error) {
      console.error('[Inventory] Failed to load usage:', error);
    }
  }
}
