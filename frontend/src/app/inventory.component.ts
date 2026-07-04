import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from './inventory.service';
import { InventoryItem, BudgetPhase } from './inventory-item.interface';
import { ActionTrackerService } from './action-tracker.service';
import { Subscription } from 'rxjs';

interface BodySlot {
  id: string; col: string; row: string;
  icon: string; label: string; keys: string[];
}

interface CategoryFilter {
  id: string; icon: string; label: string;
}

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="eso-inv">

      <!-- ── LEFT: EQUIPPED ─────────────────────────────────────────── -->
      <div class="eq-panel">
        <div class="eq-header">EQUIPPED</div>

        <!-- Armor of God body diagram -->
        <div class="apparel-block">
          <div class="apparel-label">ARMOR OF GOD</div>
          <div class="body-grid">
            <div class="body-cell"
                 *ngFor="let slot of armorOfGodSlots"
                 [style.grid-column]="slot.col"
                 [style.grid-row]="slot.row"
                 [class.cell-on]="!!getEquippedForSlot(slot)"
                 [title]="slot.label"
                 (click)="onSlotClick(slot)">
              <span class="cell-emoji">{{ getEquippedForSlot(slot)?.icon ?? slot.icon }}</span>
              <span class="cell-check" *ngIf="!!getEquippedForSlot(slot)">✓</span>
            </div>
          </div>
          <div class="armor-meter">
            <div class="armor-track">
              <div class="armor-fill" [style.width.%]="armorCompletionPct"></div>
            </div>
            <span class="armor-label">{{ equippedArmor.length }}/{{ armorOfGodSlots.length }} equipped</span>
          </div>
        </div>

        <div class="eq-divider"></div>

        <!-- Stats derived from equipped armor -->
        <div class="eq-stats">
          <div class="eq-stat-row" *ngFor="let s of equippedStats">
            <span class="eq-stat-name">{{ s.name }}</span>
            <span class="eq-stat-val">{{ s.value }}</span>
          </div>
        </div>

        <div class="eq-divider"></div>

        <!-- MUNDUS equivalent: Daily Prayer -->
        <div class="mundus-block">
          <div class="apparel-label">MUNDUS</div>
          <div class="mundus-row">
            <span class="mundus-stone">🙏</span>
            <span class="mundus-name">Daily Prayer</span>
          </div>
        </div>
      </div>

      <!-- ── RIGHT: ITEMS ───────────────────────────────────────────── -->
      <div class="items-panel">
        <div class="items-topbar">
          <span class="items-title">ITEMS</span>
          <div class="cat-icons">
            <button class="cat-btn"
                    *ngFor="let f of categoryFilters"
                    [class.cat-active]="activeCategory === f.id"
                    (click)="activeCategory = f.id"
                    [title]="f.label">{{ f.icon }}</button>
          </div>
        </div>

        <div class="sort-bar">
          <span class="sort-name">NAME ↕</span>
          <span class="sort-value">VALUE</span>
        </div>

        <!-- Budget view -->
        <div class="budget-list" *ngIf="activeCategory === 'budget'">
          <div class="budget-row" *ngFor="let p of budgetData" [class.b-active]="p.isActive">
            <div class="b-row-head">
              <span class="b-label">{{ p.label }}</span>
              <span class="b-total">{{ p.monthlyTotal }}/mo</span>
              <span class="b-active-chip" *ngIf="p.isActive">◆ ACTIVE</span>
            </div>
            <div class="b-line" *ngFor="let line of p.lineItems">
              <span>{{ line.label }}</span><span>{{ line.amount }}</span>
            </div>
          </div>
        </div>

        <!-- Item list -->
        <div class="item-list" *ngIf="activeCategory !== 'budget'">
          <div class="item-row"
               *ngFor="let item of filteredItems"
               [class.i-sel]="selectedItem?.id === item.id"
               (click)="selectItem(item)">
            <button class="i-info"
                    (click)="openUsageModal(item); $event.stopPropagation()"
                    [title]="item.description">ⓘ</button>
            <div class="i-icon-cell">
              <span class="i-icon">{{ item.icon }}</span>
              <span class="i-stock"
                    *ngIf="item.stockStatus"
                    [attr.data-s]="item.stockStatus"
                    (click)="cycleStock(item, $event)">●</span>
            </div>
            <span class="i-name" [attr.data-q]="getItemQuality(item)">{{ item.name }}</span>
            <span class="i-value">{{ item.monthlyCost || '—' }}</span>
          </div>
          <div class="i-empty" *ngIf="filteredItems.length === 0">No items in this category</div>
        </div>

        <!-- Inventory capacity bar -->
        <div class="inv-cap-bar">
          <span class="cap-label">Inventory Space:</span>
          <span class="cap-count"> {{ items.length }} / 50</span>
          <div class="cap-track">
            <div class="cap-fill" [style.width.%]="capacityPct"></div>
          </div>
          <span class="cap-budget" *ngIf="activeBudget">{{ activeBudget.monthlyTotal }} 💰</span>
        </div>
      </div>

    </div><!-- /eso-inv -->

    <!-- ── USAGE MODAL ──────────────────────────────────────────────────── -->
    <div class="modal-overlay" *ngIf="showModal" (click)="closeModal()">
      <div class="modal-content" (click)="$event.stopPropagation()">
        <h3>{{ selectedItem?.icon }} {{ selectedItem?.name }}</h3>
        <p class="modal-desc">{{ selectedItem?.description }}</p>
        <div class="modal-form">
          <label for="qty-inp">QUANTITY ({{ selectedItem?.unit }})</label>
          <input id="qty-inp" type="number" [(ngModel)]="modalQuantity" min="0.5" step="0.5" />
        </div>
        <div class="modal-suggestion" *ngIf="selectedItem?.priority">
          Priority: {{ selectedItem?.priority }} — {{ selectedItem?.monthlyCost }}/mo
        </div>
        <div class="modal-buttons">
          <button class="btn btn-primary" (click)="confirmUsage()">Log Usage</button>
          <button class="btn btn-secondary" (click)="closeModal()">Cancel</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* ── ESO Inventory Shell ──────────────────────────────────────────────── */
    :host { display: block; height: 100%; }
    .eso-inv {
      display: flex; height: 100%; min-height: 520px;
      background: var(--eso-bg-panel, #100e07);
      border: 1px solid var(--eso-border, rgba(155,115,38,0.45));
      font-family: 'Cinzel', serif;
      overflow: hidden;
    }

    /* ── LEFT PANEL: EQUIPPED ────────────────────────────────────────────── */
    .eq-panel {
      width: 260px; min-width: 260px;
      background: var(--eso-bg-panel-alt, #1a1408);
      border-right: 1px solid var(--eso-border, rgba(155,115,38,0.45));
      overflow-y: auto;
      padding: 12px 10px 16px;
      display: flex; flex-direction: column;
    }
    .eq-header {
      font-size: 13px; font-weight: 700; letter-spacing: 2px;
      color: var(--eso-text, #e2cfa8); text-align: center;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--eso-border, rgba(155,115,38,0.35));
      margin-bottom: 10px;
    }

    .apparel-block { padding: 0 4px; }
    .apparel-label {
      font-size: 9px; letter-spacing: 1.5px; font-weight: 700;
      color: var(--eso-text-dim, #a08858); text-transform: uppercase;
      margin-bottom: 8px;
    }

    /* ── BODY GRID ──────────────────────────────────────────────────────── */
    .body-grid {
      display: grid;
      grid-template-columns: 48px 56px 48px;
      grid-template-rows: repeat(5, 48px);
      gap: 4px;
      position: relative;
      width: 164px; height: 256px;
      margin: 0 auto 10px;
    }
    .body-grid::before {
      content: '🧍';
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      font-size: 76px;
      opacity: 0.10;
      pointer-events: none; z-index: 0;
    }
    .body-cell {
      position: relative; z-index: 1;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.45);
      border: 1px solid rgba(155,115,38,0.30);
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .body-cell:hover { border-color: rgba(201,168,76,0.65); background: rgba(201,168,76,0.08); }
    .body-cell.cell-on {
      border-color: rgba(201,168,76,0.80);
      background: linear-gradient(135deg, rgba(201,168,76,0.18) 0%, rgba(155,115,38,0.08) 100%);
    }
    .cell-emoji { font-size: 22px; line-height: 1; }
    .cell-check {
      position: absolute; top: 2px; right: 3px;
      font-size: 9px; color: #6fcf7d; font-weight: 700;
    }

    .armor-meter { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .armor-track { flex: 1; height: 3px; background: rgba(155,115,38,0.2); }
    .armor-fill  { height: 100%; background: var(--eso-gold, #c9a84c); transition: width 0.4s; }
    .armor-label { font-size: 9px; color: var(--eso-text-dim, #a08858); white-space: nowrap; }

    .eq-divider { height: 1px; background: rgba(155,115,38,0.2); margin: 8px 0; }

    .eq-stats { display: flex; flex-direction: column; gap: 2px; padding: 0 2px; }
    .eq-stat-row { display: flex; justify-content: space-between; padding: 2px 0; }
    .eq-stat-name { font-size: 11px; color: var(--eso-text-dim, #a08858); }
    .eq-stat-val  { font-size: 11px; color: var(--eso-text, #e2cfa8); font-weight: 700; }

    .mundus-block { margin-top: 2px; padding: 0 2px; }
    .mundus-row   { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
    .mundus-stone { font-size: 24px; }
    .mundus-name  { font-size: 12px; color: var(--eso-text, #e2cfa8); }

    /* ── RIGHT PANEL: ITEMS ──────────────────────────────────────────────── */
    .items-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .items-topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px 8px;
      border-bottom: 1px solid var(--eso-border, rgba(155,115,38,0.35));
    }
    .items-title { font-size: 13px; font-weight: 700; letter-spacing: 2px; color: var(--eso-text, #e2cfa8); }
    .cat-icons { display: flex; gap: 2px; }
    .cat-btn {
      background: transparent; border: none;
      width: 30px; height: 30px;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; cursor: pointer;
      opacity: 0.55; transition: opacity 0.15s, background 0.15s;
    }
    .cat-btn:hover  { opacity: 0.9; background: rgba(201,168,76,0.08); }
    .cat-btn.cat-active { opacity: 1; background: rgba(201,168,76,0.15); outline: 1px solid rgba(201,168,76,0.4); }

    .sort-bar {
      display: flex; justify-content: space-between;
      padding: 6px 14px;
      font-size: 10px; letter-spacing: 1px;
      color: var(--eso-text-dim, #a08858);
      border-bottom: 1px solid rgba(155,115,38,0.2);
      background: rgba(0,0,0,0.2);
    }

    .item-list { flex: 1; overflow-y: auto; }
    .item-row {
      display: flex; align-items: center; gap: 8px;
      padding: 5px 14px; cursor: pointer;
      border-bottom: 1px solid rgba(155,115,38,0.1);
      transition: background 0.12s;
    }
    .item-row:hover  { background: rgba(201,168,76,0.06); }
    .item-row.i-sel  { background: rgba(201,168,76,0.12); }
    .i-info {
      background: transparent; border: none; cursor: pointer;
      font-size: 13px; color: var(--eso-text-dim, #a08858);
      width: 18px; flex-shrink: 0; opacity: 0.7; transition: opacity 0.15s; padding: 0;
    }
    .i-info:hover { opacity: 1; color: var(--eso-text, #e2cfa8); }
    .i-icon-cell { position: relative; width: 28px; height: 28px; flex-shrink: 0; }
    .i-icon { font-size: 20px; line-height: 28px; }
    .i-stock { position: absolute; bottom: 0; right: 0; font-size: 8px; cursor: pointer; }
    .i-stock[data-s="stocked"] { color: #6fcf7d; }
    .i-stock[data-s="low"]     { color: #e6a833; }
    .i-stock[data-s="needed"]  { color: #e07070; }

    .i-name { flex: 1; font-size: 12px; font-family: 'Cinzel', serif; }
    .i-name[data-q="common"]    { color: #c8c8c8; }
    .i-name[data-q="uncommon"]  { color: #6fcf7d; }
    .i-name[data-q="rare"]      { color: #5b9cf6; }
    .i-name[data-q="epic"]      { color: #c27ef0; }
    .i-name[data-q="legendary"] { color: var(--eso-gold-bright, #f2c96a); }
    .i-value { font-size: 11px; color: var(--eso-text-dim, #a08858); white-space: nowrap; }
    .i-empty { padding: 24px 16px; color: var(--eso-text-dim, #a08858); font-size: 12px; text-align: center; }

    .budget-list { flex: 1; overflow-y: auto; padding: 8px 0; }
    .budget-row {
      margin: 0 12px 10px;
      background: var(--eso-bg-panel-alt, #1a1408);
      border: 1px solid var(--eso-border, rgba(155,115,38,0.35));
      padding: 12px;
    }
    .budget-row.b-active {
      border-color: rgba(201,168,76,0.6);
      background: linear-gradient(135deg, rgba(201,168,76,.08) 0%, transparent 100%);
    }
    .b-row-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .b-label    { font-size: 12px; font-weight: 700; color: var(--eso-text, #e2cfa8); flex: 1; }
    .b-total    { font-size: 13px; font-weight: 700; color: var(--eso-gold-bright, #f2c96a); }
    .b-active-chip { font-size: 9px; color: var(--eso-gold, #c9a84c); letter-spacing: 1px; }
    .b-line { display: flex; justify-content: space-between; font-size: 11px; color: var(--eso-text-dim, #a08858); padding: 2px 0; }

    .inv-cap-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 14px;
      border-top: 1px solid var(--eso-border, rgba(155,115,38,0.35));
      font-size: 11px; background: rgba(0,0,0,0.3);
      flex-shrink: 0;
    }
    .cap-label  { color: var(--eso-text-dim, #a08858); }
    .cap-count  { color: var(--eso-text, #e2cfa8); font-weight: 700; margin-right: 4px; }
    .cap-track  { flex: 1; height: 4px; background: rgba(155,115,38,0.2); }
    .cap-fill   { height: 100%; background: var(--eso-gold, #c9a84c); transition: width 0.4s; }
    .cap-budget { font-size: 11px; color: var(--eso-gold-bright, #f2c96a); font-weight: 700; white-space: nowrap; }

    /* ── MODAL ──────────────────────────────────────────────────────────── */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.72);
      display: flex; align-items: center; justify-content: center;
      z-index: 2000;
    }
    .modal-content {
      background: var(--eso-bg-panel, #100e07);
      border: 1px solid rgba(201,168,76,0.45);
      padding: 24px; width: 90%; max-width: 380px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    }
    .modal-content h3  { margin: 0 0 8px 0; font-size: 20px; color: var(--eso-gold-bright, #f2c96a); }
    .modal-desc        { margin: 0 0 16px 0; font-size: 12px; color: #888; }
    .modal-form        { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
    .modal-form label  { font-size: 10px; color: #b0b0b0; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
    .modal-form input  { background: rgba(0,0,0,0.4); border: 1px solid rgba(201,168,76,0.3); color: #f0f0f0; padding: 10px 12px; font-size: 14px; }
    .modal-form input:focus { outline: none; border-color: rgba(201,168,76,0.7); }
    .modal-suggestion  { background: rgba(201,168,76,0.08); padding: 8px 12px; font-size: 11px; color: var(--eso-gold, #c9a84c); border-left: 2px solid var(--eso-gold, #c9a84c); margin-bottom: 14px; }
    .modal-buttons     { display: flex; gap: 8px; }
    .btn               { flex: 1; padding: 10px 18px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'Cinzel', serif; letter-spacing: .5px; transition: all 0.18s; }
    .btn-primary       { background: var(--eso-gold, #c9a84c); color: #12100a; }
    .btn-primary:hover { background: var(--eso-gold-bright, #f2c96a); }
    .btn-secondary     { background: rgba(255,255,255,0.08); color: #e2cfa8; border: 1px solid rgba(155,115,38,0.3); }
    .btn-secondary:hover { background: rgba(255,255,255,0.12); }

    @media (max-width: 640px) {
      .eq-panel { width: 200px; min-width: 200px; }
      .body-grid { grid-template-columns: 38px 44px 38px; grid-template-rows: repeat(5, 38px); width: 128px; height: 202px; }
      .cell-emoji { font-size: 16px; }
    }

    @media (max-width: 600px) {
      /* Stack EQUIPPED pane above ITEMS pane */
      .eso-inv { flex-direction: column; min-height: unset; }
      .eq-panel {
        width: 100%; min-width: unset;
        border-right: none;
        border-bottom: 1px solid var(--eso-border, rgba(155,115,38,0.45));
        max-height: 320px;
        overflow-y: auto;
        padding: 10px 14px 12px;
      }
      /* Body grid: slightly smaller on phone */
      .body-grid { grid-template-columns: 40px 48px 40px; grid-template-rows: repeat(5, 40px); width: 136px; height: 216px; }
      .cell-emoji { font-size: 18px; }
      .items-panel { flex: 1; min-height: 300px; }
      /* Items topbar: compress */
      .items-topbar { padding: 8px 10px 6px; }
      .items-title  { font-size: 11px; }
      .cat-btn      { width: 26px; height: 26px; font-size: 13px; }
    }
  `]
})
export class InventoryComponent implements OnInit, OnDestroy {
  activeCategory = 'all';
  characterLevel = 20;

  items: InventoryItem[] = [];
  budgetData: BudgetPhase[] = [];
  currentAction: any = null;

  showModal = false;
  selectedItem: InventoryItem | null = null;
  modalQuantity = 0;
  modalNotes = '';

  private subscriptions: Subscription[] = [];

  readonly armorOfGodSlots: BodySlot[] = [
    { id: 'helmet', col: '2', row: '1', icon: '🪖', label: 'Helmet of Salvation',          keys: ['helmet', 'salvation'] },
    { id: 'sword',  col: '1', row: '2', icon: '⚔️', label: 'Sword of the Spirit',           keys: ['sword', 'spirit', 'word'] },
    { id: 'chest',  col: '2', row: '2', icon: '🦺', label: 'Breastplate of Righteousness',  keys: ['breastplate', 'chest', 'righteousness'] },
    { id: 'shield', col: '3', row: '2', icon: '🛡️', label: 'Shield of Faith',               keys: ['shield', 'faith'] },
    { id: 'belt',   col: '2', row: '3', icon: '🔑', label: 'Belt of Truth',                 keys: ['belt', 'truth'] },
    { id: 'feet',   col: '2', row: '5', icon: '👟', label: 'Gospel of Peace (Boots)',       keys: ['boots', 'feet', 'gospel', 'peace'] },
  ];

  readonly categoryFilters: CategoryFilter[] = [
    { id: 'all',              icon: '◆',  label: 'All' },
    { id: 'steel-supplement', icon: '💊', label: 'Supplements' },
    { id: 'recovery-gear',    icon: '🛁', label: 'Recovery' },
    { id: 'armor',            icon: '🛡️', label: 'Armor of God' },
    { id: 'weapon',           icon: '⚔️', label: 'Weapons' },
    { id: 'tech-hardware',    icon: '💻', label: 'Tech' },
    { id: 'survivalist',      icon: '🏕️', label: 'Survivalist' },
    { id: 'budget',           icon: '💰', label: 'Budget' },
  ];

  constructor(
    private inventoryService: InventoryService,
    private actionTracker: ActionTrackerService
  ) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.inventoryService.getItems().subscribe(items => this.items = items)
    );
    this.subscriptions.push(
      this.actionTracker.getCurrentAction().subscribe(action => this.currentAction = action)
    );
    this.budgetData = this.inventoryService.getBudgetData();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  get activeBudget(): BudgetPhase | undefined {
    return this.budgetData.find(p => p.isActive);
  }

  get filteredItems(): InventoryItem[] {
    if (this.activeCategory === 'all') return this.items;
    if (this.activeCategory === 'budget') return [];
    return this.items.filter(i => i.category === this.activeCategory);
  }

  get equippedArmor(): InventoryItem[] {
    return this.items.filter(i => i.category === 'armor' && i.equipped);
  }

  get armorCompletionPct(): number {
    return Math.round((this.equippedArmor.length / this.armorOfGodSlots.length) * 100);
  }

  get capacityPct(): number {
    return Math.min(Math.round((this.items.length / 50) * 100), 100);
  }

  get equippedStats(): { name: string; value: string }[] {
    const n = this.equippedArmor.length;
    return [
      { name: 'Spiritual Defense',  value: (n * 3584).toLocaleString() },
      { name: 'Faith Shield',       value: (n * 1250).toLocaleString() },
      { name: 'Word Penetration',   value: (n * 420).toLocaleString() },
      { name: 'Prayer Coverage',    value: n > 0 ? 'Active' : '—' },
    ];
  }

  getEquippedForSlot(slot: BodySlot): InventoryItem | undefined {
    return this.equippedArmor.find(item =>
      slot.keys.some(k =>
        item.id.toLowerCase().includes(k) || item.name.toLowerCase().includes(k)
      )
    );
  }

  getItemQuality(item: InventoryItem): string {
    if (item.category === 'mount')  return 'legendary';
    if (item.category === 'armor')  return 'epic';
    if (item.category === 'weapon') return 'rare';
    if (item.priority === 'HIGH')   return 'uncommon';
    return 'common';
  }

  onSlotClick(slot: BodySlot): void {
    const item = this.getEquippedForSlot(slot);
    if (item) { this.selectedItem = item; }
  }

  selectItem(item: InventoryItem): void {
    this.selectedItem = item;
  }

  getItemsByCategory(category: string): InventoryItem[] {
    return this.items.filter(item => item.category === category);
  }

  cycleStock(item: InventoryItem, event: Event): void {
    event.stopPropagation();
    const cycle: Record<string, 'stocked' | 'low' | 'needed'> = {
      stocked: 'low', low: 'needed', needed: 'stocked',
    };
    this.inventoryService.updateStockStatus(item.id, cycle[item.stockStatus ?? 'needed'] ?? 'stocked');
  }

  openUsageModal(item: InventoryItem): void {
    if (item.category === 'armor') { this.toggleEquipment(item); return; }
    this.selectedItem = item;
    this.modalQuantity = 1;
    this.modalNotes = '';
    this.showModal = true;
    setTimeout(() => (document.querySelector('#qty-inp') as HTMLInputElement)?.focus(), 100);
  }

  closeModal(): void {
    this.showModal = false;
    this.modalQuantity = 0;
    this.modalNotes = '';
  }

  confirmUsage(): void {
    if (!this.selectedItem || this.modalQuantity <= 0) return;
    const associatedAction = this.currentAction
      ? `${this.currentAction.type} – ${this.currentAction.targetResult}`
      : undefined;
    this.inventoryService.useItem(this.selectedItem.id, this.modalQuantity, this.modalNotes || undefined, associatedAction);
    this.closeModal();
  }

  toggleEquipment(item: InventoryItem): void {
    if ((item.level ?? 0) > this.characterLevel) return;
    this.inventoryService.toggleEquipment(item.id);
  }

  formatTimestamp(timestamp: Date): string {
    const d = new Date(timestamp);
    const h = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
  }
}
