import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { environment } from '../environments/environment';

interface Transaction {
  id: string;
  date: string;
  amount: number;
  merchant: string;
  category: string;
  notes?: string;
}

interface SpendingData {
  currentMonth: string;
  currency: string;
  budgets: Record<string, number>;
  transactions: Transaction[];
  history: Array<{ month: string; totals: Record<string, number> }>;
}

const CATEGORY_META: Record<string, { icon: string; label: string; color: string }> = {
  training:      { icon: '🏋️', label: 'Training',      color: '#e05c44' },
  supplements:   { icon: '💊', label: 'Supplements',   color: '#7b68ee' },
  groceries:     { icon: '🍗', label: 'Groceries',      color: '#4caf6e' },
  entertainment: { icon: '🎮', label: 'Entertainment', color: '#7b9cd4' },
  subscriptions: { icon: '🔄', label: 'Subscriptions', color: '#c8a84b' },
  vehicle:       { icon: '🚗', label: 'Vehicle',        color: '#5bb8f5' },
  lodging:       { icon: '🏠', label: 'Lodging',        color: '#f5a623' },
  other:         { icon: '📦', label: 'Other',          color: '#888899' },
};

@Component({
  selector: 'app-treasury-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="treasury-container">

      <!-- Header -->
      <div class="treasury-header">
        <div class="treasury-title-row">
          <span class="treasury-icon">🏦</span>
          <div>
            <h2 class="treasury-title">TREASURY</h2>
            <span class="treasury-month">{{ data()?.currentMonth || '—' }}</span>
          </div>
          <button class="treasury-add-btn" (click)="showAddForm.set(!showAddForm())">
            {{ showAddForm() ? '✕ Cancel' : '+ Log Expense' }}
          </button>
        </div>

        <!-- Total spent vs total budget summary bar -->
        <div class="treasury-summary" *ngIf="data()">
          <div class="treasury-summary-labels">
            <span class="summary-label">Total Spent</span>
            <span class="summary-value" [class.over-budget]="totalSpent() > totalBudget()">
              \${{ totalSpent().toFixed(0) }} / \${{ totalBudget().toFixed(0) }}
            </span>
          </div>
          <div class="treasury-bar-track">
            <div class="treasury-bar-fill treasury-bar-total"
                 [style.width.%]="totalPercent()"
                 [style.background]="totalBarColor()">
            </div>
          </div>
          <div class="treasury-percent-label" [class.over-budget]="totalSpent() > totalBudget()">
            {{ totalPercent() }}% of monthly budget
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div *ngIf="isLoading()" class="treasury-loading">
        <span class="loading-icon">◈</span> Loading Treasury...
      </div>

      <ng-container *ngIf="!isLoading() && data()">

        <!-- CSV Import Zone -->
        <div class="csv-import-zone"
             [class.csv-drag-over]="isDragOver()"
             (dragover)="onDragOver($event)"
             (dragleave)="isDragOver.set(false)"
             (drop)="onDrop($event)">
          <input #csvInput type="file" accept=".csv" style="display:none" (change)="onFileSelected($event)" />
          <div class="csv-import-content" (click)="csvInput.click()">
            <span class="csv-icon">📥</span>
            <div class="csv-text">
              <span class="csv-primary">Drop Monarch CSV here or click to browse</span>
              <span class="csv-secondary">Transactions → Export → CSV in Monarch · Duplicates auto-skipped</span>
            </div>
          </div>
          <div class="csv-status" *ngIf="importStatus()">
            <span [class.csv-status-ok]="importResult()?.success"
                  [class.csv-status-err]="!importResult()?.success">
              {{ importStatus() }}
            </span>
          </div>
          <div *ngIf="isImporting()" class="csv-importing">◌ Importing…</div>
        </div>

        <!-- Add Transaction Form -->
        <div class="treasury-form" *ngIf="showAddForm()">
          <h3 class="form-title">⚒ Log Expense</h3>
          <div class="form-grid">
            <div class="form-field">
              <label>Merchant</label>
              <input type="text" [(ngModel)]="newTxn.merchant" placeholder="e.g. Real Mushrooms" />
            </div>
            <div class="form-field">
              <label>Amount ($)</label>
              <input type="number" [(ngModel)]="newTxn.amount" placeholder="0.00" min="0.01" step="0.01" />
            </div>
            <div class="form-field">
              <label>Category</label>
              <select [(ngModel)]="newTxn.category">
                <option *ngFor="let cat of categoryKeys()" [value]="cat">
                  {{ getCategoryMeta(cat).icon }} {{ getCategoryMeta(cat).label }}
                </option>
              </select>
            </div>
            <div class="form-field">
              <label>Date</label>
              <input type="date" [(ngModel)]="newTxn.date" />
            </div>
          </div>
          <div class="form-field form-field-full">
            <label>Notes (optional)</label>
            <input type="text" [(ngModel)]="newTxn.notes" placeholder="e.g. Lion's Mane 120 caps" />
          </div>
          <div class="form-actions">
            <button class="treasury-btn treasury-btn-primary" (click)="addTransaction()" [disabled]="isSaving()">
              {{ isSaving() ? '◌ Saving…' : '✓ Add Expense' }}
            </button>
            <span class="form-error" *ngIf="formError()">{{ formError() }}</span>
          </div>
        </div>

        <!-- Category Budget Bars -->
        <div class="treasury-categories">
          <h3 class="section-title">◈ Budget Breakdown</h3>
          <div class="category-row" *ngFor="let cat of categoryKeys()">
            <div class="category-header">
              <span class="category-icon">{{ getCategoryMeta(cat).icon }}</span>
              <span class="category-label">{{ getCategoryMeta(cat).label }}</span>
              <span class="category-amounts" [class.over-budget]="getCategorySpent(cat) > data()!.budgets[cat]">
                \${{ getCategorySpent(cat).toFixed(0) }} / \${{ data()!.budgets[cat] }}
              </span>
            </div>
            <div class="category-bar-track">
              <div class="category-bar-fill"
                   [style.width.%]="getCategoryPercent(cat)"
                   [style.background]="getCategoryMeta(cat).color"
                   [class.bar-over]="getCategoryPercent(cat) >= 100">
              </div>
            </div>
            <div class="category-status">
              <span class="status-badge"
                    [class.badge-ok]="getCategoryStatus(cat) === 'ok'"
                    [class.badge-warn]="getCategoryStatus(cat) === 'warn'"
                    [class.badge-crit]="getCategoryStatus(cat) === 'crit'">
                {{ getCategoryStatusLabel(cat) }}
              </span>
              <span class="category-remaining" *ngIf="getCategorySpent(cat) <= data()!.budgets[cat]">
                \${{ (data()!.budgets[cat] - getCategorySpent(cat)).toFixed(0) }} remaining
              </span>
            </div>
          </div>
        </div>

        <!-- Recent Transactions -->
        <div class="treasury-transactions">
          <h3 class="section-title">⚔ Recent Transactions</h3>
          <div *ngIf="sortedTransactions().length === 0" class="no-transactions">
            No transactions logged this month.
          </div>
          <div class="txn-row" *ngFor="let txn of sortedTransactions()">
            <span class="txn-icon">{{ getCategoryMeta(txn.category).icon }}</span>
            <div class="txn-info">
              <span class="txn-merchant">{{ txn.merchant }}</span>
              <span class="txn-meta">{{ txn.date }} · {{ getCategoryMeta(txn.category).label }}</span>
              <span class="txn-notes" *ngIf="txn.notes">{{ txn.notes }}</span>
            </div>
            <div class="txn-right">
              <span class="txn-amount">\${{ txn.amount.toFixed(2) }}</span>
              <button class="txn-delete" (click)="deleteTransaction(txn.id)" title="Remove">✕</button>
            </div>
          </div>
        </div>

        <!-- Monthly History Trend -->
        <div class="treasury-history" *ngIf="data()!.history.length > 0">
          <h3 class="section-title">📊 Monthly Trend</h3>
          <div class="history-grid">
            <div class="history-month" *ngFor="let h of data()!.history.slice(0, 4)">
              <div class="history-label">{{ h.month.split(' ')[0] }}</div>
              <div class="history-total">\${{ getHistoryTotal(h.totals).toFixed(0) }}</div>
              <div class="history-bar-track">
                <div class="history-bar-fill"
                     [style.width.%]="getHistoryBarWidth(h.totals)"
                     [style.background]="getHistoryBarColor(h.totals)">
                </div>
              </div>
            </div>
            <!-- Current month as latest bar -->
            <div class="history-month history-current">
              <div class="history-label">{{ data()!.currentMonth.split(' ')[0] }}</div>
              <div class="history-total">\${{ totalSpent().toFixed(0) }}</div>
              <div class="history-bar-track">
                <div class="history-bar-fill history-bar-active"
                     [style.width.%]="totalPercent()"
                     [style.background]="totalBarColor()">
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Achievements -->
        <div class="treasury-achievements" *ngIf="achievements().length > 0">
          <h3 class="section-title">🏆 Achievements</h3>
          <div class="achievement-badge" *ngFor="let ach of achievements()">
            <span class="ach-icon">{{ ach.icon }}</span>
            <span class="ach-label">{{ ach.label }}</span>
          </div>
        </div>

        <!-- Rollover Button -->
        <div class="treasury-rollover">
          <button class="treasury-btn treasury-btn-secondary" (click)="promptRollover()">
            ↩ Archive Month & Start New
          </button>
        </div>

      </ng-container>
    </div>
  `,
  styles: [`
    .treasury-container {
      padding: 16px;
      color: #e0d5c0;
      max-width: 760px;
      margin: 0 auto;
    }

    /* ── Header ── */
    .treasury-header {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .treasury-title-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    .treasury-icon { font-size: 28px; }
    .treasury-title {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      color: #c8a84b;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .treasury-month {
      font-size: 11px;
      color: #888;
      letter-spacing: 0.08em;
    }
    .treasury-add-btn {
      margin-left: auto;
      background: rgba(200,168,75,0.15);
      border: 1px solid #c8a84b44;
      color: #c8a84b;
      border-radius: 4px;
      padding: 6px 14px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .treasury-add-btn:hover { background: rgba(200,168,75,0.25); }

    /* ── Summary bar ── */
    .treasury-summary { margin-top: 4px; }
    .treasury-summary-labels {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 6px;
    }
    .summary-label { color: #888; }
    .summary-value { color: #e0d5c0; font-weight: 600; }
    .treasury-bar-track {
      background: rgba(255,255,255,0.07);
      border-radius: 4px;
      height: 10px;
      overflow: hidden;
      margin-bottom: 4px;
    }
    .treasury-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.6s ease;
      max-width: 100%;
    }
    .treasury-percent-label { font-size: 11px; color: #888; text-align: right; }
    .over-budget { color: #e05c44 !important; }

    /* ── CSV Import Zone ── */
    .csv-import-zone {
      background: rgba(255,255,255,0.02);
      border: 2px dashed #2a2a4a;
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 14px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
    }
    .csv-import-zone:hover, .csv-drag-over {
      border-color: #c8a84b66;
      background: rgba(200,168,75,0.05);
    }
    .csv-import-content {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .csv-icon { font-size: 22px; flex-shrink: 0; }
    .csv-text { display: flex; flex-direction: column; gap: 3px; }
    .csv-primary { font-size: 13px; color: #c8a84b; font-weight: 500; }
    .csv-secondary { font-size: 11px; color: #666; }
    .csv-status { margin-top: 8px; font-size: 12px; padding-left: 34px; }
    .csv-status-ok  { color: #4caf6e; }
    .csv-status-err { color: #e05c44; }
    .csv-importing  { font-size: 12px; color: #888; padding-left: 34px; margin-top: 6px; }

    /* ── Add Form ── */
    .treasury-form {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .form-title {
      font-size: 13px;
      font-weight: 600;
      color: #c8a84b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 12px;
    }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 10px;
    }
    .form-field { display: flex; flex-direction: column; gap: 4px; }
    .form-field-full { margin-bottom: 10px; }
    .form-field label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.06em; }
    .form-field input, .form-field select {
      background: rgba(255,255,255,0.05);
      border: 1px solid #333355;
      color: #e0d5c0;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 13px;
    }
    .form-field input:focus, .form-field select:focus {
      outline: none;
      border-color: #c8a84b66;
    }
    .form-field select option { background: #1a1a2e; color: #e0d5c0; }
    .form-actions { display: flex; align-items: center; gap: 12px; }
    .form-error { font-size: 12px; color: #e05c44; }

    /* ── Buttons ── */
    .treasury-btn {
      padding: 7px 16px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.2s;
    }
    .treasury-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .treasury-btn-primary {
      background: rgba(200,168,75,0.2);
      border-color: #c8a84b66;
      color: #c8a84b;
    }
    .treasury-btn-primary:hover:not(:disabled) { background: rgba(200,168,75,0.3); }
    .treasury-btn-secondary {
      background: rgba(255,255,255,0.04);
      border-color: #333355;
      color: #888;
    }
    .treasury-btn-secondary:hover { background: rgba(255,255,255,0.08); color: #bbb; }

    /* ── Category bars ── */
    .treasury-categories {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: #c8a84b;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 0 0 14px;
    }
    .category-row { margin-bottom: 14px; }
    .category-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 5px;
    }
    .category-icon { font-size: 15px; }
    .category-label { font-size: 13px; font-weight: 500; flex: 1; }
    .category-amounts { font-size: 12px; color: #aaa; }
    .category-bar-track {
      background: rgba(255,255,255,0.07);
      border-radius: 3px;
      height: 7px;
      overflow: hidden;
      margin-bottom: 4px;
    }
    .category-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.6s ease;
      max-width: 100%;
    }
    .bar-over { animation: pulse-red 1.5s infinite; }
    @keyframes pulse-red { 0%,100% { opacity:1 } 50% { opacity:0.6 } }
    .category-status { display: flex; align-items: center; justify-content: space-between; }
    .status-badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 3px;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.06em;
    }
    .badge-ok   { background: rgba(76,175,110,0.2); color: #4caf6e; }
    .badge-warn { background: rgba(255,180,0,0.2);  color: #ffb400; }
    .badge-crit { background: rgba(224,92,68,0.25); color: #e05c44; }
    .category-remaining { font-size: 11px; color: #666; }

    /* ── Transactions ── */
    .treasury-transactions {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .no-transactions { font-size: 13px; color: #555; text-align: center; padding: 16px 0; }
    .txn-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 9px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .txn-row:last-child { border-bottom: none; }
    .txn-icon { font-size: 16px; padding-top: 2px; }
    .txn-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .txn-merchant { font-size: 13px; font-weight: 500; color: #e0d5c0; }
    .txn-meta { font-size: 11px; color: #666; }
    .txn-notes { font-size: 11px; color: #888; font-style: italic; }
    .txn-right { display: flex; align-items: center; gap: 10px; }
    .txn-amount { font-size: 14px; font-weight: 600; color: #c8a84b; white-space: nowrap; }
    .txn-delete {
      background: none;
      border: none;
      color: #444;
      cursor: pointer;
      font-size: 11px;
      padding: 2px 4px;
      transition: color 0.2s;
    }
    .txn-delete:hover { color: #e05c44; }

    /* ── History ── */
    .treasury-history {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .history-grid { display: flex; gap: 12px; align-items: flex-end; }
    .history-month { flex: 1; }
    .history-current .history-label { color: #c8a84b; font-weight: 600; }
    .history-label { font-size: 11px; color: #888; text-align: center; margin-bottom: 4px; }
    .history-total { font-size: 12px; color: #aaa; text-align: center; margin-bottom: 4px; }
    .history-bar-track {
      background: rgba(255,255,255,0.07);
      border-radius: 3px;
      height: 40px;
      display: flex;
      align-items: flex-end;
      overflow: hidden;
    }
    .history-bar-fill {
      width: 100%;
      border-radius: 3px;
      transition: height 0.6s ease;
    }

    /* ── Achievements ── */
    .treasury-achievements {
      background: rgba(255,255,255,0.03);
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .achievement-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(200,168,75,0.1);
      border: 1px solid #c8a84b33;
      border-radius: 4px;
      padding: 5px 10px;
      margin: 4px 4px 4px 0;
      font-size: 12px;
    }
    .ach-icon { font-size: 14px; }
    .ach-label { color: #c8a84b; }

    /* ── Rollover ── */
    .treasury-rollover { text-align: center; padding: 8px 0 4px; }

    /* ── Loading ── */
    .treasury-loading {
      text-align: center;
      padding: 40px;
      color: #666;
      font-size: 14px;
    }
    .loading-icon {
      display: inline-block;
      animation: spin 1.2s linear infinite;
    }
    @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
  `]
})
export class TreasuryPanelComponent implements OnInit {
  private readonly http = inject(HttpClient);

  data        = signal<SpendingData | null>(null);
  isLoading   = signal(true);
  isSaving    = signal(false);
  showAddForm = signal(false);
  formError   = signal('');

  // CSV import signals
  isDragOver   = signal(false);
  isImporting  = signal(false);
  importStatus = signal('');
  importResult = signal<{ success: boolean; imported: number; skipped: number } | null>(null);

  newTxn = { merchant: '', amount: null as number | null, category: 'supplements', date: this.todayStr(), notes: '' };

  totalSpent = computed(() => {
    const d = this.data();
    if (!d) return 0;
    return d.transactions.reduce((sum, t) => sum + t.amount, 0);
  });

  totalBudget = computed(() => {
    const d = this.data();
    if (!d) return 0;
    return Object.values(d.budgets).reduce((sum, v) => sum + v, 0);
  });

  totalPercent = computed(() => {
    const pct = this.totalBudget() > 0 ? Math.round((this.totalSpent() / this.totalBudget()) * 100) : 0;
    return Math.min(pct, 100);
  });

  sortedTransactions = computed(() => {
    const d = this.data();
    if (!d) return [];
    return [...d.transactions].sort((a, b) => b.date.localeCompare(a.date));
  });

  achievements = computed(() => {
    const d = this.data();
    if (!d) return [];
    const result: { icon: string; label: string }[] = [];

    for (const cat of Object.keys(d.budgets)) {
      const spent = this.getCategorySpent(cat);
      if (spent <= d.budgets[cat] * 0.75) {
        result.push({ icon: '🏆', label: `${CATEGORY_META[cat]?.label || cat}: Under 75% Budget` });
      }
    }
    if (this.totalSpent() < this.totalBudget()) {
      result.push({ icon: '⭐', label: 'Total: Under Budget This Month' });
    }
    return result;
  });

  categoryKeys = computed(() => {
    const d = this.data();
    if (!d) return [];
    return Object.keys(d.budgets);
  });

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    this.http.get<{ success: boolean; data: SpendingData; totals: Record<string, number> }>(
      `${environment.apiUrl}/api/treasury`
    ).pipe(catchError(() => of(null))).subscribe(res => {
      if (res?.success) this.data.set(res.data);
      this.isLoading.set(false);
    });
  }

  getCategorySpent(cat: string): number {
    const d = this.data();
    if (!d) return 0;
    return d.transactions.filter(t => t.category === cat).reduce((sum, t) => sum + t.amount, 0);
  }

  getCategoryPercent(cat: string): number {
    const d = this.data();
    if (!d) return 0;
    const budget = d.budgets[cat];
    if (!budget) return 0;
    return Math.min(Math.round((this.getCategorySpent(cat) / budget) * 100), 100);
  }

  getCategoryStatus(cat: string): 'ok' | 'warn' | 'crit' {
    const pct = this.getCategoryPercent(cat);
    if (pct >= 100) return 'crit';
    if (pct >= 80)  return 'warn';
    return 'ok';
  }

  getCategoryStatusLabel(cat: string): string {
    const s = this.getCategoryStatus(cat);
    const pct = this.getCategoryPercent(cat);
    if (s === 'crit') return '🔴 Over Budget';
    if (s === 'warn') return `⚠ ${pct}% Used`;
    return `✅ ${pct}% Used`;
  }

  getCategoryMeta(cat: string) {
    return CATEGORY_META[cat] || { icon: '📦', label: cat, color: '#888899' };
  }

  totalBarColor(): string {
    const pct = this.totalPercent();
    if (pct >= 100) return '#e05c44';
    if (pct >= 80)  return '#ffb400';
    return '#4caf6e';
  }

  getHistoryTotal(totals: Record<string, number>): number {
    return Object.values(totals).reduce((sum, v) => sum + v, 0);
  }

  getHistoryBarWidth(totals: Record<string, number>): number {
    const total = this.getHistoryTotal(totals);
    const budget = this.totalBudget();
    if (!budget) return 0;
    return Math.min(Math.round((total / budget) * 100), 100);
  }

  getHistoryBarColor(totals: Record<string, number>): string {
    const pct = this.getHistoryBarWidth(totals);
    if (pct >= 100) return '#e05c44';
    if (pct >= 80)  return '#ffb400';
    return '#4caf6e';
  }

  addTransaction(): void {
    this.formError.set('');
    const { merchant, amount, category, date, notes } = this.newTxn;
    if (!merchant.trim()) { this.formError.set('Merchant is required'); return; }
    if (!amount || amount <= 0) { this.formError.set('Amount must be positive'); return; }

    this.isSaving.set(true);
    this.http.post<{ success: boolean; transaction: any; totals: Record<string, number> }>(
      `${environment.apiUrl}/api/treasury/transactions`,
      { merchant: merchant.trim(), amount, category, date, notes: notes.trim() || undefined }
    ).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.showAddForm.set(false);
        this.newTxn = { merchant: '', amount: null, category: 'supplements', date: this.todayStr(), notes: '' };
        this.loadData();
      },
      error: () => {
        this.isSaving.set(false);
        this.formError.set('Failed to save. Try again.');
      }
    });
  }

  deleteTransaction(id: string): void {
    this.http.delete(`${environment.apiUrl}/api/treasury/transactions/${id}`)
      .subscribe({ next: () => this.loadData() });
  }

  // ── CSV Import ────────────────────────────────────────────────────────────

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.uploadCSV(file);
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.uploadCSV(file);
  }

  private uploadCSV(file: File): void {
    if (!file.name.endsWith('.csv')) {
      this.importStatus.set('⚠ Please upload a .csv file');
      return;
    }

    this.isImporting.set(true);
    this.importStatus.set('');
    this.importResult.set(null);

    const form = new FormData();
    form.append('file', file);

    this.http.post<{ success: boolean; imported: number; skipped: number }>(
      `${environment.apiUrl}/api/treasury/import-csv`, form
    ).subscribe({
      next: (res) => {
        this.isImporting.set(false);
        this.importResult.set(res);
        this.importStatus.set(
          `✓ Imported ${res.imported} transaction${res.imported !== 1 ? 's' : ''}` +
          (res.skipped > 0 ? ` · ${res.skipped} duplicate${res.skipped !== 1 ? 's' : ''} skipped` : '')
        );
        this.loadData();
      },
      error: () => {
        this.isImporting.set(false);
        this.importResult.set({ success: false, imported: 0, skipped: 0 });
        this.importStatus.set('✕ Import failed. Check file format and try again.');
      }
    });
  }

  promptRollover(): void {
    const next = prompt('Archive current month and start new. Enter new month name (e.g. "May 2026"):');
    if (!next?.trim()) return;
    this.http.post(`${environment.apiUrl}/api/treasury/rollover`, { newMonth: next.trim() })
      .subscribe({ next: () => this.loadData() });
  }

  private todayStr(): string {
    return new Date().toLocaleDateString('en-CA');
  }
}
