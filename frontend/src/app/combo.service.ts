import { Injectable, signal, computed } from '@angular/core';

const LS_COUNT = 'dp-combo-count';
const LS_DATE  = 'dp-combo-last-date';

function toLocalDateStr(d: Date): string {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Injectable({ providedIn: 'root' })
export class ComboService {

  /** Current consecutive-day activity streak. */
  readonly comboCount  = signal<number>(this.loadCount());

  /** Fires true for ~3 s after a streak break — drives the COMBO BROKEN toast. */
  readonly comboBroken = signal<boolean>(false);

  /**
   * XP multiplier stacked on top of any rested/other bonuses:
   *
   *  1–2 day streak  → ×1.00  (no bonus yet — building momentum)
   *  3–4 day streak  → ×1.10  (+10%)
   *  5–6 day streak  → ×1.20  (+20%)
   *  7+  day streak  → ×1.30  (+30%)  ← also triggers loot guarantee
   */
  readonly comboMultiplier = computed<number>(() => {
    const n = this.comboCount();
    if (n >= 7) return 1.30;
    if (n >= 5) return 1.20;
    if (n >= 3) return 1.10;
    return 1.0;
  });

  /** Human-readable bonus label, e.g. "+10% Combo XP". Empty string when no bonus active. */
  readonly comboBonus = computed<string>(() => {
    const m = this.comboMultiplier();
    return m > 1 ? `+${Math.round((m - 1) * 100)}% Combo XP` : '';
  });

  /** At a 7-day+ streak the next loot roll is guaranteed to drop something. */
  readonly guaranteeLoot = computed<boolean>(() => this.comboCount() >= 7);

  /**
   * Record that the player logged an activity today.
   * Must be called AFTER successful backend save.
   * Returns the new streak count.
   */
  recordActivity(): number {
    const today    = toLocalDateStr(new Date());
    const lastDate = localStorage.getItem(LS_DATE) ?? '';

    if (lastDate === today) {
      // Already logged today — streak unchanged
      return this.comboCount();
    }

    const yesterday = toLocalDateStr(new Date(Date.now() - 86_400_000));

    if (lastDate === yesterday) {
      // Consecutive day — extend streak
      const next = this.comboCount() + 1;
      this.comboCount.set(next);
      localStorage.setItem(LS_COUNT, String(next));
    } else if (lastDate && this.comboCount() > 1) {
      // Gap in logging — streak broken
      this.flashBroken();
      this.comboCount.set(1);
      localStorage.setItem(LS_COUNT, '1');
    } else {
      // First ever log
      this.comboCount.set(1);
      localStorage.setItem(LS_COUNT, '1');
    }

    localStorage.setItem(LS_DATE, today);
    return this.comboCount();
  }

  private flashBroken(): void {
    this.comboBroken.set(true);
    setTimeout(() => this.comboBroken.set(false), 3000);
  }

  private loadCount(): number {
    return parseInt(localStorage.getItem(LS_COUNT) ?? '0', 10) || 0;
  }
}
