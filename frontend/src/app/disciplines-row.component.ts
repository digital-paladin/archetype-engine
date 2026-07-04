import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WillpowerService } from './willpower.service';

interface Discipline {
  id: string;
  icon: string;
  label: string;
  shortLabel: string;
  wpRegen: number;
  storageKey: string;
}

const DISCIPLINES: Discipline[] = [
  { id: 'alcohol',  icon: '🚫🍺', label: 'No Alcohol',    shortLabel: 'Sober',   wpRegen: 10, storageKey: 'dp-disc-alcohol' },
  { id: 'sobriety', icon: '🛡',   label: 'Sexual Purity',  shortLabel: 'Pure',    wpRegen: 10, storageKey: 'dp-disc-sobriety' },
  { id: 'fast',     icon: '⚡',   label: 'Fasting',        shortLabel: 'Fasted',  wpRegen: 8,  storageKey: 'dp-disc-fast' },
  { id: 'diet',     icon: '🥗',   label: 'Clean Diet',     shortLabel: 'Diet',    wpRegen: 5,  storageKey: 'dp-disc-diet' },
];

const RESET_DATE_KEY = 'dp-disc-reset-date';

@Component({
  selector: 'app-disciplines-row',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="disc-row">
      <div class="disc-label">Disciplines</div>

      <div class="disc-slots">
        <button
          *ngFor="let d of disciplines"
          class="disc-slot"
          [class.disc-confirmed]="confirmed[d.id]"
          [class.disc-pending]="!confirmed[d.id]"
          (click)="onConfirm(d)"
          [title]="d.label + (confirmed[d.id] ? ' ✓ +' + d.wpRegen + ' WP claimed' : ' — tap to confirm (+' + d.wpRegen + ' WP)')">

          <span class="disc-icon">{{ d.icon }}</span>
          <span class="disc-name">{{ d.shortLabel }}</span>

          <!-- WP regen badge (shown only when not yet confirmed) -->
          <span class="disc-regen" *ngIf="!confirmed[d.id]">+{{ d.wpRegen }}</span>

          <!-- Checkmark (shown when confirmed) -->
          <span class="disc-check" *ngIf="confirmed[d.id]">✓</span>
        </button>
      </div>

      <!-- Total potential WP from disciplines -->
      <div class="disc-total-wp">
        <span class="disc-total-val">{{ totalEarned }}</span>
        <span class="disc-total-label">WP earned</span>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .disc-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 0 6px;
      border-top: 1px solid rgba(201, 168, 76, 0.12);
      margin-top: 4px;
    }

    .disc-label {
      font-family: 'Cinzel', serif;
      font-size: 7px;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: rgba(160, 136, 88, 0.55);
      writing-mode: initial;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .disc-slots {
      display: flex;
      gap: 6px;
      flex: 1;
      justify-content: center;
    }

    /* ── Individual Discipline Slot ── */
    .disc-slot {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 54px;
      height: 44px;
      padding: 0 4px 4px;
      background: linear-gradient(180deg, #0b0903 0%, #161208 100%);
      border: 1px solid rgba(80, 58, 16, 0.50);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.10s;
      gap: 2px;
      user-select: none;

      &:hover:not(.disc-confirmed) {
        background: linear-gradient(180deg, #161208 0%, #1e1a0a 100%);
        border-color: rgba(201, 168, 76, 0.45);
        box-shadow: 0 0 10px rgba(201, 168, 76, 0.15);
        transform: translateY(-1px);
      }

      /* Confirmed state — green glow */
      &.disc-confirmed {
        background: linear-gradient(180deg, #0c1a0c 0%, #152015 100%);
        border-color: rgba(111, 207, 151, 0.60);
        box-shadow:
          0 0 0 1px rgba(111, 207, 151, 0.20),
          0 0 10px rgba(111, 207, 151, 0.25);
        cursor: default;
      }
    }

    .disc-icon {
      font-size: 14px;
      line-height: 1.1;
    }

    .disc-name {
      font-size: 7px;
      font-family: 'Cinzel', serif;
      letter-spacing: 0.3px;
      color: rgba(160, 136, 88, 0.70);
      text-align: center;
      line-height: 1;

      .disc-confirmed & {
        color: rgba(111, 207, 151, 0.85);
      }
    }

    /* WP regen badge (top-right, pending) */
    .disc-regen {
      position: absolute;
      top: 2px;
      right: 3px;
      font-size: 7px;
      font-weight: 700;
      color: rgba(111, 207, 151, 0.70);
      line-height: 1;
    }

    /* Checkmark (top-right, confirmed) */
    .disc-check {
      position: absolute;
      top: 2px;
      right: 3px;
      font-size: 8px;
      color: rgba(111, 207, 151, 0.90);
      font-weight: 700;
    }

    /* ── Total WP counter (right anchor) ── */
    .disc-total-wp {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
      min-width: 36px;
    }
    .disc-total-val {
      font-size: 1rem;
      font-weight: 700;
      color: rgba(111, 207, 151, 0.85);
      line-height: 1;
    }
    .disc-total-label {
      font-size: 6px;
      font-family: 'Cinzel', serif;
      letter-spacing: 0.5px;
      color: rgba(160, 136, 88, 0.55);
      text-align: center;
    }
  `]
})
export class DisciplinesRowComponent implements OnInit {
  protected readonly disciplines = DISCIPLINES;
  protected confirmed: Record<string, boolean> = {};
  protected totalEarned = 0;

  private readonly wp = inject(WillpowerService);

  ngOnInit(): void {
    this.resetIfNewDay();
    this.loadState();
  }

  protected onConfirm(d: Discipline): void {
    if (this.confirmed[d.id]) return; // already claimed
    this.confirmed[d.id] = true;
    this.totalEarned += d.wpRegen;
    this.wp.regenerate(d.wpRegen);
    this.saveState();
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private resetIfNewDay(): void {
    try {
      const today = new Date().toDateString();
      const last = localStorage.getItem(RESET_DATE_KEY);
      if (last !== today) {
        DISCIPLINES.forEach(d => localStorage.removeItem(d.storageKey));
        localStorage.setItem(RESET_DATE_KEY, today);
      }
    } catch {}
  }

  private loadState(): void {
    let earned = 0;
    DISCIPLINES.forEach(d => {
      try {
        const val = localStorage.getItem(d.storageKey);
        if (val === 'confirmed') {
          this.confirmed[d.id] = true;
          earned += d.wpRegen;
        }
      } catch {}
    });
    this.totalEarned = earned;
  }

  private saveState(): void {
    DISCIPLINES.forEach(d => {
      try {
        if (this.confirmed[d.id]) localStorage.setItem(d.storageKey, 'confirmed');
      } catch {}
    });
  }
}
