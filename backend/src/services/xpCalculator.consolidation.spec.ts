import { XpCalculatorService } from '../services/xpCalculator.service';

describe('XpCalculatorService — consolidation formulas', () => {
  let calc: XpCalculatorService;

  beforeEach(() => { calc = new XpCalculatorService(); });

  // ── getConsolidationMultiplier ────────────────────────────────────────────
  describe('getConsolidationMultiplier', () => {
    it('returns 1.15 for Grandmaster (365+ days)', () => {
      expect(calc.getConsolidationMultiplier(365)).toBe(1.15);
      expect(calc.getConsolidationMultiplier(700)).toBe(1.15);
    });
    it('returns 1.125 for Master (180–364 days)', () => {
      expect(calc.getConsolidationMultiplier(180)).toBe(1.125);
      expect(calc.getConsolidationMultiplier(364)).toBe(1.125);
    });
    it('returns 1.10 for Expert (90–179 days)', () => {
      expect(calc.getConsolidationMultiplier(90)).toBe(1.10);
      expect(calc.getConsolidationMultiplier(179)).toBe(1.10);
    });
    it('returns 1.075 for Adept (30–89 days)', () => {
      expect(calc.getConsolidationMultiplier(30)).toBe(1.075);
      expect(calc.getConsolidationMultiplier(89)).toBe(1.075);
    });
    it('returns 1.05 for Novice (1–29 days)', () => {
      expect(calc.getConsolidationMultiplier(1)).toBe(1.05);
      expect(calc.getConsolidationMultiplier(29)).toBe(1.05);
    });
    it('returns 1.0 for zero streak', () => {
      expect(calc.getConsolidationMultiplier(0)).toBe(1.0);
    });
  });

  // ── getConsolidationTierName ──────────────────────────────────────────────
  describe('getConsolidationTierName', () => {
    it('returns Grandmaster for 700 days', () => {
      expect(calc.getConsolidationTierName(700)).toBe('Grandmaster');
    });
    it('returns Adept for 30 days', () => {
      expect(calc.getConsolidationTierName(30)).toBe('Adept');
    });
    it('returns Unranked for 0 days', () => {
      expect(calc.getConsolidationTierName(0)).toBe('Unranked');
    });
  });

  // ── getFitbitModifier ─────────────────────────────────────────────────────
  describe('getFitbitModifier', () => {
    it('returns 0.91 for score 91', () => {
      expect(calc.getFitbitModifier(91)).toBeCloseTo(0.91);
    });
    it('returns 0.90 for null (conservative default)', () => {
      expect(calc.getFitbitModifier(null)).toBe(0.9);
    });
    it('caps at 1.0 for scores above 100', () => {
      expect(calc.getFitbitModifier(120)).toBe(1.0);
    });
    it('returns 0 for score 0', () => {
      expect(calc.getFitbitModifier(0)).toBe(0.0);
    });
  });

  // ── getAclBonus ───────────────────────────────────────────────────────────
  describe('getAclBonus', () => {
    it('returns 0 for 0 items', () => {
      expect(calc.getAclBonus(0)).toBe(0);
    });
    it('returns 8 for 15 items (15 × 0.5 = 7.5 → rounded to 8)', () => {
      expect(calc.getAclBonus(15)).toBe(8);
    });
    it('returns 3 for 6 items (6 × 0.5 = 3)', () => {
      expect(calc.getAclBonus(6)).toBe(3);
    });
  });

  // ── calculateConfirmedXP ──────────────────────────────────────────────────
  describe('calculateConfirmedXP', () => {
    it('Grandmaster 690 days + Fitbit 91 → about 103.5%', () => {
      const result = calc.calculateConfirmedXP(100, 690, 91);
      // 1.15 × 0.91 = 1.0465 → 105 XP confirmed, +5 bonus
      expect(result.confirmed).toBe(105);
      expect(result.bonusXP).toBe(5);
      expect(result.consolidationPct).toBe(105);
      expect(result.tierName).toBe('Grandmaster');
    });

    it('Novice 10 days + Fitbit 80 → 84%', () => {
      const result = calc.calculateConfirmedXP(100, 10, 80);
      // 1.05 × 0.80 = 0.84 → 84 XP (below pending — sleep quality dragged it down)
      expect(result.confirmed).toBe(84);
      expect(result.bonusXP).toBe(-16);
      expect(result.consolidationPct).toBe(84);
    });

    it('null Fitbit uses 0.90 default', () => {
      const result = calc.calculateConfirmedXP(100, 365, null);
      // 1.15 × 0.90 → 100 * 1.15 * 0.9 = 103.499... (float) → Math.round = 103
      expect(result.confirmed).toBe(103);
    });
  });

  // ── applyXPGain ───────────────────────────────────────────────────────────
  describe('applyXPGain', () => {
    it('adds XP within same level', () => {
      const result = calc.applyXPGain(5, 200, 100);
      expect(result.newLevel).toBe(5);
      expect(result.newCurrentXP).toBe(300);
      expect(result.leveledUp).toBe(false);
    });

    it('levels up when XP exceeds threshold (836 × level)', () => {
      // L1 threshold = 836 × 1 = 836
      // Starting: L1, 800 XP. +100 XP → 900. Exceeds 836 → L2, carry 64.
      const result = calc.applyXPGain(1, 800, 100);
      expect(result.newLevel).toBe(2);
      expect(result.newCurrentXP).toBe(64);
      expect(result.leveledUp).toBe(true);
    });

    it('handles multiple level-ups from a single large XP gain', () => {
      // L1 threshold = 836. L2 threshold = 1672.
      // Start L1 at 0 XP, gain 3000 XP → should reach at least L3.
      const result = calc.applyXPGain(1, 0, 3000);
      expect(result.newLevel).toBeGreaterThanOrEqual(3);
      expect(result.leveledUp).toBe(true);
    });

    it('does not level up exactly at threshold boundary', () => {
      // L1 threshold = 836. Start at 835, +0 XP → no level-up.
      const result = calc.applyXPGain(1, 835, 0);
      expect(result.newLevel).toBe(1);
      expect(result.leveledUp).toBe(false);
    });

    it('uses max(100, 836×level) — minimum threshold of 100 at L0', () => {
      // L0: threshold = max(100, 836*0) = 100. Gain 200 XP.
      // After first level-up (L0→L1, carry 100), L1 threshold = 836 — carry 100 < 836 → stop at L1.
      const result = calc.applyXPGain(0, 0, 200);
      expect(result.newLevel).toBe(1);
      expect(result.newCurrentXP).toBe(100);
      expect(result.leveledUp).toBe(true);
    });
  });
});
