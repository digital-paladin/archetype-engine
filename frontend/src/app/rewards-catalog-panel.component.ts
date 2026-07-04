import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../environments/environment';

type PrizeCategory = 'pto' | 'mystery-box' | 'car-rental' | 'fashion-box' | 'custom';
type FundingSource  = 'vault' | 'profit' | 'either';
type PrizeStatus    = 'available' | 'pending-purchase' | 'claimed';

interface CatalogItem {
  id: string;
  name: string;
  description: string;
  category: PrizeCategory;
  estimatedValue: number;
  fundingSource: FundingSource;
  minBalance: number;
  status: PrizeStatus;
  realizedPurchase?: boolean;
  claimedAt?: string;
  notes?: string;
  tags?: string[];
  diceSides?: number | null;
  diceThreshold?: number | null;
  lastRollResult?: number | null;
  lastRollDate?: string | null;
}

interface ProfitPool {
  allocationPct: number;
  balance: number;
  totalDeposited: number;
  lastDepositDate?: string;
  lastDepositAmount?: number;
}

interface CatalogData {
  items: CatalogItem[];
  profitPool: ProfitPool;
  lastUpdated: string;
}

interface RollResult {
  roll: number;
  sides: number;
  threshold: number;
  won: boolean;
  item: CatalogItem;
}

const CATEGORY_META: Record<PrizeCategory, { icon: string; label: string }> = {
  'pto':          { icon: '🏖️', label: 'PTO Day' },
  'mystery-box':  { icon: '🎲', label: 'Mystery Box' },
  'car-rental':   { icon: '🚗', label: 'Car Rental' },
  'fashion-box':  { icon: '👔', label: 'Fashion Box' },
  'custom':       { icon: '⭐', label: 'Custom' },
};

const STATUS_META: Record<PrizeStatus, { icon: string; label: string; class: string }> = {
  'available':        { icon: '✅', label: 'Available', class: 'status-available' },
  'pending-purchase': { icon: '🛒', label: 'Pending Buy', class: 'status-pending' },
  'claimed':          { icon: '🏆', label: 'Claimed', class: 'status-claimed' },
};

const ALL_CATEGORIES: { id: PrizeCategory | 'all'; label: string; icon: string }[] = [
  { id: 'all',          label: 'All',          icon: '🎁' },
  { id: 'pto',          label: 'PTO',          icon: '🏖️' },
  { id: 'mystery-box',  label: 'Mystery',      icon: '🎲' },
  { id: 'car-rental',   label: 'Car Rental',   icon: '🚗' },
  { id: 'fashion-box',  label: 'Fashion',      icon: '👔' },
  { id: 'custom',       label: 'Custom',       icon: '⭐' },
];

