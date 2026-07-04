// loot-drop.service.spec.ts
// Unit tests for LootDropService — validates rarity roll, pity system,
// combo guarantee, dismiss, and rarity pool selection.

import { LootDropService } from './loot-drop.service';

const LS_PITY_RARE = 'dp-pity-not-rare';
const LS_PITY_LEG  = 'dp-pity-not-legendary';

function makeService(pitySinceRare = 0, pitySinceLeg = 0): LootDropService {
  localStorage.clear();
  if (pitySinceRare > 0) localStorage.setItem(LS_PITY_RARE, String(pitySinceRare));
  if (pitySinceLeg  > 0) localStorage.setItem(LS_PITY_LEG,  String(pitySinceLeg));
  return new LootDropService();
}

// ─────────────────────────────────────────────────────────────
// Initial state
// ─────────────────────────────────────────────────────────────
describe('LootDropService — initial state', () => {
  beforeEach(() => localStorage.clear());

  it('activeDrop starts null', () => {
    expect(makeService().activeDrop()).toBeNull();
  });

  it('loads pity counters from localStorage', () => {
    localStorage.setItem(LS_PITY_RARE, '8');
    localStorage.setItem(LS_PITY_LEG,  '25');
    const svc = new LootDropService();
    // Trigger one roll to verify pity thresholds were loaded
    // At 8 rare-pity and 25 leg-pity neither threshold is reached yet (10/30)
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // trigger roll but no drop (>0.25)
    svc.roll('workout-strength');
    // No drop because random > 0.25 and no pity reached
    expect(svc.activeDrop()).toBeNull();
    vi.restoreAllMocks();
  });
});

// ─────────────────────────────────────────────────────────────
// dismiss()
// ─────────────────────────────────────────────────────────────
describe('LootDropService — dismiss()', () => {
  it('clears activeDrop to null', () => {
    const svc = makeService();
    // Force a drop via forceGuarantee
    vi.spyOn(Math, 'random').mockReturnValue(0.50); // common rarity
    svc.roll('dev-story', true);
    expect(svc.activeDrop()).not.toBeNull();
    svc.dismiss();
    expect(svc.activeDrop()).toBeNull();
    vi.restoreAllMocks();
  });
});

// ─────────────────────────────────────────────────────────────
// roll() — 25% base trigger chance
// ─────────────────────────────────────────────────────────────
describe('LootDropService — roll() base trigger (25% chance)', () => {
  it('does NOT set activeDrop when random > 0.25 (no pity, no guarantee)', () => {
    const svc = makeService();
    vi.spyOn(Math, 'random').mockReturnValue(0.80);
    svc.roll('workout-cardio');
    expect(svc.activeDrop()).toBeNull();
    vi.restoreAllMocks();
  });

  it('DOES set activeDrop when random ≤ 0.25 (trigger fires)', () => {
    const svc = makeService();
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.20)  // trigger check passes (≤ 0.25)
      .mockReturnValueOnce(0.50); // rarity → common
    svc.roll('dev-story');
    expect(svc.activeDrop()).not.toBeNull();
    vi.restoreAllMocks();
  });

  it('activityType is stored on the active drop', () => {
    const svc = makeService();
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.10)
      .mockReturnValueOnce(0.50);
    svc.roll('redteam-lab');
    expect(svc.activeDrop()?.activityType).toBe('redteam-lab');
    vi.restoreAllMocks();
  });
});

// ─────────────────────────────────────────────────────────────
// roll() — forceGuarantee (7-day combo)
// ─────────────────────────────────────────────────────────────
describe('LootDropService — roll() forceGuarantee', () => {
  it('always drops when forceGuarantee=true, regardless of random', () => {
    const svc = makeService();
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99)  // would normally not trigger
      .mockReturnValueOnce(0.50); // rarity → common
    svc.roll('workout-strength', true);
    expect(svc.activeDrop()).not.toBeNull();
    vi.restoreAllMocks();
  });

  it('marks isComboGuarantee true on the drop', () => {
    const svc = makeService();
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.50);
    svc.roll('workout-strength', true);
    expect(svc.activeDrop()?.isComboGuarantee).toBe(true);
    vi.restoreAllMocks();
  });
});

