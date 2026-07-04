// body-status.service.spec.ts
// Unit tests for BodyStatusService — CRUD, auto-heal logic, XP penalty,
// recovery calculations, getSummary, and localStorage persistence.

import { BodyStatusService } from './body-status.service';
import { BodyStatus } from './body-status.interface';

const STORAGE_KEY = 'body-status';

// ── Factory helpers ───────────────────────────────────────────────────────────

function makeSvc(): BodyStatusService {
  localStorage.clear();
  return new BodyStatusService();
}

/** Add a status and return the service for chaining. */
function addMinorInjury(svc: BodyStatusService, overrides: Partial<{
  estimatedRecoveryDays: number;
  impactsActions: string[];
  xpPenalty: number;
}> = {}) {
  svc.addStatus(
    'left-knee',
    'injury',
    'minor',
    'Test Injury',
    'A test injury to the left knee',
    overrides.estimatedRecoveryDays,
    undefined,
    overrides.impactsActions,
    overrides.xpPenalty,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — addStatus()', () => {
  let svc: BodyStatusService;

  beforeEach(() => { svc = makeSvc(); });

  it('adds a new status to the list', () => {
    addMinorInjury(svc);
    expect(svc.getActiveStatuses()).toHaveLength(1);
  });

  it('generates a unique id for each status', () => {
    addMinorInjury(svc);
    addMinorInjury(svc);
    const ids = svc.getActiveStatuses().map(s => s.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('stores the bodyPart, type, severity, name, description', () => {
    addMinorInjury(svc);
    const s = svc.getActiveStatuses()[0];
    expect(s.bodyPart).toBe('left-knee');
    expect(s.type).toBe('injury');
    expect(s.severity).toBe('minor');
    expect(s.name).toBe('Test Injury');
    expect(s.description).toBe('A test injury to the left knee');
  });

  it('prepends the new status (most recent first)', () => {
    addMinorInjury(svc);
    svc.addStatus('head', 'illness', 'moderate', 'Cold', 'Common cold');
    const statuses = svc.getActiveStatuses();
    expect(statuses[0].bodyPart).toBe('head');
    expect(statuses[1].bodyPart).toBe('left-knee');
  });

  it('persists to localStorage', () => {
    addMinorInjury(svc);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — removeStatus()', () => {
  let svc: BodyStatusService;

  beforeEach(() => { svc = makeSvc(); });

  it('removes the status with the given id', () => {
    addMinorInjury(svc);
    const id = svc.getActiveStatuses()[0].id;
    svc.removeStatus(id);
    expect(svc.getActiveStatuses()).toHaveLength(0);
  });

  it('does not error when id does not exist', () => {
    expect(() => svc.removeStatus('nonexistent-id')).not.toThrow();
  });

  it('persists the removal to localStorage', () => {
    addMinorInjury(svc);
    const id = svc.getActiveStatuses()[0].id;
    svc.removeStatus(id);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — markHealed()', () => {
  let svc: BodyStatusService;

  beforeEach(() => { svc = makeSvc(); });

  it('removes the status (delegates to removeStatus)', () => {
    addMinorInjury(svc);
    const id = svc.getActiveStatuses()[0].id;
    svc.markHealed(id);
    expect(svc.getActiveStatuses()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — updateStatus()', () => {
  let svc: BodyStatusService;

  beforeEach(() => { svc = makeSvc(); });

  it('updates the specified fields by id', () => {
    addMinorInjury(svc);
    const id = svc.getActiveStatuses()[0].id;
    svc.updateStatus(id, { severity: 'severe', name: 'Updated' });
    const updated = svc.getActiveStatuses().find(s => s.id === id)!;
    expect(updated.severity).toBe('severe');
    expect(updated.name).toBe('Updated');
  });

  it('does not affect other statuses', () => {
    addMinorInjury(svc);                                                        // ids[1] after prepend — 'Test Injury'
    svc.addStatus('head', 'illness', 'minor', 'Headache', 'mild headache');     // ids[0] most-recent prepend
    const ids = svc.getActiveStatuses().map(s => s.id);
    svc.updateStatus(ids[0], { name: 'Changed' });
    // ids[1] is the original left-knee injury — name must be unchanged
    expect(svc.getActiveStatuses().find(s => s.id === ids[1])!.name).toBe('Test Injury');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — auto-heal / getActiveStatuses()', () => {
  let svc: BodyStatusService;

  beforeEach(() => { svc = makeSvc(); });

  it('includes statuses with no estimatedRecoveryDays (never auto-heals)', () => {
    addMinorInjury(svc, { estimatedRecoveryDays: undefined });
    expect(svc.getActiveStatuses()).toHaveLength(1);
  });

  it('includes statuses whose recovery window has not elapsed', () => {
    addMinorInjury(svc, { estimatedRecoveryDays: 30 });
    expect(svc.getActiveStatuses()).toHaveLength(1);
  });

  it('excludes statuses whose recovery window has elapsed (startDate in the past)', () => {
    // Inject a status with a startDate far in the past
    const healedStatus: BodyStatus = {
      id: 'healed-1',
      bodyPart: 'right-knee',
      type:     'injury',
      severity: 'minor',
      name:     'Old Injury',
      description: 'Already healed',
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      estimatedRecoveryDays: 5, // only 5 days needed → healed
      color: '#ff9999',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([healedStatus]));
    const svc2 = new BodyStatusService();
    expect(svc2.getActiveStatuses()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — getStatusesByBodyPart()', () => {
  let svc: BodyStatusService;

  beforeEach(() => { svc = makeSvc(); });

  it('returns only statuses for the requested bodyPart', () => {
    addMinorInjury(svc); // left-knee
    svc.addStatus('head', 'illness', 'minor', 'Headache', 'mild');
    const kneeStatuses = svc.getStatusesByBodyPart('left-knee');
    expect(kneeStatuses).toHaveLength(1);
    expect(kneeStatuses[0].bodyPart).toBe('left-knee');
  });

  it('returns empty array when bodyPart has no statuses', () => {
    addMinorInjury(svc);
    expect(svc.getStatusesByBodyPart('right-shoulder')).toHaveLength(0);
  });

  it('excludes auto-healed statuses from the result', () => {
    const healed: BodyStatus = {
      id: 'h1', bodyPart: 'left-knee', type: 'injury', severity: 'minor',
      name: 'Old', description: 'Old', color: '#ff9999',
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      estimatedRecoveryDays: 2,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([healed]));
    const svc2 = new BodyStatusService();
    expect(svc2.getStatusesByBodyPart('left-knee')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — getDaysSince()', () => {
  let svc: BodyStatusService;

  beforeEach(() => { svc = makeSvc(); });

  it('returns 0 for a date that is today', () => {
    expect(svc.getDaysSince(new Date())).toBe(0);
  });

  it('returns 1 for a date that was yesterday', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(svc.getDaysSince(yesterday)).toBe(1);
  });

  it('returns ~7 for a date 7 days ago', () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    expect(svc.getDaysSince(weekAgo)).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — getRemainingDays()', () => {
  let svc: BodyStatusService;

  beforeEach(() => { svc = makeSvc(); });

  it('returns 0 when estimatedRecoveryDays is not set', () => {
    const status: BodyStatus = {
      id: 'r1', bodyPart: 'head', type: 'injury', severity: 'minor',
      name: 'x', description: 'x', startDate: new Date(), color: '#ff9999',
    };
    expect(svc.getRemainingDays(status)).toBe(0);
  });

  it('returns remaining days for a fresh status', () => {
    const status: BodyStatus = {
      id: 'r2', bodyPart: 'head', type: 'injury', severity: 'minor',
      name: 'x', description: 'x', startDate: new Date(),
      estimatedRecoveryDays: 14, color: '#ff9999',
    };
    const remaining = svc.getRemainingDays(status);
    expect(remaining).toBeGreaterThanOrEqual(13);
    expect(remaining).toBeLessThanOrEqual(14);
  });

  it('clamps to 0 when recovery period has passed', () => {
    const status: BodyStatus = {
      id: 'r3', bodyPart: 'head', type: 'injury', severity: 'minor',
      name: 'x', description: 'x',
      startDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      estimatedRecoveryDays: 10, color: '#ff9999',
    };
    expect(svc.getRemainingDays(status)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — getRecoveryPercentage()', () => {
  let svc: BodyStatusService;

  beforeEach(() => { svc = makeSvc(); });

  it('returns 0 when estimatedRecoveryDays not set', () => {
    const status: BodyStatus = {
      id: 'p1', bodyPart: 'head', type: 'injury', severity: 'minor',
      name: 'x', description: 'x', startDate: new Date(), color: '#ff9999',
    };
    expect(svc.getRecoveryPercentage(status)).toBe(0);
  });

  it('returns ~50 after half the recovery period', () => {
    const status: BodyStatus = {
      id: 'p2', bodyPart: 'head', type: 'injury', severity: 'minor',
      name: 'x', description: 'x',
      startDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      estimatedRecoveryDays: 10, color: '#ff9999',
    };
    const pct = svc.getRecoveryPercentage(status);
    expect(pct).toBeGreaterThanOrEqual(49);
    expect(pct).toBeLessThanOrEqual(51);
  });

  it('clamps to 100 when past the recovery period', () => {
    const status: BodyStatus = {
      id: 'p3', bodyPart: 'head', type: 'injury', severity: 'minor',
      name: 'x', description: 'x',
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      estimatedRecoveryDays: 10, color: '#ff9999',
    };
    expect(svc.getRecoveryPercentage(status)).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — getXPPenaltyForAction()', () => {
  let svc: BodyStatusService;

  beforeEach(() => { svc = makeSvc(); });

  it('returns 0 when no statuses impact the action', () => {
    addMinorInjury(svc, { impactsActions: ['running'], xpPenalty: 20 });
    expect(svc.getXPPenaltyForAction('lifting')).toBe(0);
  });

  it('returns the xpPenalty for a matching action', () => {
    addMinorInjury(svc, { impactsActions: ['running'], xpPenalty: 25 });
    expect(svc.getXPPenaltyForAction('running')).toBe(25);
  });

  it('returns the highest penalty when multiple statuses impact the same action', () => {
    addMinorInjury(svc, { impactsActions: ['running'], xpPenalty: 20 });
    svc.addStatus('right-knee', 'injury', 'severe', 'Severe Knee', 'desc',
      undefined, undefined, ['running'], 50);
    expect(svc.getXPPenaltyForAction('running')).toBe(50);
  });

  it('returns 0 when no statuses are active', () => {
    expect(svc.getXPPenaltyForAction('running')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — getSummary()', () => {
  let svc: BodyStatusService;

  beforeEach(() => { svc = makeSvc(); });

  it('returns zeros when no statuses', () => {
    const s = svc.getSummary();
    expect(s).toEqual({ totalActive: 0, injuries: 0, illnesses: 0, diseases: 0, critical: 0 });
  });

  it('counts by type correctly', () => {
    addMinorInjury(svc);
    svc.addStatus('chest', 'illness', 'minor', 'Illness', 'desc');
    svc.addStatus('neck',  'disease', 'minor', 'Disease', 'desc');
    const s = svc.getSummary();
    expect(s.injuries).toBe(1);
    expect(s.illnesses).toBe(1);
    expect(s.diseases).toBe(1);
    expect(s.totalActive).toBe(3);
  });

  it('counts critical statuses correctly', () => {
    svc.addStatus('head', 'injury', 'critical', 'Crit', 'desc');
    svc.addStatus('chest', 'illness', 'critical', 'Crit2', 'desc');
    addMinorInjury(svc);
    expect(svc.getSummary().critical).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyStatusService — localStorage persistence', () => {
  it('survives service re-creation', () => {
    const svc1 = makeSvc();
    addMinorInjury(svc1);
    const id = svc1.getActiveStatuses()[0].id;

    const svc2 = new BodyStatusService();
    const found = svc2.getActiveStatuses().find(s => s.id === id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test Injury');
  });

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem(STORAGE_KEY, '{{invalid json');
    expect(() => new BodyStatusService()).not.toThrow();
    const svc = new BodyStatusService();
    expect(svc.getActiveStatuses()).toHaveLength(0);
  });

  it('handles empty localStorage (returns empty list)', () => {
    const svc = makeSvc();
    expect(svc.getActiveStatuses()).toHaveLength(0);
  });
});