@Component({
  selector: 'app-rewards-catalog-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="rewards-panel">
      <!-- ── Header ───────────────────────────────────────────────── -->
      <div class="rewards-header">
        <span class="rewards-title">🎁 REWARDS CATALOG</span>
        <span class="rewards-sub">Your casino. Your odds.</span>
      </div>

      <!-- ── Balance Bar ────────────────────────────────────────────── -->
      <div class="balance-bar" *ngIf="!isLoading()">
        <div class="bal-item vault-bal">
          <span class="bal-icon">💰</span>
          <div class="bal-text">
            <span class="bal-label">Vault</span>
            <span class="bal-value">\${{ vaultBalance() | number:'1.2-2' }}</span>
          </div>
        </div>
        <div class="bal-divider">|</div>
        <div class="bal-item profit-bal">
          <span class="bal-icon">📈</span>
          <div class="bal-text">
            <span class="bal-label">Profit Pool ({{ profitPool()?.allocationPct ?? 10 }}%)</span>
            <span class="bal-value">\${{ (profitPool()?.balance ?? 0) | number:'1.2-2' }}</span>
          </div>
        </div>
        <button class="btn-log-win" (click)="showDepositForm.set(!showDepositForm())">
          {{ showDepositForm() ? '✕' : '+ Log Win' }}
        </button>
      </div>

      <!-- ── Deposit / Profit-Pool Config ──────────────────────────── -->
      <div class="deposit-form" *ngIf="showDepositForm()">
        <div class="deposit-row">
          <label>Trading Profit Won</label>
          <div class="deposit-input-row">
            <span class="currency-prefix">\$</span>
            <input type="number" [(ngModel)]="depositAmountVal" min="0" step="10" placeholder="0.00" />
            <span class="alloc-note">→ \${{ depositAlloc() | number:'1.2-2' }} deposited ({{ profitPool()?.allocationPct ?? 10 }}%)</span>
          </div>
        </div>
        <div class="deposit-row">
          <label>Allocation % (1–50)</label>
          <input type="number" [(ngModel)]="depositAllocPct" min="1" max="50" step="1" />
        </div>
        <div class="deposit-actions">
          <button class="btn-deposit" (click)="onDeposit()" [disabled]="isDepositing()">
            {{ isDepositing() ? 'Saving...' : '💰 Log Win' }}
          </button>
          <button class="btn-cancel" (click)="showDepositForm.set(false)">Cancel</button>
        </div>
        <div class="deposit-stats" *ngIf="profitPool()?.totalDeposited">
          Total deposited: \${{ profitPool()!.totalDeposited | number:'1.2-2' }}
          <span *ngIf="profitPool()!.lastDepositDate">
            · Last: \${{ profitPool()!.lastDepositAmount | number:'1.2-2' }}
            on {{ profitPool()!.lastDepositDate! | date:'MMM d' }}
          </span>
        </div>
      </div>

      <!-- ── Loading ────────────────────────────────────────────────── -->
      <div class="loading-msg" *ngIf="isLoading()">Loading prizes…</div>

      <!-- ── Category Tabs ──────────────────────────────────────────── -->
      <div class="cat-tabs" *ngIf="!isLoading()">
        <button
          *ngFor="let cat of allCategories"
          class="cat-tab"
          [class.active]="activeCategory() === cat.id"
          (click)="activeCategory.set(cat.id)">
          {{ cat.icon }} {{ cat.label }}
          <span class="cat-count" *ngIf="countForCategory(cat.id) > 0">{{ countForCategory(cat.id) }}</span>
        </button>
      </div>

      <!-- ── Status Filter ───────────────────────────────────────────── -->
      <div class="status-filter" *ngIf="!isLoading()">
        <button *ngFor="let s of statusFilters"
          class="status-btn"
          [class.active]="activeStatusFilter() === s.id"
          (click)="activeStatusFilter.set(s.id)">
          {{ s.label }}
        </button>
      </div>

      <!-- ── Roll Result Overlay ──────────────────────────────────── -->
      <div class="roll-overlay" *ngIf="lastRollResult()">
        <div class="roll-result" [class.roll-won]="lastRollResult()!.won" [class.roll-lost]="!lastRollResult()!.won">
          <div class="roll-dice">🎲 D{{ lastRollResult()!.sides }}</div>
          <div class="roll-number">{{ lastRollResult()!.roll }}</div>
          <div class="roll-vs">Need ≥ {{ lastRollResult()!.threshold }}</div>
          <div class="roll-verdict" *ngIf="lastRollResult()!.won">🎉 IT FIRES! Go buy it.</div>
          <div class="roll-verdict" *ngIf="!lastRollResult()!.won">😤 No luck. Try again tomorrow.</div>
          <div class="roll-item-name">{{ lastRollResult()!.item.name }}</div>
          <button class="btn-dismiss" (click)="lastRollResult.set(null)">Dismiss</button>
        </div>
      </div>

      <!-- ── Prize Cards ─────────────────────────────────────────────── -->
      <div class="prize-grid" *ngIf="!isLoading()">
        <div
          *ngFor="let item of filteredItems()"
          class="prize-card"
          [class.prize-eligible]="isEligible(item)"
          [class.prize-claimed]="item.status === 'claimed'"
          [class.prize-pending]="item.status === 'pending-purchase'">

          <!-- Card Header -->
          <div class="prize-card-header">
            <span class="prize-cat-icon">{{ catIcon(item.category) }}</span>
            <span class="prize-name">{{ item.name }}</span>
            <span class="prize-status-badge" [ngClass]="statusClass(item.status)">
              {{ statusLabel(item.status) }}
            </span>
          </div>

          <!-- Description -->
          <div class="prize-desc" *ngIf="item.description">{{ item.description }}</div>
          <div class="prize-notes" *ngIf="item.notes">📝 {{ item.notes }}</div>

          <!-- Value & Funding -->
          <div class="prize-meta-row">
            <span class="prize-value" *ngIf="item.estimatedValue > 0">
              \${{ item.estimatedValue | number:'1.0-0' }}
            </span>
            <span class="prize-value" *ngIf="item.estimatedValue === 0">Free (PTO)</span>
            <span class="prize-funding" [class]="'fund-' + item.fundingSource">
              {{ fundingLabel(item.fundingSource) }}
            </span>
            <span class="prize-min-bal" *ngIf="item.minBalance > 0">
              Min: \${{ item.minBalance | number:'1.0-0' }}
            </span>
          </div>

          <!-- Dice Info (mystery box) -->
          <div class="prize-dice-info" *ngIf="item.diceSides">
            <span class="dice-label">🎲 D{{ item.diceSides }} ≥ {{ item.diceThreshold }}</span>
            <span class="dice-odds">({{ diceOdds(item) }}% odds)</span>
            <span class="dice-last" *ngIf="item.lastRollResult">Last roll: {{ item.lastRollResult }}</span>
          </div>

          <!-- Eligibility Warning -->
          <div class="prize-ineligible-msg" *ngIf="!isEligible(item) && item.status === 'available'">
            ⚠️ Need \${{ item.minBalance | number:'1.0-0' }} in {{ item.fundingSource === 'vault' ? 'vault' : 'profit pool' }}
          </div>

          <!-- Actions -->
          <div class="prize-actions">
            <!-- Mystery Box Roll -->
            <button
              *ngIf="item.diceSides && item.status === 'available' && isEligible(item)"
              class="btn-roll"
              [disabled]="rollingItemId() === item.id"
              (click)="onRoll(item)">
              {{ rollingItemId() === item.id ? 'Rolling…' : '🎲 Roll D' + item.diceSides }}
            </button>

            <!-- Direct Claim (no dice) -->
            <button
              *ngIf="!item.diceSides && item.status === 'available' && isEligible(item)"
              class="btn-claim"
              [disabled]="claimingItemId() === item.id"
              (click)="onClaim(item)">
              {{ claimingItemId() === item.id ? '…' : '🛒 Claim' }}
            </button>

            <!-- Mark Bought -->
            <button
              *ngIf="item.status === 'pending-purchase'"
              class="btn-realize"
              [class.btn-realized]="item.realizedPurchase"
              (click)="onRealize(item)">
              {{ item.realizedPurchase ? '✅ Bought' : '⬜ Mark Bought' }}
            </button>

            <!-- Reset -->
            <button
              *ngIf="item.status !== 'available'"
              class="btn-reset"
              (click)="onReset(item)">
              ↩ Undo
            </button>

            <!-- Delete -->
            <button class="btn-delete" (click)="deleteItem(item.id)" title="Remove prize">✕</button>
          </div>
        </div>

        <!-- Empty state -->
        <div class="empty-prize-msg" *ngIf="filteredItems().length === 0">
          No prizes in this category yet.
          <button class="btn-add-first" (click)="showAddForm.set(true)">+ Add one</button>
        </div>
      </div>

      <!-- ── Add Prize Form ─────────────────────────────────────────── -->
      <div class="add-form-section" *ngIf="!isLoading()">
        <button class="btn-toggle-add" (click)="showAddForm.set(!showAddForm())">
          {{ showAddForm() ? '✕ Cancel' : '+ Add Prize' }}
        </button>
        <div class="add-form" *ngIf="showAddForm()">
          <div class="form-row">
            <label>Name *</label>
            <input type="text" [(ngModel)]="newName" placeholder="e.g. Nike Dunk Drop" />
          </div>
          <div class="form-row">
            <label>Description</label>
            <input type="text" [(ngModel)]="newDesc" placeholder="Short description" />
          </div>
          <div class="form-row-split">
            <div class="form-col">
              <label>Category *</label>
              <select [(ngModel)]="newCategory">
                <option value="pto">🏖️ PTO Day</option>
                <option value="mystery-box">🎲 Mystery Box</option>
                <option value="car-rental">🚗 Car Rental</option>
                <option value="fashion-box">👔 Fashion Box</option>
                <option value="custom">⭐ Custom</option>
              </select>
            </div>
            <div class="form-col">
              <label>Funding *</label>
              <select [(ngModel)]="newFunding">
                <option value="vault">💰 Vault</option>
                <option value="profit">📈 Profit Pool</option>
                <option value="either">Either</option>
              </select>
            </div>
          </div>
          <div class="form-row-split">
            <div class="form-col">
              <label>Est. Value (\$)</label>
              <input type="number" [(ngModel)]="newValue" min="0" step="5" />
            </div>
            <div class="form-col">
              <label>Min Balance (\$)</label>
              <input type="number" [(ngModel)]="newMinBalance" min="0" step="5" />
            </div>
          </div>
          <div class="form-row-split">
            <div class="form-col">
              <label>Dice Sides (0 = none)</label>
              <input type="number" [(ngModel)]="newDiceSides" min="0" max="20" step="1" placeholder="0" />
            </div>
            <div class="form-col">
              <label>Win Threshold (≥)</label>
              <input type="number" [(ngModel)]="newDiceThreshold" min="1" max="20" step="1" placeholder="e.g. 4" />
            </div>
          </div>
          <div class="form-row">
            <label>Notes</label>
            <input type="text" [(ngModel)]="newNotes" placeholder="Vendor link, sizing, reminder…" />
          </div>
          <div class="form-actions">
            <button class="btn-submit-add" (click)="onAddItem()" [disabled]="isAdding()">
              {{ isAdding() ? 'Adding…' : '+ Add Prize' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .rewards-panel {
      padding: 12px;
      color: #e0d5c0;
      font-family: 'Segoe UI', sans-serif;
      max-width: 900px;
    }

    /* Header */
    .rewards-header { margin-bottom: 12px; }
    .rewards-title { font-size: 14px; font-weight: 700; color: #c8a84b; text-transform: uppercase; letter-spacing: 0.12em; }
    .rewards-sub { font-size: 11px; color: #888; margin-left: 10px; font-style: italic; }

    /* Balance Bar */
    .balance-bar {
      display: flex; align-items: center; gap: 16px;
      background: rgba(200,168,75,0.08); border: 1px solid #3a3a5a;
      border-radius: 8px; padding: 10px 14px; margin-bottom: 12px;
    }
    .bal-item { display: flex; align-items: center; gap: 8px; }
    .bal-icon { font-size: 18px; }
    .bal-text { display: flex; flex-direction: column; }
    .bal-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.06em; }
    .bal-value { font-size: 16px; font-weight: 700; color: #c8a84b; }
    .bal-divider { color: #444; font-size: 20px; }
    .profit-bal .bal-value { color: #4caf6e; }
    .btn-log-win {
      margin-left: auto; padding: 6px 14px; border-radius: 6px;
      background: rgba(76,175,110,0.2); border: 1px solid #4caf6e;
      color: #4caf6e; font-size: 12px; font-weight: 600; cursor: pointer;
      transition: background 0.2s;
    }
    .btn-log-win:hover { background: rgba(76,175,110,0.3); }

    /* Deposit Form */
    .deposit-form {
      background: rgba(76,175,110,0.06); border: 1px solid #2a4a3a;
      border-radius: 8px; padding: 14px; margin-bottom: 12px;
    }
    .deposit-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
    .deposit-row label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 0.06em; }
    .deposit-input-row { display: flex; align-items: center; gap: 8px; }
    .currency-prefix { color: #4caf6e; font-weight: 700; }
    .deposit-input-row input, .deposit-row input[type="number"] {
      background: rgba(255,255,255,0.05); border: 1px solid #3a4a3a;
      border-radius: 6px; padding: 6px 10px; color: #e0d5c0; font-size: 14px; width: 120px;
    }
    .alloc-note { font-size: 12px; color: #4caf6e; font-style: italic; }
    .deposit-actions { display: flex; gap: 8px; }
    .btn-deposit {
      padding: 7px 16px; background: rgba(76,175,110,0.25); border: 1px solid #4caf6e;
      border-radius: 6px; color: #4caf6e; font-weight: 600; cursor: pointer;
    }
    .btn-deposit:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-cancel {
      padding: 7px 14px; background: transparent; border: 1px solid #555;
      border-radius: 6px; color: #888; cursor: pointer;
    }
    .deposit-stats { font-size: 11px; color: #777; margin-top: 8px; }

    /* Loading */
    .loading-msg { text-align: center; color: #888; padding: 20px; font-size: 13px; }

    /* Category Tabs */
    .cat-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .cat-tab {
      padding: 5px 12px; border-radius: 20px; font-size: 12px;
      background: rgba(255,255,255,0.04); border: 1px solid #3a3a5a;
      color: #bbb; cursor: pointer; transition: all 0.2s; position: relative;
    }
    .cat-tab.active { background: rgba(200,168,75,0.15); border-color: #c8a84b; color: #c8a84b; }
    .cat-count {
      display: inline-block; margin-left: 5px; background: rgba(200,168,75,0.2);
      color: #c8a84b; border-radius: 10px; padding: 0 6px; font-size: 10px;
    }

    /* Status Filter */
    .status-filter { display: flex; gap: 6px; margin-bottom: 12px; }
    .status-btn {
      padding: 4px 10px; border-radius: 4px; font-size: 11px;
      background: transparent; border: 1px solid #3a3a5a; color: #888; cursor: pointer;
    }
    .status-btn.active { border-color: #7b9cd4; color: #7b9cd4; background: rgba(123,156,212,0.1); }

    /* Roll Overlay */
    .roll-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.75); z-index: 100;
      display: flex; align-items: center; justify-content: center;
    }
    .roll-result {
      background: #1a1a2e; border: 2px solid #c8a84b; border-radius: 12px;
      padding: 32px; text-align: center; min-width: 240px;
    }
    .roll-result.roll-won { border-color: #4caf6e; }
    .roll-result.roll-lost { border-color: #e05c44; }
    .roll-dice { font-size: 28px; margin-bottom: 6px; }
    .roll-number { font-size: 56px; font-weight: 900; color: #c8a84b; line-height: 1; }
    .roll-result.roll-won .roll-number { color: #4caf6e; }
    .roll-result.roll-lost .roll-number { color: #e05c44; }
    .roll-vs { font-size: 13px; color: #888; margin: 6px 0; }
    .roll-verdict { font-size: 18px; font-weight: 700; margin: 10px 0 6px; }
    .roll-result.roll-won .roll-verdict { color: #4caf6e; }
    .roll-result.roll-lost .roll-verdict { color: #e05c44; }
    .roll-item-name { font-size: 12px; color: #bbb; margin-bottom: 14px; }
    .btn-dismiss {
      padding: 8px 24px; border-radius: 6px; background: rgba(200,168,75,0.2);
      border: 1px solid #c8a84b; color: #c8a84b; cursor: pointer; font-weight: 600;
    }

    /* Prize Grid */
    .prize-grid { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
    .prize-card {
      background: rgba(255,255,255,0.03); border: 1px solid #2a2a4a;
      border-radius: 8px; padding: 12px 14px; transition: border-color 0.2s;
    }
    .prize-card.prize-eligible { border-color: rgba(200,168,75,0.4); }
    .prize-card.prize-pending { border-color: rgba(224,186,68,0.5); background: rgba(224,186,68,0.04); }
    .prize-card.prize-claimed { border-color: rgba(76,175,110,0.4); opacity: 0.7; }

    /* Card Header */
    .prize-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
    .prize-cat-icon { font-size: 16px; }
    .prize-name { font-size: 14px; font-weight: 600; color: #e0d5c0; flex: 1; }
    .prize-status-badge { font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 600; }
    .status-available { background: rgba(76,175,110,0.15); color: #4caf6e; }
    .status-pending   { background: rgba(224,168,68,0.15); color: #e0a844; }
    .status-claimed   { background: rgba(123,156,212,0.15); color: #7b9cd4; }

    .prize-desc  { font-size: 12px; color: #aaa; margin-bottom: 4px; }
    .prize-notes { font-size: 11px; color: #888; font-style: italic; margin-bottom: 6px; }

    /* Meta Row */
    .prize-meta-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
    .prize-value  { font-size: 15px; font-weight: 700; color: #c8a84b; }
    .prize-funding {
      font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 600;
    }
    .fund-vault  { background: rgba(200,168,75,0.15); color: #c8a84b; }
    .fund-profit { background: rgba(76,175,110,0.15); color: #4caf6e; }
    .fund-either { background: rgba(123,156,212,0.15); color: #7b9cd4; }
    .prize-min-bal { font-size: 11px; color: #777; }

    /* Dice Info */
    .prize-dice-info { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .dice-label { font-size: 13px; color: #7b68ee; }
    .dice-odds  { font-size: 11px; color: #888; }
    .dice-last  { font-size: 11px; color: #666; font-style: italic; }

    .prize-ineligible-msg { font-size: 11px; color: #e05c44; margin-bottom: 8px; }

    /* Actions */
    .prize-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .btn-roll {
      padding: 6px 14px; border-radius: 6px; background: rgba(123,104,238,0.2);
      border: 1px solid #7b68ee; color: #7b68ee; font-size: 12px; font-weight: 600; cursor: pointer;
      transition: background 0.2s;
    }
    .btn-roll:hover:not(:disabled) { background: rgba(123,104,238,0.3); }
    .btn-roll:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-claim {
      padding: 6px 14px; border-radius: 6px; background: rgba(200,168,75,0.15);
      border: 1px solid #c8a84b; color: #c8a84b; font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .btn-realize {
      padding: 6px 14px; border-radius: 6px; background: transparent;
      border: 1px solid #555; color: #aaa; font-size: 12px; cursor: pointer;
    }
    .btn-realize.btn-realized { background: rgba(76,175,110,0.15); border-color: #4caf6e; color: #4caf6e; }
    .btn-reset {
      padding: 5px 10px; border-radius: 6px; background: transparent;
      border: 1px solid #444; color: #666; font-size: 11px; cursor: pointer;
    }
    .btn-reset:hover { color: #e05c44; border-color: #e05c44; }
    .btn-delete {
      margin-left: auto; padding: 4px 8px; background: transparent;
      border: 1px solid transparent; color: #555; font-size: 12px; cursor: pointer;
      border-radius: 4px;
    }
    .btn-delete:hover { color: #e05c44; border-color: #e05c44; }

    .empty-prize-msg { text-align: center; color: #666; padding: 20px; font-size: 13px; }
    .btn-add-first {
      margin-left: 8px; padding: 4px 12px; border-radius: 6px;
      background: rgba(200,168,75,0.15); border: 1px solid #c8a84b; color: #c8a84b; cursor: pointer;
    }

    /* Add Form */
    .add-form-section { margin-top: 8px; }
    .btn-toggle-add {
      padding: 8px 18px; background: rgba(200,168,75,0.1); border: 1px solid #c8a84b;
      border-radius: 8px; color: #c8a84b; font-size: 13px; font-weight: 600; cursor: pointer; width: 100%;
    }
    .add-form {
      background: rgba(255,255,255,0.03); border: 1px solid #2a2a4a;
      border-radius: 8px; padding: 16px; margin-top: 8px;
    }
    .form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
    .form-row label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 0.06em; }
    .form-row input, .form-row select {
      background: rgba(255,255,255,0.05); border: 1px solid #3a3a5a;
      border-radius: 6px; padding: 7px 10px; color: #e0d5c0; font-size: 13px;
    }
    .form-row-split { display: flex; gap: 12px; margin-bottom: 10px; }
    .form-col { flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .form-col label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 0.06em; }
    .form-col input, .form-col select {
      background: rgba(255,255,255,0.05); border: 1px solid #3a3a5a;
      border-radius: 6px; padding: 7px 10px; color: #e0d5c0; font-size: 13px;
    }
    .form-actions { margin-top: 6px; }
    .btn-submit-add {
      padding: 8px 20px; background: rgba(200,168,75,0.2); border: 1px solid #c8a84b;
      border-radius: 7px; color: #c8a84b; font-size: 13px; font-weight: 700; cursor: pointer;
    }
    .btn-submit-add:disabled { opacity: 0.5; cursor: not-allowed; }
  `]
})
export class RewardsCatalogPanelComponent implements OnInit {

  // ── Signals ───────────────────────────────────────────────────────────────

  catalog       = signal<CatalogData | null>(null);
  vaultBalance  = signal<number>(0);
  isLoading     = signal(true);

  activeCategory    = signal<PrizeCategory | 'all'>('all');
  activeStatusFilter = signal<PrizeStatus | 'active' | 'all'>('all');

  showDepositForm  = signal(false);
  showAddForm      = signal(false);
  isDepositing     = signal(false);
  isAdding         = signal(false);
  rollingItemId    = signal<string | null>(null);
  claimingItemId   = signal<string | null>(null);
  lastRollResult   = signal<RollResult | null>(null);

  // Form state — simple mutable properties (not signals) for ngModel simplicity
  depositAmountVal = 0;
  depositAllocPct  = 10;
  newName          = '';
  newDesc          = '';
  newCategory: PrizeCategory = 'custom';
  newFunding: FundingSource  = 'vault';
  newValue         = 0;
  newMinBalance    = 0;
  newDiceSides     = 0;
  newDiceThreshold = 0;
  newNotes         = '';

  // ── Computed ──────────────────────────────────────────────────────────────

  profitPool = computed(() => this.catalog()?.profitPool ?? null);

  depositAlloc = computed(() =>
    parseFloat((this.depositAmountVal * (this.depositAllocPct / 100)).toFixed(2))
  );

  filteredItems = computed(() => {
    const items = this.catalog()?.items ?? [];
    const cat = this.activeCategory();
    const status = this.activeStatusFilter();
    return items
      .filter(i => cat === 'all' || i.category === cat)
      .filter(i => {
        if (status === 'all') return true;
        if (status === 'active') return i.status !== 'claimed';
        return i.status === status;
      });
  });

  // ── DI ────────────────────────────────────────────────────────────────────

  private readonly http = inject(HttpClient);
  protected readonly allCategories = ALL_CATEGORIES;
  protected readonly statusFilters = [
    { id: 'all' as const,       label: 'All' },
    { id: 'active' as const,    label: 'Active' },
    { id: 'available' as const, label: 'Available' },
    { id: 'pending-purchase' as PrizeStatus, label: 'Pending' },
    { id: 'claimed' as PrizeStatus,          label: 'Claimed' },
  ];

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit(): void { this.loadData(); }

  private loadData(): void {
    this.isLoading.set(true);
    forkJoin({
      catalog: this.http.get<CatalogData>(`${environment.apiUrl}/api/rewards-catalog`),
      vault:   this.http.get<any>(`${environment.apiUrl}/api/vault`).pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ catalog, vault }) => {
        this.catalog.set(catalog);
        if (vault?.balance != null) this.vaultBalance.set(vault.balance);
        this.depositAllocPct = catalog.profitPool.allocationPct;
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  protected catIcon(cat: PrizeCategory): string { return CATEGORY_META[cat]?.icon ?? '🎁'; }
  protected statusLabel(s: PrizeStatus): string { return STATUS_META[s]?.label ?? s; }
  protected statusClass(s: PrizeStatus): string { return STATUS_META[s]?.class ?? ''; }

  protected fundingLabel(f: FundingSource): string {
    return f === 'vault' ? '💰 Vault' : f === 'profit' ? '📈 Profit' : '⚡ Either';
  }

  protected diceOdds(item: CatalogItem): string {
    if (!item.diceSides || item.diceThreshold == null) return '0';
    const hits = item.diceSides - item.diceThreshold + 1;
    return Math.round((hits / item.diceSides) * 100).toString();
  }

  protected countForCategory(cat: PrizeCategory | 'all'): number {
    const items = this.catalog()?.items ?? [];
    if (cat === 'all') return items.filter(i => i.status !== 'claimed').length;
    return items.filter(i => i.category === cat && i.status !== 'claimed').length;
  }

  protected isEligible(item: CatalogItem): boolean {
    const pool = item.fundingSource === 'vault'  ? this.vaultBalance() : this.profitPool()?.balance ?? 0;
    const check = item.fundingSource === 'either'
      ? Math.max(this.vaultBalance(), this.profitPool()?.balance ?? 0)
      : pool;
    return check >= item.minBalance;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  protected onRoll(item: CatalogItem): void {
    if (this.rollingItemId()) return;
    this.rollingItemId.set(item.id);
    this.http.post<RollResult>(`${environment.apiUrl}/api/rewards-catalog/items/${item.id}/roll`, {})
      .subscribe({
        next: (result) => {
          this.rollingItemId.set(null);
          this.lastRollResult.set(result);
          this.loadData();
        },
        error: () => this.rollingItemId.set(null),
      });
  }

  protected onClaim(item: CatalogItem): void {
    if (this.claimingItemId()) return;
    this.claimingItemId.set(item.id);
    this.http.patch<CatalogItem>(`${environment.apiUrl}/api/rewards-catalog/items/${item.id}/claim`, {})
      .subscribe({
        next: () => { this.claimingItemId.set(null); this.loadData(); },
        error: () => this.claimingItemId.set(null),
      });
  }

  protected onRealize(item: CatalogItem): void {
    this.http.patch<CatalogItem>(`${environment.apiUrl}/api/rewards-catalog/items/${item.id}/realize`, {})
      .subscribe({ next: () => this.loadData() });
  }

  protected onReset(item: CatalogItem): void {
    this.http.patch<CatalogItem>(`${environment.apiUrl}/api/rewards-catalog/items/${item.id}/reset`, {})
      .subscribe({ next: () => this.loadData() });
  }

  protected deleteItem(id: string): void {
    if (!confirm('Remove this prize from the catalog?')) return;
    this.http.delete(`${environment.apiUrl}/api/rewards-catalog/items/${id}`)
      .subscribe({ next: () => this.loadData() });
  }

  protected onDeposit(): void {
    if (this.isDepositing()) return;
    this.isDepositing.set(true);
    this.http.patch<CatalogData>(`${environment.apiUrl}/api/rewards-catalog/profit-pool`, {
      allocationPct: this.depositAllocPct,
      depositAmount: this.depositAlloc(),
    }).subscribe({
      next: (updated) => {
        this.catalog.set(updated);
        this.depositAmountVal = 0;
        this.isDepositing.set(false);
        this.showDepositForm.set(false);
      },
      error: () => this.isDepositing.set(false),
    });
  }

  protected onAddItem(): void {
    if (!this.newName.trim()) return;
    if (this.isAdding()) return;
    this.isAdding.set(true);
    this.http.post<CatalogItem>(`${environment.apiUrl}/api/rewards-catalog/items`, {
      name: this.newName.trim(),
      description: this.newDesc.trim(),
      category: this.newCategory,
      fundingSource: this.newFunding,
      estimatedValue: this.newValue,
      minBalance: this.newMinBalance,
      notes: this.newNotes.trim() || undefined,
      diceSides: this.newDiceSides > 0 ? this.newDiceSides : null,
      diceThreshold: this.newDiceThreshold > 0 ? this.newDiceThreshold : null,
    }).subscribe({
      next: () => {
        this.isAdding.set(false);
        this.showAddForm.set(false);
        this.newName = ''; this.newDesc = ''; this.newValue = 0;
        this.newMinBalance = 0; this.newDiceSides = 0; this.newDiceThreshold = 0; this.newNotes = '';
        this.loadData();
      },
      error: () => this.isAdding.set(false),
    });
  }
}