// ─────────────────────────────────────────────────────────────
// Pity system — rare pity (10 logs without rare+)
// ─────────────────────────────────────────────────────────────
describe('LootDropService — pity: rare threshold (10 logs)', () => {
  it('forces a rare drop at the 10th consecutive non-rare log', () => {
    // Start at 9 (one away from threshold); roll increments to 10 before check
    const svc = makeService(9, 0);
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99) // would not trigger without pity
      .mockReturnValueOnce(0.55); // rarity roll → common if called, but pity forces rare
    svc.roll('coding-routine');
    const drop = svc.activeDrop();
    expect(drop).not.toBeNull();
    expect(drop?.reward.rarity).toBe('rare');
    vi.restoreAllMocks();
  });

  it('marks isPity true on a pity-triggered rare drop', () => {
    const svc = makeService(9, 0);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    svc.roll('coding-routine');
    expect(svc.activeDrop()?.isPity).toBe(true);
    vi.restoreAllMocks();
  });

  it('resets pitySinceNotRare to 0 after rare pity drop fires', () => {
    const svc = makeService(9, 0);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    svc.roll('coding-routine');
    expect(localStorage.getItem(LS_PITY_RARE)).toBe('0');
    vi.restoreAllMocks();
  });

  it('pitySinceLegendary is NOT reset by a rare pity drop', () => {
    const svc = makeService(9, 15);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    svc.roll('coding-routine');
    // legendary pity should have incremented from 15→16 (not reset)
    const legPity = parseInt(localStorage.getItem(LS_PITY_LEG) ?? '0', 10);
    expect(legPity).toBeGreaterThan(15);
    vi.restoreAllMocks();
  });
});

// ─────────────────────────────────────────────────────────────
// Pity system — legendary pity (30 logs)
// ─────────────────────────────────────────────────────────────
describe('LootDropService — pity: legendary threshold (30 logs)', () => {
  it('forces a legendary drop at 30 consecutive non-legendary logs', () => {
    const svc = makeService(0, 29); // one away from leg pity
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // suppresses random trigger
    svc.roll('htb-challenge');
    const drop = svc.activeDrop();
    expect(drop).not.toBeNull();
    expect(drop?.reward.rarity).toBe('legendary');
    vi.restoreAllMocks();
  });

  it('resets both pity counters to 0 after legendary drop', () => {
    const svc = makeService(12, 29);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    svc.roll('htb-challenge');
    expect(localStorage.getItem(LS_PITY_RARE)).toBe('0');
    expect(localStorage.getItem(LS_PITY_LEG)).toBe('0');
    vi.restoreAllMocks();
  });
});

// ─────────────────────────────────────────────────────────────
// Rarity pools — reward selected from correct tier
// ─────────────────────────────────────────────────────────────
describe('LootDropService — rarity pools', () => {
  const COMMON_RARITY_IDS    = ['coffee', 'snack', 'gaming-30', 'episode', 'power-nap'];
  const UNCOMMON_RARITY_IDS  = ['restaurant', 'movie-night', 'impulse-20', 'gaming-eve', 'self-care'];
  const RARE_RARITY_IDS      = ['new-game', 'clothing', 'fine-dining', 'hobby-50'];
  const LEGENDARY_RARITY_IDS = ['weekend', 'tech-drop', 'free-week'];

  it('drop reward is from the common pool when rarity roll → common', () => {
    const svc = makeService();
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.10)  // trigger
      .mockReturnValueOnce(0.50)  // rarity → common (≥0.40)
      .mockReturnValueOnce(0);    // pool index → first item
    svc.roll('workout');
    expect(COMMON_RARITY_IDS).toContain(svc.activeDrop()?.reward.id);
    vi.restoreAllMocks();
  });

  it('drop reward is from the rare pool when rarity roll → rare', () => {
    const svc = makeService();
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.10)  // trigger
      .mockReturnValueOnce(0.10)  // rarity → rare (< 0.15)
      .mockReturnValueOnce(0);    // pool index → first item
    svc.roll('workout');
    expect(RARE_RARITY_IDS).toContain(svc.activeDrop()?.reward.id);
    vi.restoreAllMocks();
  });

  it('drop reward is from the legendary pool when rarity roll → legendary', () => {
    const svc = makeService();
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.10)  // trigger
      .mockReturnValueOnce(0.01)  // rarity → legendary (< 0.03)
      .mockReturnValueOnce(0);    // pool index → first item
    svc.roll('workout');
    expect(LEGENDARY_RARITY_IDS).toContain(svc.activeDrop()?.reward.id);
    vi.restoreAllMocks();
  });
});

// ─────────────────────────────────────────────────────────────
// Pity counter increments on every roll (pass or fail)
// ─────────────────────────────────────────────────────────────
describe('LootDropService — pity counter increments', () => {
  it('increments pitySinceNotRare on every roll (even a miss)', () => {
    const svc = makeService(0, 0);
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // no trigger, no drop
    svc.roll('art-drawing');
    expect(parseInt(localStorage.getItem(LS_PITY_RARE) ?? '0', 10)).toBe(1);
    vi.restoreAllMocks();
  });

  it('increments pitySinceLegendary on every roll', () => {
    const svc = makeService(0, 0);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    svc.roll('art-drawing');
    expect(parseInt(localStorage.getItem(LS_PITY_LEG) ?? '0', 10)).toBe(1);
    vi.restoreAllMocks();
  });
});
