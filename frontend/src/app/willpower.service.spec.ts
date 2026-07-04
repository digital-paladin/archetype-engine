// willpower.service.spec.ts
// Unit tests for WillpowerService — validates WP state, status labels,
// deplete/regenerate/reset logic, and the sleep-based idempotent reset.

import { WillpowerService } from './willpower.service';

const STORAGE_KEY       = 'dp-willpower';
const RESET_DATE_KEY    = 'dp-willpower-reset-date';
const TODAY             = new Date().toLocaleDateString('en-CA'); // "YYYY-MM-DD"
const YESTERDAY         = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA');

function makeService(startingWP = 100): WillpowerService {
  localStorage.clear();
  if (startingWP !== 100) localStorage.setItem(STORAGE_KEY, String(startingWP));
  return new WillpowerService();
}

// ─────────────────────────────────────────────────────────────
// Initial state
// ─────────────────────────────────────────────────────────────
describe('WillpowerService — initial state', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to 100 when localStorage is empty', () => {
    const svc = makeService();
    expect(svc.willpower()).toBe(100);
  });

  it('loads persisted value from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, '55');
    const svc = new WillpowerService();
    expect(svc.willpower()).toBe(55);
  });

  it('clamps stored value above 100 to 100', () => {
    localStorage.setItem(STORAGE_KEY, '999');
    const svc = new WillpowerService();
    expect(svc.willpower()).toBe(100);
  });

  it('clamps stored value below 0 to 0', () => {
    localStorage.setItem(STORAGE_KEY, '-10');
    const svc = new WillpowerService();
    expect(svc.willpower()).toBe(0);
  });

  it('returns 100 for non-numeric stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'NaN');
    const svc = new WillpowerService();
    expect(svc.willpower()).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────
// status computed signal
// ─────────────────────────────────────────────────────────────
describe('WillpowerService — status labels', () => {
  const cases: Array<[number, string]> = [
    [100, 'Iron Will'],
    [80,  'Iron Will'],
    [79,  'Focused'],
    [60,  'Focused'],
    [59,  'Strained'],
    [40,  'Strained'],
    [39,  'Wavering'],
    [20,  'Wavering'],
    [19,  'Depleted'],
    [0,   'Depleted'],
  ];
  test.each(cases)('%i WP → status "%s"', (wp, expected) => {
    const svc = makeService(wp);
    expect(svc.status()).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────
// statusClass computed signal
// ─────────────────────────────────────────────────────────────
describe('WillpowerService — statusClass', () => {
  it('80+ WP → willpower-ironwill', () => {
    expect(makeService(80).statusClass()).toBe('willpower-ironwill');
  });
  it('60-79 WP → willpower-focused', () => {
    expect(makeService(60).statusClass()).toBe('willpower-focused');
  });
  it('40-59 WP → willpower-strained', () => {
    expect(makeService(40).statusClass()).toBe('willpower-strained');
  });
  it('20-39 WP → willpower-wavering', () => {
    expect(makeService(20).statusClass()).toBe('willpower-wavering');
  });
  it('0-19 WP → willpower-depleted', () => {
    expect(makeService(0).statusClass()).toBe('willpower-depleted');
  });
});

// ─────────────────────────────────────────────────────────────
// deplete()
// ─────────────────────────────────────────────────────────────
describe('WillpowerService — deplete()', () => {
  it('reduces WP by the given amount', () => {
    const svc = makeService(80);
    svc.deplete(30);
    expect(svc.willpower()).toBe(50);
  });

  it('floors at 0 — never goes negative', () => {
    const svc = makeService(10);
    svc.deplete(50);
    expect(svc.willpower()).toBe(0);
  });

  it('persists the new value to localStorage', () => {
    const svc = makeService(80);
    svc.deplete(20);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('60');
  });

  it('emits depleted$ when WP transitions from >0 to 0', () => {
    const svc = makeService(10);
    let emitted = false;
    svc.depleted$.subscribe(() => { emitted = true; });
    svc.deplete(10);
    expect(emitted).toBe(true); // Subject.next() fires synchronously
  });

  it('does NOT emit depleted$ when WP was already 0', () => {
    const svc = makeService(0);
    const spy = vi.fn();
    svc.depleted$.subscribe(spy);
    svc.deplete(5);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT emit depleted$ for partial depletion that does not reach 0', () => {
    const svc = makeService(50);
    const spy = vi.fn();
    svc.depleted$.subscribe(spy);
    svc.deplete(10);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// regenerate()
// ─────────────────────────────────────────────────────────────
describe('WillpowerService — regenerate()', () => {
  it('increases WP by the given amount', () => {
    const svc = makeService(50);
    svc.regenerate(20);
    expect(svc.willpower()).toBe(70);
  });

  it('caps at 100 — never exceeds max', () => {
    const svc = makeService(90);
    svc.regenerate(50);
    expect(svc.willpower()).toBe(100);
  });

  it('persists the new value to localStorage', () => {
    const svc = makeService(50);
    svc.regenerate(10);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('60');
  });
});

// ─────────────────────────────────────────────────────────────
// reset()
// ─────────────────────────────────────────────────────────────
describe('WillpowerService — reset()', () => {
  it('restores WP to 100 regardless of current value', () => {
    const svc = makeService(25);
    svc.reset();
    expect(svc.willpower()).toBe(100);
  });

  it('persists 100 to localStorage', () => {
    const svc = makeService(25);
    svc.reset();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('100');
  });
});

// ─────────────────────────────────────────────────────────────
// resetForNewSleep() — once-per-day idempotent sleep reset
// ─────────────────────────────────────────────────────────────
describe('WillpowerService — resetForNewSleep()', () => {
  it('resets WP to 100 on the first call of the day', () => {
    const svc = makeService(35);
    svc.resetForNewSleep();
    expect(svc.willpower()).toBe(100);
  });

  it('persists 100 and stores today\'s date', () => {
    const svc = makeService(35);
    svc.resetForNewSleep();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('100');
    expect(localStorage.getItem(RESET_DATE_KEY)).toBe(TODAY);
  });

  it('does NOT reset again if called a second time the same day', () => {
    const svc = makeService(100);
    svc.resetForNewSleep(); // first call → reset, date saved
    svc.deplete(40);        // WP now 60
    svc.resetForNewSleep(); // second call same day → should be no-op
    expect(svc.willpower()).toBe(60);
  });

  it('DOES reset when last reset was yesterday (new calendar day)', () => {
    const svc = makeService(40);
    localStorage.setItem(RESET_DATE_KEY, YESTERDAY); // simulate: reset happened yesterday
    svc.resetForNewSleep();
    expect(svc.willpower()).toBe(100);
    expect(localStorage.getItem(RESET_DATE_KEY)).toBe(TODAY);
  });

  it('DOES reset when there is no prior reset date recorded', () => {
    const svc = makeService(30);
    // RESET_DATE_KEY not set in localStorage
    svc.resetForNewSleep();
    expect(svc.willpower()).toBe(100);
  });
});
