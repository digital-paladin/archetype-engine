import { Injectable, signal, computed } from '@angular/core';
import { Subject } from 'rxjs';

const STORAGE_KEY = 'dp-willpower';
const RESET_DATE_KEY = 'dp-willpower-reset-date';

@Injectable({ providedIn: 'root' })
export class WillpowerService {
  private _willpower = signal<number>(this.loadFromStorage());

  /** Emits once when WP hits 0 after a depletion (for toast notification). */
  readonly depleted$ = new Subject<void>();

  readonly willpower = this._willpower.asReadonly();

  readonly status = computed(() => {
    const w = this._willpower();
    if (w >= 80) return 'Iron Will';
    if (w >= 60) return 'Focused';
    if (w >= 40) return 'Strained';
    if (w >= 20) return 'Wavering';
    return 'Depleted';
  });

  readonly statusClass = computed(() => {
    const w = this._willpower();
    if (w >= 80) return 'willpower-ironwill';
    if (w >= 60) return 'willpower-focused';
    if (w >= 40) return 'willpower-strained';
    if (w >= 20) return 'willpower-wavering';
    return 'willpower-depleted';
  });

  readonly barClass = computed(() => {
    const w = this._willpower();
    if (w >= 60) return 'eso-bar-willpower-high';
    if (w >= 40) return 'eso-bar-willpower-med';
    if (w >= 20) return 'eso-bar-willpower-low';
    return 'eso-bar-willpower-depleted';
  });

  deplete(amount: number): void {
    const prev = this._willpower();
    const next = Math.max(0, prev - amount);
    this._willpower.set(next);
    this.save(next);
    if (prev > 0 && next === 0) this.depleted$.next();
  }

  regenerate(amount: number): void {
    const next = Math.min(100, this._willpower() + amount);
    this._willpower.set(next);
    this.save(next);
  }

  reset(): void {
    this._willpower.set(100);
    this.save(100);
  }

  /** Reset to 100 once per calendar day when sleep data is successfully logged. */
  resetForNewSleep(): void {
    const today = new Date().toLocaleDateString('en-CA'); // "YYYY-MM-DD" in local time
    try {
      const lastReset = localStorage.getItem(RESET_DATE_KEY) ?? '';
      if (lastReset !== today) {
        this._willpower.set(100);
        this.save(100);
        localStorage.setItem(RESET_DATE_KEY, today);
      }
    } catch {}
  }

  private loadFromStorage(): number {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const val = Number(raw);
        if (!isNaN(val)) return Math.min(100, Math.max(0, val));
      }
    } catch {}
    return 100;
  }

  private save(value: number): void {
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch {}
  }
}
