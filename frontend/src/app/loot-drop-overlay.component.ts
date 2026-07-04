import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LootDropService, LootRarity } from './loot-drop.service';

const RARITY_LABELS: Record<LootRarity, string> = {
  common:    '◆ COMMON',
  uncommon:  '◆◆ UNCOMMON',
  rare:      '◆◆◆ RARE',
  legendary: '★ LEGENDARY',
};

@Component({
  selector: 'app-loot-drop-overlay',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (loot.activeDrop(); as drop) {
      <div class="loot-backdrop" (click)="loot.dismiss()">
        <div class="loot-card" [ngClass]="'rarity-' + drop.reward.rarity" (click)="$event.stopPropagation()">

          <div class="sparks-container">
            <span *ngFor="let s of sparks" class="spark"
              [style.left.%]="s.x" [style.top.%]="s.y"
              [style.width.px]="s.size" [style.height.px]="s.size"
              [style.animation-delay.s]="s.delay">
            </span>
          </div>

          <div class="loot-header">
            <span class="drop-label">⚡ ITEM DROP!</span>
            <span class="rarity-badge" [ngClass]="'rarity-' + drop.reward.rarity">
              {{ rarityLabel(drop.reward.rarity) }}
            </span>
          </div>

          <div class="icon-wrap">
            <div class="icon-glow" [ngClass]="'rarity-' + drop.reward.rarity"></div>
            <span class="item-emoji">{{ drop.reward.icon }}</span>
          </div>

          <h2 class="item-name" [ngClass]="'rarity-' + drop.reward.rarity">{{ drop.reward.name }}</h2>
          <p class="item-desc">{{ drop.reward.description }}</p>
          <p class="item-source">Dropped from: <em>{{ drop.activityType }}</em></p>

          <!-- Trigger reason badge — shown when a mechanic forced this drop -->
          <div class="trigger-badge" *ngIf="drop.isComboGuarantee || drop.isPity">
            <span *ngIf="drop.isComboGuarantee">🔥 Combo Streak Bonus</span>
            <span *ngIf="drop.isPity && !drop.isComboGuarantee">🛡️ Pity Protection Active</span>
          </div>

          <button class="claim-btn" [ngClass]="'rarity-' + drop.reward.rarity" (click)="loot.dismiss()">
            CLAIM REWARD
          </button>
          <p class="dismiss-hint">click outside to dismiss</p>

        </div>
      </div>
    }
  `,
  styles: [`
    /* ── Backdrop ── */
    .loot-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2000;
      background: rgba(0, 0, 0, 0.82);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: backdrop-in 0.25s ease;
    }
    @keyframes backdrop-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* ── Card ── */
    .loot-card {
      position: relative;
      width: 360px;
      padding: 36px 32px 28px;
      background: linear-gradient(160deg, #1c1408 0%, #0d0a05 100%);
      border: 1px solid transparent;
      text-align: center;
      overflow: hidden;
      animation: card-in 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    @keyframes card-in {
      from { opacity: 0; transform: scale(0.7); }
      to   { opacity: 1; transform: scale(1); }
    }

    .rarity-common    { border-color: rgba(190,190,190,0.55); box-shadow: 0 0 28px rgba(190,190,190,0.12); }
    .rarity-uncommon  { border-color: rgba(76,175,110,0.65);  box-shadow: 0 0 36px rgba(76,175,110,0.18); }
    .rarity-rare      { border-color: rgba(74,159,212,0.70);  box-shadow: 0 0 44px rgba(74,159,212,0.24); }
    .rarity-legendary {
      border-color: rgba(245,200,66,0.85);
      box-shadow: 0 0 60px rgba(245,200,66,0.35), 0 0 120px rgba(245,200,66,0.12);
      animation: card-in 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275), legendary-pulse 2.4s ease-in-out infinite 0.5s;
    }
    @keyframes legendary-pulse {
      0%, 100% { box-shadow: 0 0 60px rgba(245,200,66,0.35), 0 0 120px rgba(245,200,66,0.12); }
      50%       { box-shadow: 0 0 90px rgba(245,200,66,0.55), 0 0 160px rgba(245,200,66,0.22); }
    }

    /* ── Sparks ── */
    .sparks-container {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
    }
    .spark {
      position: absolute;
      border-radius: 50%;
      animation: spark-float 2.2s ease-in-out infinite;
    }
    .rarity-common    .spark { background: rgba(200,200,200,0.45); }
    .rarity-uncommon  .spark { background: rgba(76,175,110,0.55); }
    .rarity-rare      .spark { background: rgba(74,159,212,0.55); }
    .rarity-legendary .spark { background: rgba(245,200,66,0.65); }
    @keyframes spark-float {
      0%   { opacity: 0; transform: translateY(0) scale(0.4); }
      30%  { opacity: 1; }
      70%  { opacity: 0.8; }
      100% { opacity: 0; transform: translateY(-40px) scale(1.2); }
    }

    /* ── Header ── */
    .loot-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    .drop-label {
      font-family: 'Cinzel', serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 2px;
      color: #f2c96a;
      text-shadow: 0 0 12px rgba(242,201,106,0.6);
    }
    .rarity-badge {
      font-family: 'Cinzel', serif;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 1.5px;
      padding: 3px 8px;
      border: 1px solid currentColor;
    }
    .rarity-badge.rarity-common    { color: #b4b4b4; border-color: rgba(180,180,180,0.4); }
    .rarity-badge.rarity-uncommon  { color: #4caf6e; border-color: rgba(76,175,110,0.4); }
    .rarity-badge.rarity-rare      { color: #4a9fd4; border-color: rgba(74,159,212,0.4); }
    .rarity-badge.rarity-legendary { color: #f5c842; border-color: rgba(245,200,66,0.6); text-shadow: 0 0 10px rgba(245,200,66,0.5); }

    /* ── Icon ── */
    .icon-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100px;
      height: 100px;
      margin-bottom: 20px;
    }
    .icon-glow {
      position: absolute;
      inset: 0;
      border-radius: 50%;
    }
    .icon-glow.rarity-common    { background: radial-gradient(circle, rgba(180,180,180,0.18) 0%, transparent 70%); }
    .icon-glow.rarity-uncommon  { background: radial-gradient(circle, rgba(76,175,110,0.22) 0%, transparent 70%); }
    .icon-glow.rarity-rare      { background: radial-gradient(circle, rgba(74,159,212,0.26) 0%, transparent 70%); }
    .icon-glow.rarity-legendary { background: radial-gradient(circle, rgba(245,200,66,0.35) 0%, transparent 70%); animation: glow-pulse 2s ease-in-out infinite; }
    @keyframes glow-pulse {
      0%, 100% { opacity: 0.8; transform: scale(1); }
      50%       { opacity: 1;   transform: scale(1.15); }
    }
    .item-emoji { font-size: 52px; position: relative; z-index: 1; }

    /* ── Text ── */
    .item-name {
      font-family: 'Cinzel', serif;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 1px;
      margin: 0 0 10px;
    }
    .item-name.rarity-common    { color: #d8d8d8; }
    .item-name.rarity-uncommon  { color: #4caf6e; text-shadow: 0 0 14px rgba(76,175,110,0.35); }
    .item-name.rarity-rare      { color: #4a9fd4; text-shadow: 0 0 14px rgba(74,159,212,0.40); }
    .item-name.rarity-legendary { color: #f5c842; text-shadow: 0 0 18px rgba(245,200,66,0.60); }

    .item-desc {
      font-size: 13px;
      color: #c0aa80;
      line-height: 1.5;
      margin: 0 0 10px;
    }
    .item-source {
      font-size: 11px;
      color: #6a5a38;
      margin: 0 0 24px;
    }
    .item-source em { color: #8a7a58; font-style: normal; }

    /* ── Button ── */
    .claim-btn {
      width: 100%;
      padding: 12px;
      border: 1px solid transparent;
      font-family: 'Cinzel', serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 2px;
      cursor: pointer;
      text-transform: uppercase;
      transition: all 0.2s;
      margin-bottom: 12px;
      background: rgba(0,0,0,0.5);
    }
    .claim-btn.rarity-common    { color: #d8d8d8; border-color: rgba(190,190,190,0.5); }
    .claim-btn.rarity-uncommon  { color: #4caf6e; border-color: rgba(76,175,110,0.6); }
    .claim-btn.rarity-rare      { color: #4a9fd4; border-color: rgba(74,159,212,0.6); }
    .claim-btn.rarity-legendary { color: #f5c842; border-color: rgba(245,200,66,0.7); text-shadow: 0 0 8px rgba(245,200,66,0.4); }
    .claim-btn:hover { background: rgba(255,255,255,0.05); transform: translateY(-1px); }

    .dismiss-hint {
      font-size: 10px;
      color: #4a3a20;
      margin: 0;
      letter-spacing: 0.5px;
    }

    .trigger-badge {
      display: inline-block;
      padding: 4px 12px;
      margin-bottom: 16px;
      font-family: 'Cinzel', serif;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1px;
      border: 1px solid rgba(245, 200, 66, 0.35);
      color: #c8a035;
      background: rgba(245, 200, 66, 0.06);
    }
  `]
})
export class LootDropOverlayComponent {
  readonly loot = inject(LootDropService);

  readonly sparks = Array.from({ length: 14 }, () => ({
    x:     Math.random() * 100,
    y:     Math.random() * 100,
    delay: Math.random() * 1.8,
    size:  2 + Math.random() * 5,
  }));

  rarityLabel(rarity: LootRarity): string {
    return RARITY_LABELS[rarity];
  }
}
