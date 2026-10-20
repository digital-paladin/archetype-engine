import { validateRecoveryActivity, entryDate, CLAIM_DATE_TAG, mergeActivityLogs } from './recoveryQuests.service';
import { ActivityEntry } from './data/IDataService';
import { XpCalculatorService } from './xpCalculator.service';

const THU = '2026-10-22';
const FRI = '2026-10-23';
const entry = (activity_type: string, date: string, tagged = false): ActivityEntry => ({
  user_id: 'u', class_name: 'Warrior', activity_type,
  logged_at: `${date}T17:00:00.000Z`, // noon CT
  notes: tagged ? CLAIM_DATE_TAG(date) : undefined,
});

describe('recovery quest XP config', () => {
  const calc = new XpCalculatorService();
  it('awards flat Warrior XP, ignoring duration', () => {
    expect(calc.getMultiClassXP('recovery-xray-done', 90)).toEqual([{ class: 'warrior', xp: 120 }]);
    expect(calc.calculateXP('recovery-rest-day')).toBe(20);
    expect(calc.calculateXP('recovery-session-as-planned', 60)).toBe(10);
    expect(calc.calculateXP('recovery-consistency-bonus')).toBe(50);
  });
  it('X-ray main quest totals 300 XP', () => {
    const total = ['order', 'book', 'done', 'review']
      .reduce((s, k) => s + calc.calculateXP(`recovery-xray-${k}`), 0);
    expect(total).toBe(300);
  });
});

describe('Foot X-ray steps', () => {
  it('allows the first step on an empty log', () => {
    expect(validateRecoveryActivity('recovery-xray-order', FRI, [], FRI).ok).toBe(true);
  });
  it('enforces step order', () => {
    const r = validateRecoveryActivity('recovery-xray-done', FRI, [entry('recovery-xray-order', THU)], FRI);
    expect(r).toEqual({ ok: false, reason: 'Complete Foot X-ray 2/4 (Booked) first' });
  });
  it('is one-time per step', () => {
    expect(validateRecoveryActivity('recovery-xray-order', FRI, [entry('recovery-xray-order', THU)], FRI).ok).toBe(false);
  });
});

describe('Rest Day Kept', () => {
  it('passes on a Thursday with no training', () => {
    expect(validateRecoveryActivity('recovery-rest-day', THU, [entry('art-drawing', THU)], THU).ok).toBe(true);
  });
  it('rejects non-Thursdays and future Thursdays', () => {
    expect(validateRecoveryActivity('recovery-rest-day', FRI, [], FRI).ok).toBe(false);
    expect(validateRecoveryActivity('recovery-rest-day', THU, [], '2026-10-20').ok).toBe(false);
  });
  it('rejects when training was logged that Thursday', () => {
    for (const t of ['workout-strength', 'mma-class', 'sparring', 'swimming']) {
      expect(validateRecoveryActivity('recovery-rest-day', THU, [entry(t, THU)], FRI).ok).toBe(false);
    }
  });
  it('rejects an impossible date that would otherwise roll onto a Thursday', () => {
    // 2026-09-31 overflows to 2026-10-01, which is a Thursday.
    const r = validateRecoveryActivity('recovery-rest-day', '2026-09-31', [], '2026-10-19');
    expect(r).toEqual({ ok: false, reason: 'Claim date must be a real calendar day (YYYY-MM-DD)' });
  });
  it('does not let a training note move that session off Thursday', () => {
    const moved = { ...entry('workout-strength', THU), notes: CLAIM_DATE_TAG('2026-10-21') };
    expect(entryDate(moved)).toBe(THU);
    expect(validateRecoveryActivity('recovery-rest-day', THU, [moved], FRI).ok).toBe(false);
  });
  it('counts a recovery row once when history and the recent log overlap', () => {
    const row = { ...entry('recovery-session-as-planned', FRI, true), id: 'same-row' };
    expect(mergeActivityLogs([row], [{ ...row }])).toHaveLength(1);
  });
  it('can be claimed late (Friday) but only once, via the claim-date tag', () => {
    expect(validateRecoveryActivity('recovery-rest-day', THU, [], FRI).ok).toBe(true);
    const late: ActivityEntry = { ...entry('recovery-rest-day', FRI), notes: CLAIM_DATE_TAG(THU) };
    expect(entryDate(late)).toBe(THU);
    expect(validateRecoveryActivity('recovery-rest-day', THU, [late], FRI).ok).toBe(false);
  });
});

describe('Session As Planned', () => {
  it('needs a logged session that day', () => {
    expect(validateRecoveryActivity('recovery-session-as-planned', FRI, [], FRI).ok).toBe(false);
    expect(validateRecoveryActivity('recovery-session-as-planned', FRI, [entry('workout-strength', FRI)], FRI).ok).toBe(true);
  });
  it('allows one bonus per logged session', () => {
    const log = [entry('workout-strength', FRI), entry('recovery-session-as-planned', FRI, true)];
    expect(validateRecoveryActivity('recovery-session-as-planned', FRI, log, FRI).ok).toBe(false);
    log.push(entry('swimming', FRI));
    expect(validateRecoveryActivity('recovery-session-as-planned', FRI, log, FRI).ok).toBe(true);
  });
});

describe('Consistency Bonus (10 of 13)', () => {
  const sessions = (n: number) => Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 10 + i)).toISOString().slice(0, 10); // Oct 10..
    return entry('recovery-session-as-planned', d, true);
  });
  it('needs 10 sessions as planned in the trailing 14 days', () => {
    expect(validateRecoveryActivity('recovery-consistency-bonus', FRI, sessions(9), FRI)).toEqual({
      ok: false, reason: '9/10 sessions as planned in the last 14 days',
    });
    expect(validateRecoveryActivity('recovery-consistency-bonus', FRI, sessions(10), FRI).ok).toBe(true);
  });
  it('ignores sessions older than 14 days', () => {
    const old = Array.from({ length: 10 }, () => entry('recovery-session-as-planned', '2026-10-01', true));
    expect(validateRecoveryActivity('recovery-consistency-bonus', FRI, old, FRI).ok).toBe(false);
  });
  it('can only be claimed once per 14 days', () => {
    const log = [...sessions(10), entry('recovery-consistency-bonus', '2026-10-15', true)];
    expect(validateRecoveryActivity('recovery-consistency-bonus', FRI, log, FRI).ok).toBe(false);
  });
});
