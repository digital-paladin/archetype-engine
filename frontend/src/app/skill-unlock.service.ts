import { Injectable, signal } from '@angular/core';
import { DEFAULT_UNLOCKED } from './skill-tree.data';

/**
 * Manages which skills are unlocked.
 * Skills start LOCKED. They unlock when first practiced in a real session —
 * the same mechanic as Elder Scrolls Online: use it to unlock it.
 */
@Injectable({ providedIn: 'root' })
export class SkillUnlockService {
  private readonly STORAGE_KEY = 'dp-skill-unlocks';

  private readonly _unlocked = signal<Set<string>>(this.loadFromStorage());

  /** Returns true if the given skill ID is unlocked. */
  isUnlocked(skillId: string): boolean {
    return this._unlocked().has(skillId);
  }

  /** Unlock a skill (call when user first practices it). */
  unlock(skillId: string): void {
    const next = new Set(this._unlocked());
    next.add(skillId);
    this._unlocked.set(next);
    this.persist(next);
  }

  /** Unlock multiple skills at once. */
  unlockMany(skillIds: string[]): void {
    const next = new Set(this._unlocked());
    for (const id of skillIds) next.add(id);
    this._unlocked.set(next);
    this.persist(next);
  }

  /** Lock a skill (used for resets / corrections). */
  lock(skillId: string): void {
    const next = new Set(this._unlocked());
    next.delete(skillId);
    this._unlocked.set(next);
    this.persist(next);
  }

  /** Reset to defaults (keeps DEFAULT_UNLOCKED, locks everything else). */
  resetToDefaults(): void {
    const next = new Set<string>(DEFAULT_UNLOCKED);
    this._unlocked.set(next);
    this.persist(next);
  }

  /** Returns the full set (e.g. for debugging or serialisation). */
  getUnlockedIds(): Set<string> {
    return this._unlocked();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private loadFromStorage(): Set<string> {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        return new Set<string>(parsed);
      }
    } catch {
      // malformed data → fall through to defaults
    }
    return new Set<string>(DEFAULT_UNLOCKED);
  }

  private persist(ids: Set<string>): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify([...ids]));
    } catch {
      // storage quota exceeded — ignore
    }
  }
}
