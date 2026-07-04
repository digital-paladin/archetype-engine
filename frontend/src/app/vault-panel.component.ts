import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { environment } from '../environments/environment';

// ─── Interfaces ───────────────────────────────────────────────────────────────

type RewardTier = 'minimum' | 'acm_perfect' | 'perfect_week' | 'level_up' | 'sprint_story' | 'custom';

interface GateCriterion {
  id: string;
  label: string;
  met: boolean;
  metAt?: string;
}

interface VaultEntry {
  id: string;
  date: string;
  milestone: string;
  tier: RewardTier;
  baseAmount: number;
  bonusAmount: number;
  totalAmount: number;
  diceRoll?: number;
  diceSides?: number;
  tags?: string[];
  realizedInSoFi?: boolean;
  acmScore?: number;
  acmMaxScore?: number;
  acmMultiplier?: number;
}

interface VaultData {
  balance: number;
  status: 'locked' | 'unlocked';
  unlockedAt?: string;
  gateCriteria: GateCriterion[];
  entries: VaultEntry[];
  lastUpdated: string;
}

interface VaultResponse {
  success: boolean;
  vault: VaultData;
}

// ─── ACM category weights (mirrors backend/src/models/vault.ts) ───────────────
// Index = journal action item (0-based)
// Weight-2: 0=alcohol, 1=prayer, 2=training, 3=dev, 4=redteam, 10=sexual, 13=bonfire
// Weight-1: 5=artist, 6=mech_eng, 7=fasting, 8=hydration, 9=diet, 11=teeth, 12=protein, 14=supplements
const ACM_ITEM_WEIGHTS = [2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 2, 1, 2, 1];
const ACM_MAX_SCORE    = ACM_ITEM_WEIGHTS.reduce((a, b) => a + b, 0); // 20

function computeAcmWeightedScore(itemStates: boolean[]): number {
  return itemStates.reduce((sum, checked, i) => sum + (checked ? ACM_ITEM_WEIGHTS[i] : 0), 0);
}

function acmMultiplierFromScore(score: number): number {
  return Math.max(0.5, score / ACM_MAX_SCORE);
}

// ─── Tier metadata for display ────────────────────────────────────────────────

