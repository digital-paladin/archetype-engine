import { Injectable, inject, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { take } from 'rxjs/operators';
import { Skill, SkillCategory, ExerciseSet } from './skill-tree.data';
import { environment } from '../environments/environment';

interface SessionState {
  startTime: Date;
  counts: Map<string, number>;          // skillId → activation count (technique presses)
  exerciseSets: Map<string, ExerciseSet[]>; // skillId → logged sets (strength/swim)
  skillRef: Map<string, Skill>;         // skillId → Skill (for name display)
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface CategoryConfig {
  activityKey: string;    // matches XpCalculatorService keys
  journalCategory: string;
}

/** How long a category session stays open after the last press (ms). */
const IDLE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Maps each SkillCategory to the activity key and journal category
 * used when writing the session summary to the journal.
 * `null` = utility skills (Hydrate, Log Day) that don't write to the quest log.
 */
const CATEGORY_CONFIG: Partial<Record<SkillCategory, CategoryConfig | null>> = {
  mma:      { activityKey: 'mma-training',      journalCategory: 'workout'  },
  strength: { activityKey: 'strength-training',  journalCategory: 'workout'  },
  swimming: { activityKey: 'swim-training',      journalCategory: 'workout'  },
  coding:   { activityKey: 'coding-moderate',    journalCategory: 'coding'   },
  redteam:  { activityKey: 'htb-medium',         journalCategory: 'redteam'  },
  guitar:   { activityKey: 'guitar-practice',    journalCategory: 'artist'   },
  sage:     { activityKey: 'prayer-routine',     journalCategory: 'prayer'   },
  utility:  null, // Hydrate, Deep Focus, Log Day — no journal entry
};

/**
 * Tracks hotbar skill presses within rolling per-category sessions.
 *
 * Session lifecycle:
 *   - Starts on the first skill activation for a category.
 *   - Idle timer (30 min) resets on every subsequent press.
 *   - When the timer fires (or commitAll() is called), a one-line summary
 *     is written to the journal via POST /api/activity.
 *
 * Example journal entry produced:
 *   "Jab ×8, Cross ×5, Hook ×3  [6:45 AM–7:12 AM]"  (MMA session)
 *   "Bench Press: 3× @ 135lbs, 3× @ 145lbs  [7:30 AM–8:00 AM]"  (Strength)
 */
@Injectable({ providedIn: 'root' })
export class HotbarSessionService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly sessions = new Map<SkillCategory, SessionState>();

  /**
   * Call when a non-exercise skill slot is activated (pressed to start).
   * Each activation = +1 count for that skill in the category session.
   * Does nothing for utility skills.
   */
  recordActivation(skill: Skill): void {
    const config = CATEGORY_CONFIG[skill.category];
    if (config === null || config === undefined) return;

    const session = this.getOrCreateSession(skill.category);
    session.counts.set(skill.id, (session.counts.get(skill.id) ?? 0) + 1);
    session.skillRef.set(skill.id, skill);
    this.resetIdleTimer(skill.category, session);
  }

  /**
   * Call when an exercise skill logs sets via the modal.
   * Accumulates sets across multiple log events in the same session.
   */
  recordExercise(skill: Skill, sets: ExerciseSet[]): void {
    const config = CATEGORY_CONFIG[skill.category];
    if (config === null || config === undefined) return;

    const session = this.getOrCreateSession(skill.category);
    const existing = session.exerciseSets.get(skill.id) ?? [];
    session.exerciseSets.set(skill.id, [...existing, ...sets]);
    session.skillRef.set(skill.id, skill);
    this.resetIdleTimer(skill.category, session);
  }

  /** Immediately commits all open sessions (e.g., user clicks "Commit" button). */
  commitAll(): void {
    for (const category of Array.from(this.sessions.keys())) {
      this.commitSession(category);
    }
  }

  /** Returns how many times a specific skill has been activated in the current session. */
  getCount(skillId: string, category: SkillCategory): number {
    return this.sessions.get(category)?.counts.get(skillId) ?? 0;
  }

  /** True if there is an open (uncommitted) session for this category. */
  hasActiveSession(category: SkillCategory): boolean {
    return this.sessions.has(category);
  }

  ngOnDestroy(): void {
    // Commit any open sessions when the service is torn down
    this.commitAll();
    for (const session of this.sessions.values()) {
      if (session.idleTimer) clearTimeout(session.idleTimer);
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private getOrCreateSession(category: SkillCategory): SessionState {
    let session = this.sessions.get(category);
    if (!session) {
      session = {
        startTime: new Date(),
        counts: new Map(),
        exerciseSets: new Map(),
        skillRef: new Map(),
        idleTimer: null,
      };
      this.sessions.set(category, session);
    }
    return session;
  }

  private resetIdleTimer(category: SkillCategory, session: SessionState): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => this.commitSession(category), IDLE_MS);
  }

  private commitSession(category: SkillCategory): void {
    const session = this.sessions.get(category);
    if (!session) return;

    const config = CATEGORY_CONFIG[category];
    if (!config) return;

    const parts: string[] = [];

    // Technique presses (e.g., Jab ×8, Cross ×5)
    session.counts.forEach((count, skillId) => {
      const skill = session.skillRef.get(skillId);
      if (skill) parts.push(`${skill.name} ×${count}`);
    });

    // Exercise sets (e.g., Bench Press: 3× @ 135lbs)
    session.exerciseSets.forEach((sets, skillId) => {
      const skill = session.skillRef.get(skillId);
      if (!skill) return;
      const setStr = sets
        .map(s => s.weight ? `${s.reps}× @ ${s.weight}lbs` : `${s.reps}×`)
        .join(', ');
      parts.push(`${skill.name}: ${setStr}`);
    });

    if (parts.length === 0) {
      this.sessions.delete(category);
      return;
    }

    const endTime = new Date();
    const fmt = (d: Date): string =>
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const timeRange  = `${fmt(session.startTime)}–${fmt(endTime)}`;
    const notes      = `${parts.join(', ')}  [${timeRange}]`;
    const durationMs = endTime.getTime() - session.startTime.getTime();
    const duration   = Math.max(1, Math.round(durationMs / 60_000)); // minutes, min 1
    const today      = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

    this.http.post(`${environment.apiUrl}/api/activity`, {
      activityType: config.activityKey,
      duration,
      notes,
      clientDate: today,
    }).pipe(take(1)).subscribe({
      next: () => console.log(`[HOTBAR SESSION] ✅ ${category}: ${notes}`),
      error: (err: unknown) => console.error('[HOTBAR SESSION] Commit failed:', err),
    });

    // Clear before the HTTP response to prevent double-commit on rapid re-trigger
    if (session.idleTimer) clearTimeout(session.idleTimer);
    this.sessions.delete(category);
  }
}