const TIER_META: Record<RewardTier, { label: string; base: number; icon: string; dice: string }> = {
  minimum:      { label: 'Minimum',         base: 10, icon: '◈', dice: '—' },
  acm_perfect:  { label: 'ACM Perfect Day', base: 25, icon: '⚖', dice: 'D6' },
  perfect_week: { label: 'Perfect Week',    base: 50, icon: '🏆', dice: 'D12' },
  level_up:     { label: 'Level Up',        base: 25, icon: '⬆', dice: 'D6' },
  sprint_story: { label: 'Sprint Story',    base: 50, icon: '📋', dice: 'D12' },
  custom:       { label: 'Custom',          base:  0, icon: '✦', dice: '—' },
};

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-vault-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="vault-root">

      <!-- ══ Vault Header ══ -->
      <div class="vault-header">
        <div class="vault-title-group">
          <span class="vault-lock-icon">{{ vault()?.status === 'unlocked' ? '🔓' : '🔒' }}</span>
          <h2 class="vault-title">STRATEGY VAULT</h2>
        </div>
        <div class="vault-status-badge" [ngClass]="vault()?.status === 'unlocked' ? 'vault-badge-unlocked' : 'vault-badge-locked'">
          {{ vault()?.status === 'unlocked' ? 'UNLOCKED' : 'LOCKED' }}
        </div>
      </div>

      <!-- ══ Balance ══ -->
      <div class="vault-balance-block" *ngIf="vault()">
        <div class="vault-balance-label">ACCUMULATED BALANCE</div>
        <div class="vault-balance-value">{{ vault()!.balance | currency:'USD':'symbol':'1.2-2' }}</div>
        <div class="vault-balance-note" *ngIf="vault()!.status === 'locked'">
          Locked — deploys as strategy seed capital on unlock
        </div>
        <div class="vault-balance-note vault-balance-note-live" *ngIf="vault()!.status === 'unlocked'">
          ✅ Live — deployed as strategy seed capital
        </div>
      </div>

      <!-- ══ Live-Ready Gate ══ -->
      <div class="vault-gate-section" *ngIf="vault()">
        <div class="vault-section-header">
          <span class="vault-section-title">LIVE-READY GATE</span>
          <span class="vault-gate-count">{{ gateProgress() }} / {{ vault()!.gateCriteria.length }}</span>
        </div>

        <!-- Progress bar -->
        <div class="vault-gate-bar-track">
          <div class="vault-gate-bar-fill"
               [style.width.%]="gateProgressPct()"
               [ngClass]="gateProgressPct() === 100 ? 'vault-gate-bar-complete' : ''"></div>
        </div>

        <!-- Criteria list -->
        <ul class="vault-gate-list">
          <li *ngFor="let c of vault()!.gateCriteria"
              class="vault-gate-item"
              [class.vault-gate-met]="c.met"
              (click)="toggleGate(c.id)">
            <span class="vault-gate-check">{{ c.met ? '☑' : '☐' }}</span>
            <span class="vault-gate-label">{{ c.label }}</span>
            <span class="vault-gate-date" *ngIf="c.met && c.metAt">{{ c.metAt | date:'MMM d' }}</span>
          </li>
        </ul>
      </div>

      <!-- ══ Reward Tier Reference ══ -->
      <div class="vault-tiers-section">
        <div class="vault-section-header">
          <span class="vault-section-title">REWARD TIERS</span>
          <button class="vault-toggle-btn" (click)="showTierRef.set(!showTierRef())">
            {{ showTierRef() ? '▲ hide' : '▼ show' }}
          </button>
        </div>
        <table class="vault-tier-table" *ngIf="showTierRef()">
          <thead>
            <tr>
              <th>Achievement</th>
              <th>Base</th>
              <th>Roll</th>
              <th>Max Bonus</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Minimum discipline action</td>
              <td class="vault-tier-amt">$10</td>
              <td class="vault-tier-dice">—</td>
              <td>—</td>
            </tr>
            <tr>
              <td>All 12 ACM items ✅ (perfect day)</td>
              <td class="vault-tier-amt">$25</td>
              <td class="vault-tier-dice">D6</td>
              <td>+$12.50 (if roll = 6)</td>
            </tr>
            <tr>
              <td>Perfect week (7 consecutive days)</td>
              <td class="vault-tier-amt">$50</td>
              <td class="vault-tier-dice">D12</td>
              <td>+$25.00 (if roll = 12)</td>
            </tr>
            <tr>
              <td>Level up (any skill tree)</td>
              <td class="vault-tier-amt">$25</td>
              <td class="vault-tier-dice">D6</td>
              <td>+$12.50 (if roll = 6)</td>
            </tr>
            <tr>
              <td>Sprint story completed (IQ-XXXX)</td>
              <td class="vault-tier-amt">$50</td>
              <td class="vault-tier-dice">D12</td>
              <td>+$25.00 (if roll = 12)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ Add Milestone Form ══ -->
      <div class="vault-add-section">
        <div class="vault-section-header">
          <span class="vault-section-title">LOG MILESTONE</span>
          <button class="vault-toggle-btn" (click)="showForm.set(!showForm())">
            {{ showForm() ? '▲ cancel' : '+ add' }}
          </button>
        </div>

        <div class="vault-form" *ngIf="showForm()">
          <div class="vault-form-group">
            <label>Milestone Description</label>
            <input [(ngModel)]="form.milestone" placeholder="e.g. 7-day streak maintained" />
          </div>

          <div class="vault-form-row">
            <div class="vault-form-group">
              <label>Reward Tier</label>
              <select [(ngModel)]="form.tier">
                <option value="minimum">◈ Minimum — $10 (no roll)</option>
                <option value="acm_perfect">⚖ ACM Perfect Day — $25 + D6</option>
                <option value="perfect_week">🏆 Perfect Week — $50 + D12</option>
                <option value="level_up">⬆ Level Up — $25 + D6</option>
                <option value="sprint_story">📋 Sprint Story — $50 + D12</option>
                <option value="custom">✦ Custom</option>
              </select>
            </div>
            <div class="vault-form-group vault-form-group-sm" *ngIf="form.tier === 'custom'">
              <label>Amount ($)</label>
              <input type="number" [(ngModel)]="form.customAmount" min="1" />
            </div>
          </div>

          <!-- ACM Score (pre-filled from today's ACM data) -->
          <div class="vault-form-group">
            <label>
              ACM Score
              <span class="vault-acm-hint" *ngIf="todayAcmScore() !== null">· Today: {{ todayAcmScore() }}/18</span>
            </label>
            <div class="vault-acm-row">
              <input type="number" [(ngModel)]="form.acmScore" min="0" max="18" step="1" class="vault-acm-input" />
              <span *ngIf="acmPreviewMultiplier() !== null"
                    class="vault-acm-multiplier"
                    [class.vault-acm-floor]="acmPreviewMultiplier()! <= 0.5">
                {{ (acmPreviewMultiplier()! * 100).toFixed(0) }}% · base {{ acmPreviewBase()! | currency:'USD':'symbol':'1.2-2' }}
              </span>
              <span *ngIf="form.acmScore === null || form.acmScore === undefined" class="vault-acm-hint">
                Leave blank for no multiplier
              </span>
            </div>
          </div>

          <div class="vault-form-group">
            <label>Date (optional)</label>
            <input type="date" [(ngModel)]="form.date" />
          </div>

          <!-- Dice roll result preview -->
          <div class="vault-roll-preview" *ngIf="rollResult()">
            <span class="vault-roll-icon">🎲</span>
            <span class="vault-roll-text">
              Rolled <strong>{{ rollResult()!.roll }}</strong> / {{ rollResult()!.sides }}
              <span class="vault-roll-max" *ngIf="rollResult()!.isMax"> — MAX ROLL! +50% bonus! 🎯</span>
            </span>
          </div>

          <!-- Roll button (only for tiers with dice) -->
          <button class="vault-btn vault-btn-secondary vault-btn-dice"
                  *ngIf="tierHasDice()"
                  [disabled]="isSubmitting()"
                  (click)="previewRoll()">
            🎲 Preview Roll ({{ form.tier === 'acm_perfect' ? 'D6' : 'D12' }})
          </button>

          <button class="vault-btn vault-btn-primary"
                  [disabled]="!form.milestone.trim() || isSubmitting()"
                  (click)="submitEntry()">
            {{ isSubmitting() ? 'Adding...' : '+ Bank to Vault' }}
          </button>
        </div>
      </div>

      <!-- ══ Vault Ledger ══ -->
      <div class="vault-ledger-section" *ngIf="vault()">
        <div class="vault-section-header">
          <span class="vault-section-title">VAULT LEDGER</span>
          <span class="vault-entry-count">{{ vault()!.entries.length }} entries</span>
        </div>

        <div class="vault-empty" *ngIf="!vault()!.entries.length">
          <span class="vault-empty-icon">💰</span>
          <span>No entries yet — log your first milestone above</span>
        </div>

        <ul class="vault-ledger-list" *ngIf="vault()!.entries.length">
          <li *ngFor="let e of vault()!.entries" class="vault-ledger-item">
            <div class="vault-ledger-row">
              <span class="vault-ledger-icon">{{ TIER_META[e.tier].icon }}</span>
              <div class="vault-ledger-info">
                <span class="vault-ledger-milestone">{{ e.milestone }}</span>
                <span class="vault-ledger-meta">
                  {{ e.date }} · {{ TIER_META[e.tier].label }}
                  <span *ngIf="e.diceRoll"> · 🎲 rolled {{ e.diceRoll }}/{{ e.diceSides }}</span>
                  <span *ngIf="e.bonusAmount > 0" class="vault-ledger-bonus"> +{{ fmt(e.bonusAmount) }} BONUS</span>
                  <span *ngIf="e.acmScore !== undefined" class="vault-ledger-acm"> · ⚖ {{ e.acmScore }}/18 ({{ (e.acmMultiplier! * 100).toFixed(0) }}%)</span>
                </span>
              </div>
              <div class="vault-ledger-amount" [class.vault-ledger-amount-bonus]="e.bonusAmount > 0">
                {{ e.totalAmount | currency:'USD':'symbol':'1.2-2' }}
              </div>
              <button class="vault-sofi-btn"
                      [class.vault-sofi-done]="e.realizedInSoFi"
                      (click)="toggleSoFi(e.id)"
                      [title]="e.realizedInSoFi ? 'Moved to SoFi ✓ (click to undo)' : 'Mark as moved to SoFi savings goal'"
                      [disabled]="sofiLoading() === e.id">
                {{ e.realizedInSoFi ? '🏦' : '⬜' }}
              </button>
              <button class="vault-ledger-delete" (click)="deleteEntry(e.id)" title="Remove entry">✕</button>
            </div>
          </li>
        </ul>
      </div>

      <div class="vault-loading" *ngIf="isLoading()">Loading vault...</div>
    </div>
  `,
  styles: [`
    .vault-root {
      font-family: 'Cinzel', 'Palatino Linotype', serif;
      color: var(--eso-text, #e2cfa8);
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 4px 0;
    }

    /* ── Header ── */
    .vault-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .vault-title-group { display: flex; align-items: center; gap: 10px; }
    .vault-lock-icon { font-size: 22px; }
    .vault-title {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: var(--eso-gold, #c9a84c);
      margin: 0;
    }
    .vault-status-badge {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 2px;
      padding: 4px 10px;
      border: 1px solid currentColor;
      border-radius: 2px;
    }
    .vault-badge-locked   { color: #e05c44; border-color: rgba(224,92,68,0.4); background: rgba(224,92,68,0.08); }
    .vault-badge-unlocked { color: #4caf6e; border-color: rgba(76,175,110,0.4); background: rgba(76,175,110,0.08); }

    /* ── Balance ── */
    .vault-balance-block {
      text-align: center;
      padding: 18px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(201,168,76,0.2);
    }
    .vault-balance-label {
      font-size: 9px;
      letter-spacing: 3px;
      color: var(--eso-text-muted, #6a5030);
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .vault-balance-value {
      font-size: 36px;
      font-weight: 700;
      color: var(--eso-gold, #c9a84c);
      line-height: 1.1;
    }
    .vault-balance-note {
      font-size: 10px;
      color: #555;
      font-family: sans-serif;
      font-style: italic;
      margin-top: 6px;
    }
    .vault-balance-note-live { color: #4caf6e; font-style: normal; }

    /* ── Section headers ── */
    .vault-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(155,115,38,0.2);
    }
    .vault-section-title {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      color: var(--eso-gold, #c9a84c);
    }

    /* ── Gate ── */
    .vault-gate-count {
      font-size: 11px;
      color: #7b9cd4;
      font-family: sans-serif;
    }
    .vault-gate-bar-track {
      height: 4px;
      background: rgba(255,255,255,0.06);
      border-radius: 2px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .vault-gate-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #c9a84c, #f2c96a);
      border-radius: 2px;
      transition: width 0.4s ease;
    }
    .vault-gate-bar-complete { background: linear-gradient(90deg, #4caf6e, #8fe8aa); }

    .vault-gate-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
    .vault-gate-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 8px;
      cursor: pointer;
      border-radius: 2px;
      transition: background 0.15s;
      min-height: 44px;
    }
    .vault-gate-item:hover { background: rgba(201,168,76,0.06); }
    .vault-gate-check { font-size: 16px; flex-shrink: 0; color: #555; }
    .vault-gate-met .vault-gate-check { color: #4caf6e; }
    .vault-gate-label {
      flex: 1;
      font-size: 11px;
      font-family: sans-serif;
      color: #a08858;
      line-height: 1.4;
    }
    .vault-gate-met .vault-gate-label { color: var(--eso-text, #e2cfa8); }
    .vault-gate-date {
      font-size: 10px;
      color: #4caf6e;
      font-family: sans-serif;
      flex-shrink: 0;
    }

    /* ── Toggle / misc ── */
    .vault-toggle-btn {
      background: none;
      border: none;
      color: #6a5030;
      cursor: pointer;
      font-size: 10px;
      font-family: sans-serif;
      padding: 2px 6px;
      letter-spacing: 0.5px;
    }
    .vault-toggle-btn:hover { color: var(--eso-gold, #c9a84c); }
    .vault-entry-count { font-size: 10px; color: #555; font-family: sans-serif; }

    /* ── Tier table ── */
    .vault-tier-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      font-family: sans-serif;
      margin-bottom: 4px;
    }
    .vault-tier-table th {
      text-align: left;
      font-size: 9px;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 1px;
      padding: 4px 6px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .vault-tier-table td {
      padding: 7px 6px;
      color: #a08858;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .vault-tier-table tr:last-child td { border-bottom: none; }
    .vault-tier-amt { color: var(--eso-gold, #c9a84c); font-weight: 700; }
    .vault-tier-dice { color: #7b9cd4; }

    /* ── Form ── */
    .vault-form { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: rgba(0,0,0,0.2); border: 1px solid rgba(155,115,38,0.2); }
    .vault-form-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .vault-form-row .vault-form-group { flex: 1; min-width: 120px; }
    .vault-form-group { display: flex; flex-direction: column; gap: 4px; }
    .vault-form-group-sm { max-width: 90px; }
    .vault-form-group label {
      font-size: 9px;
      color: #6a5030;
      text-transform: uppercase;
      letter-spacing: 1.5px;
    }
    .vault-form-group input,
    .vault-form-group select {
      background: rgba(10,8,3,0.7);
      border: 1px solid rgba(155,115,38,0.35);
      color: var(--eso-text, #e2cfa8);
      font-size: 12px;
      padding: 7px 8px;
      font-family: inherit;
      min-height: 36px;
      width: 100%;
      box-sizing: border-box;
    }
    .vault-form-group input:focus,
    .vault-form-group select:focus { outline: none; border-color: var(--eso-gold, #c9a84c); }
    .vault-form-group select option { background: #0d0a06; }

    /* Roll preview */
    .vault-roll-preview {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: rgba(123,156,212,0.08);
      border: 1px solid rgba(123,156,212,0.2);
      font-size: 12px;
      font-family: sans-serif;
    }
    .vault-roll-icon { font-size: 16px; }
    .vault-roll-max { color: var(--eso-gold, #c9a84c); font-weight: 700; }

    /* Buttons */
    .vault-btn {
      border: none;
      cursor: pointer;
      font-size: 11px;
      font-family: 'Cinzel', serif;
      padding: 8px 14px;
      letter-spacing: 1px;
      text-transform: uppercase;
      min-height: 38px;
      transition: opacity 0.15s, background 0.15s;
    }
    .vault-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .vault-btn-primary {
      background: var(--eso-gold, #c9a84c);
      color: #0d0a06;
      font-weight: 700;
      width: 100%;
    }
    .vault-btn-primary:hover:not(:disabled) { background: #f2c96a; }
    .vault-btn-secondary {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(155,115,38,0.4);
      color: #a08858;
      width: 100%;
    }
    .vault-btn-dice { color: #7b9cd4; border-color: rgba(123,156,212,0.3); }
    .vault-btn-dice:hover:not(:disabled) { background: rgba(123,156,212,0.1); }

    /* ── Ledger ── */
    .vault-ledger-list { list-style: none; margin: 0; padding: 0; }
    .vault-ledger-item {
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .vault-ledger-item:last-child { border-bottom: none; }
    .vault-ledger-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 6px;
      min-height: 52px;
    }
    .vault-ledger-icon { font-size: 16px; flex-shrink: 0; }
    .vault-ledger-info { flex: 1; min-width: 0; }
    .vault-ledger-milestone {
      display: block;
      font-size: 12px;
      color: var(--eso-text, #e2cfa8);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .vault-ledger-meta {
      display: block;
      font-size: 10px;
      color: #6a5030;
      font-family: sans-serif;
      margin-top: 2px;
    }
    .vault-ledger-bonus { color: var(--eso-gold, #c9a84c); font-weight: 700; }
    .vault-ledger-acm { color: #888; font-size: 10px; }
    /* ─── ACM score input row ─── */
    .vault-acm-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .vault-acm-input {
      width: 70px;
    }
    .vault-acm-multiplier {
      font-size: 13px;
      color: var(--eso-gold, #c9a84c);
      font-weight: 600;
    }
    .vault-acm-floor {
      color: #e05c44;
    }
    .vault-acm-hint {
      font-size: 10px;
      color: #888;
      margin-left: 4px;
    }
    .vault-ledger-amount {
      font-size: 13px;
      font-weight: 700;
      color: var(--eso-gold, #c9a84c);
      flex-shrink: 0;
      white-space: nowrap;
    }
    .vault-ledger-amount-bonus { color: #f2c96a; }
    .vault-ledger-delete {
      background: none;
      border: none;
      color: #333;
      cursor: pointer;
      font-size: 10px;
      padding: 0 4px;
      flex-shrink: 0;
      min-height: 36px;
    }
    .vault-ledger-delete:hover { color: #e05c44; }

    /* SoFi realization toggle */
    .vault-sofi-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 14px;
      padding: 0 4px;
      flex-shrink: 0;
      min-height: 36px;
      opacity: 0.5;
      transition: opacity 0.15s;
    }
    .vault-sofi-btn:hover:not(:disabled) { opacity: 1; }
    .vault-sofi-btn.vault-sofi-done { opacity: 1; }
    .vault-sofi-btn:disabled { cursor: wait; }

    .vault-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 24px;
      color: #555;
      font-size: 12px;
      font-family: sans-serif;
    }
    .vault-empty-icon { font-size: 28px; opacity: 0.3; }

    .vault-loading { text-align: center; color: #555; font-size: 12px; font-family: sans-serif; padding: 20px; }
  `]
})
export class VaultPanelComponent implements OnInit {

  private readonly http = inject(HttpClient);

  // ── State ──
  vault      = signal<VaultData | null>(null);
  isLoading  = signal(true);
  isSubmitting = signal(false);
  showForm   = signal(false);
  showTierRef = signal(false);
  rollResult  = signal<{ roll: number; sides: number; isMax: boolean } | null>(null);
  sofiLoading = signal<string | null>(null);  // entry id currently being toggled
  todayAcmScore = signal<number | null>(null); // pre-fetched weighted score (0-18)

  readonly TIER_META = TIER_META;

  // ── Computed ──
  gateProgress    = computed(() => this.vault()?.gateCriteria.filter(c => c.met).length ?? 0);
  gateProgressPct = computed(() => {
    const v = this.vault();
    if (!v) return 0;
    return Math.round((this.gateProgress() / v.gateCriteria.length) * 100);
  });

  acmPreviewMultiplier = computed(() => {
    const s = this.form.acmScore;
    if (s === null || s === undefined) return null;
    return acmMultiplierFromScore(s);
  });

  acmPreviewBase = computed(() => {
    const mult = this.acmPreviewMultiplier();
    if (mult === null) return null;
    const tierBase = this.form.tier === 'custom' ? this.form.customAmount : TIER_META[this.form.tier].base;
    return Math.round(tierBase * mult * 100) / 100;
  });

  // ── Form ──
  form = {
    milestone: '',
    tier: 'minimum' as RewardTier,
    customAmount: 10,
    date: new Date().toISOString().split('T')[0],
    acmScore: null as number | null,
  };

  tierHasDice(): boolean {
    return ['acm_perfect', 'perfect_week', 'level_up', 'sprint_story'].includes(this.form.tier);
  }

  // ── Lifecycle ──
  ngOnInit(): void {
    this.loadVault();
    this.loadTodayAcm();
  }

  private loadVault(): void {
    this.http.get<VaultResponse>(`${environment.apiUrl}/api/vault`)
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) this.vault.set(res.vault);
        this.isLoading.set(false);
      });
  }

  private loadTodayAcm(): void {
    this.http.get<{ success: boolean; itemStates: boolean[] }>(`${environment.apiUrl}/api/acm/today`)
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success && res.itemStates?.length === 12) {
          const score = computeAcmWeightedScore(res.itemStates);
          this.todayAcmScore.set(score);
          this.form.acmScore = score;  // pre-fill form
        }
      });
  }

  // ── Actions ──

  toggleGate(criterionId: string): void {
    this.http.patch<VaultResponse>(`${environment.apiUrl}/api/vault/gate/${criterionId}`, {})
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) this.vault.set(res.vault);
      });
  }

  previewRoll(): void {
    const sides = (this.form.tier === 'perfect_week' || this.form.tier === 'sprint_story') ? 12 : 6;
    this.http.post<{ success: boolean; roll: number; isMax: boolean }>(
      `${environment.apiUrl}/api/vault/roll`,
      { sides }
    ).pipe(catchError(() => of(null)))
     .subscribe(res => {
       if (res?.success) this.rollResult.set({ roll: res.roll, sides, isMax: res.isMax });
     });
  }

  submitEntry(): void {
    if (!this.form.milestone.trim() || this.isSubmitting()) return;
    this.isSubmitting.set(true);

    const payload: Record<string, unknown> = {
      milestone: this.form.milestone.trim(),
      tier: this.form.tier,
      date: this.form.date || undefined,
    };
    if (this.form.tier === 'custom') {
      payload['customBaseAmount'] = this.form.customAmount;
    }
    if (this.form.acmScore !== null && this.form.acmScore !== undefined) {
      payload['acmScore'] = this.form.acmScore;
    }

    this.http.post<VaultResponse>(`${environment.apiUrl}/api/vault/entries`, payload)
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) {
          this.vault.set(res.vault);
          this.form.milestone = '';
          this.form.tier = 'minimum';
          this.form.date = new Date().toISOString().split('T')[0];
          this.form.acmScore = this.todayAcmScore();  // reset to today's fetched score
          this.rollResult.set(null);
          this.showForm.set(false);
        }
        this.isSubmitting.set(false);
      });
  }

  toggleSoFi(id: string): void {
    this.sofiLoading.set(id);
    this.http.patch<VaultResponse>(`${environment.apiUrl}/api/vault/entries/${id}/sofi`, {})
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) this.vault.set(res.vault);
        this.sofiLoading.set(null);
      });
  }

  fmt(amount: number): string {
    return '$' + amount.toFixed(2);
  }

  deleteEntry(id: string): void {
    this.http.delete<VaultResponse>(`${environment.apiUrl}/api/vault/entries/${id}`)
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) this.vault.set(res.vault);
      });
  }
}
