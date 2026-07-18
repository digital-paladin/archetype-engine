// xp-calculation.service.spec.ts
// Unit tests for XpCalculationService — validates Archetype Engine XP formulas

import { TestBed } from '@angular/core/testing';
import { XpCalculationService, XPCalculation } from './xp-calculation.service';

describe('XpCalculationService', () => {
  let service: XpCalculationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(XpCalculationService);
  });

  // ─────────────────────────────────────────────────────────────
  // calculatePendingXP — Base Formula
  // ─────────────────────────────────────────────────────────────
  describe('calculatePendingXP — Base Formula', () => {
    it('should calculate routine coding XP correctly', () => {
      // coding-routine: 10/hr × 1.0 (routine) × 2 hrs = 20 XP
      const result = service.calculatePendingXP('coding-routine', 2, 'routine');
      expect(result.baseXP).toBeCloseTo(20, 2);
      expect(result.pendingXP).toBeCloseTo(20, 2);
    });

    it('should apply moderate intensity multiplier (1.35x)', () => {
      // coding-routine: 10/hr × 1.35 × 2 hrs = 27 XP
      const result = service.calculatePendingXP('coding-routine', 2, 'moderate');
      expect(result.baseXP).toBeCloseTo(27, 2);
      expect(result.intensityMultiplier).toBe(1.35);
    });

    it('should apply complex intensity multiplier (1.75x)', () => {
      // coding-architecture: 20/hr × 1.75 × 1.5 hrs = 52.5 XP
      const result = service.calculatePendingXP('coding-architecture', 1.5, 'complex');
      expect(result.baseXP).toBeCloseTo(52.5, 2);
      expect(result.intensityMultiplier).toBe(1.75);
    });

    it('should use routine multiplier as default when no intensity provided', () => {
      const result = service.calculatePendingXP('coding-routine', 1);
      expect(result.intensityMultiplier).toBe(1.0);
    });

    it('should handle fractional hours correctly (0.25 = 15 min)', () => {
      // coding-routine: 10/hr × 1.0 × 0.25 = 2.5 XP
      const result = service.calculatePendingXP('coding-routine', 0.25, 'routine');
      expect(result.pendingXP).toBeCloseTo(2.5, 2);
    });

    it('should return correct category for activity', () => {
      const devResult = service.calculatePendingXP('coding-routine', 1, 'routine');
      expect(devResult.category).toBe('developer');

      const htbResult = service.calculatePendingXP('htb-medium', 1, 'routine');
      expect(htbResult.category).toBe('redteamer');

      const warriorResult = service.calculatePendingXP('mma-class', 1, 'routine');
      expect(warriorResult.category).toBe('warrior');
    });

    it('should include hours, baseRate, and intensityMultiplier in result', () => {
      const result = service.calculatePendingXP('htb-medium', 3, 'moderate');
      expect(result.hours).toBe(3);
      expect(result.baseRate).toBe(15);
      expect(result.intensityMultiplier).toBe(1.35);
    });

    it('should round pendingXP to 2 decimal places', () => {
      // 2 → 1/3 hours × 10 × 1.35 = 4.5 (exact), use irrational to test rounding
      const result = service.calculatePendingXP('coding-routine', 1 / 3, 'moderate');
      const raw = (1 / 3) * 10 * 1.35;
      expect(result.pendingXP).toBeCloseTo(Math.round(raw * 100) / 100, 5);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // calculatePendingXP — Bonuses
  // ─────────────────────────────────────────────────────────────
  describe('calculatePendingXP — Bonuses', () => {
    it('should add single bonus to pending XP', () => {
      // coding-routine: 2 hrs routine = 20 XP + clean-sonarqube (+2) = 22
      const result = service.calculatePendingXP('coding-routine', 2, 'routine', ['clean-sonarqube']);
      expect(result.totalBonusXP).toBe(2);
      expect(result.pendingXP).toBeCloseTo(22, 2);
      expect(result.bonuses).toHaveLength(1);
      expect(result.bonuses[0].name).toBe('Clean SonarQube');
    });

    it('should add multiple bonuses to pending XP', () => {
      // 2 hrs routine coding = 20 + clean-sonarqube(2) + tests-written(3) + great-review(5) = 30
      const result = service.calculatePendingXP(
        'coding-routine', 2, 'routine',
        ['clean-sonarqube', 'tests-written', 'great-review']
      );
      expect(result.totalBonusXP).toBe(10);
      expect(result.pendingXP).toBeCloseTo(30, 2);
      expect(result.bonuses).toHaveLength(3);
    });

    it('should ignore unknown bonus keys without throwing', () => {
      const result = service.calculatePendingXP(
        'coding-routine', 1, 'routine',
        ['not-a-real-bonus']
      );
      expect(result.totalBonusXP).toBe(0);
      expect(result.bonuses).toHaveLength(0);
    });

    it('should handle empty bonuses array (default no bonuses)', () => {
      const result = service.calculatePendingXP('coding-routine', 1, 'routine', []);
      expect(result.totalBonusXP).toBe(0);
      expect(result.bonuses).toHaveLength(0);
    });

    it('should correctly apply HTB root bonus (+25)', () => {
      const result = service.calculatePendingXP('htb-medium', 2, 'moderate', ['htb-root']);
      const baseXP = 2 * 15 * 1.35; // 40.5
      expect(result.pendingXP).toBeCloseTo(baseXP + 25, 2);
    });

    it('should correctly apply CTF first blood bonus (+50)', () => {
      const result = service.calculatePendingXP('ctf-live', 3, 'complex', ['ctf-first-blood']);
      const baseXP = 3 * 15 * 1.75; // 78.75
      expect(result.pendingXP).toBeCloseTo(baseXP + 50, 2);
    });

    it('should correctly apply production deploy bonus (+10)', () => {
      const result = service.calculatePendingXP('coding-complex', 1, 'routine', ['production-deploy']);
      expect(result.pendingXP).toBeCloseTo(15 + 10, 2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // calculatePendingXP — Activity Rates
  // ─────────────────────────────────────────────────────────────
  describe('calculatePendingXP — Activity Rates', () => {
    const expectedRates: [string, number, string][] = [
      ['coding-routine', 10, 'developer'],
      ['coding-complex', 15, 'developer'],
      ['coding-architecture', 20, 'developer'],
      ['htb-easy', 10, 'redteamer'],
      ['htb-medium', 15, 'redteamer'],
      ['htb-hard', 20, 'redteamer'],
      ['workout-strength', 15, 'warrior'],
      ['mma-class', 20, 'warrior'],
      ['prayer', 5, 'sage'],
      ['bible-study', 8, 'sage'],
      ['music-practice', 10, 'artist'],
      ['production', 15, 'artist'],
    ];

    expectedRates.forEach(([activityKey, expectedRate, expectedCategory]) => {
      it(`${activityKey} should have base rate ${expectedRate} XP/hr and category "${expectedCategory}"`, () => {
        const result = service.calculatePendingXP(activityKey, 1, 'routine');
        expect(result.baseRate).toBe(expectedRate);
        expect(result.category).toBe(expectedCategory);
      });
    });

    it('should throw error for unknown activity key', () => {
      expect(() => service.calculatePendingXP('unknown-activity', 1, 'routine'))
        .toThrowError('Unknown activity: unknown-activity');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // calculatePendingXP — Intensity Tiers
  // ─────────────────────────────────────────────────────────────
  describe('calculatePendingXP — Intensity Tiers', () => {
    it('routine should produce multiplier of 1.0', () => {
      const result = service.calculatePendingXP('coding-routine', 1, 'routine');
      expect(result.intensityMultiplier).toBe(1.0);
    });

    it('moderate should produce multiplier of 1.35', () => {
      const result = service.calculatePendingXP('coding-routine', 1, 'moderate');
      expect(result.intensityMultiplier).toBe(1.35);
    });

    it('complex should produce multiplier of 1.75', () => {
      const result = service.calculatePendingXP('coding-routine', 1, 'complex');
      expect(result.intensityMultiplier).toBe(1.75);
    });

    it('should throw error for unknown intensity key', () => {
      expect(() => service.calculatePendingXP('coding-routine', 1, 'legendary'))
        .toThrowError('Unknown intensity: legendary');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getActivitiesByCategory
  // ─────────────────────────────────────────────────────────────
  describe('getActivitiesByCategory', () => {
    it('should return activities grouped by category', () => {
      const grouped = service.getActivitiesByCategory();
      expect(grouped['developer']).toBeDefined();
      expect(grouped['redteamer']).toBeDefined();
      expect(grouped['warrior']).toBeDefined();
      expect(grouped['sage']).toBeDefined();
      expect(grouped['artist']).toBeDefined();
    });

    it('developer category should include expected activities', () => {
      const grouped = service.getActivitiesByCategory();
      const devNames = grouped['developer'].map((a) => a.name);
      expect(devNames).toContain('Routine Coding');
      expect(devNames).toContain('Complex Debugging');
      expect(devNames).toContain('Architecture Design');
    });

    it('all activities should have valid base rates > 0', () => {
      const grouped = service.getActivitiesByCategory();
      Object.values(grouped).flat().forEach((activity) => {
        expect(activity.baseRate).toBeGreaterThan(0);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getBonusesByCategory
  // ─────────────────────────────────────────────────────────────
  describe('getBonusesByCategory', () => {
    it('should return all bonuses when no category specified', () => {
      const all = service.getBonusesByCategory();
      expect(all.length).toBeGreaterThanOrEqual(14);
    });

    it('should filter bonuses by developer category', () => {
      const devBonuses = service.getBonusesByCategory('developer');
      expect(devBonuses.every((b) => b.category === 'developer')).toBe(true);
      expect(devBonuses.length).toBeGreaterThan(0);
    });

    it('developer bonuses should include expected bonuses', () => {
      const devBonuses = service.getBonusesByCategory('developer');
      const names = devBonuses.map((b) => b.name);
      expect(names).toContain('Clean SonarQube');
      expect(names).toContain('Tests Written');
      expect(names).toContain('Production Deployment');
    });

    it('all bonus XP values should be positive', () => {
      const all = service.getBonusesByCategory();
      all.forEach((bonus) => {
        expect(bonus.xp).toBeGreaterThan(0);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getIntensityTiers
  // ─────────────────────────────────────────────────────────────
  describe('getIntensityTiers', () => {
    it('should return 3 intensity tiers', () => {
      const tiers = service.getIntensityTiers();
      expect(tiers).toHaveLength(3);
    });

    it('should include routine, moderate, and complex tiers', () => {
      const tiers = service.getIntensityTiers();
      const names = tiers.map((t) => t.name);
      expect(names).toContain('Routine');
      expect(names).toContain('Moderate');
      expect(names).toContain('Complex');
    });

    it('Pareto weekly percentages should sum to 100', () => {
      const tiers = service.getIntensityTiers();
      const total = tiers.reduce((sum, t) => sum + t.weeklyPercentage, 0);
      expect(total).toBe(100);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // auditWeeklyIntensity — Pareto 70/20/10
  // ─────────────────────────────────────────────────────────────
  describe('auditWeeklyIntensity', () => {
    it('should return zero percentages for empty activity list', () => {
      const result = service.auditWeeklyIntensity([]);
      expect(result.routine).toBe(0);
      expect(result.moderate).toBe(0);
      expect(result.complex).toBe(0);
      expect(result.isInflated).toBe(false);
    });

    it('should flag intensity inflation when >50% logged as complex', () => {
      // 1 routine, 1 moderate, 4 complex = 66.7% complex
      const activities = ['routine', 'moderate', 'complex', 'complex', 'complex', 'complex'];
      const result = service.auditWeeklyIntensity(activities);
      expect(result.complexPercent).toBeGreaterThan(50);
      expect(result.isInflated).toBe(true);
      expect(result.recommendation).toContain('⚠️');
    });

    it('should NOT flag inflation for realistic 70/20/10 distribution', () => {
      // 7 routine, 2 moderate, 1 complex = 70/20/10
      const activities = [
        'routine', 'routine', 'routine', 'routine', 'routine', 'routine', 'routine',
        'moderate', 'moderate',
        'complex'
      ];
      const result = service.auditWeeklyIntensity(activities);
      expect(result.isInflated).toBe(false);
      expect(result.recommendation).toContain('✅');
    });

    it('should calculate percentages correctly', () => {
      // 2 routine, 1 moderate, 1 complex = 50/25/25
      const activities = ['routine', 'routine', 'moderate', 'complex'];
      const result = service.auditWeeklyIntensity(activities);
      expect(result.routine).toBe(2);
      expect(result.moderate).toBe(1);
      expect(result.complex).toBe(1);
      expect(result.routinePercent).toBe(50);
      expect(result.moderatePercent).toBe(25);
      expect(result.complexPercent).toBe(25);
    });

    it('should warn when complex percentage is high but not over 50%', () => {
      // 3 routine, 3 moderate, 4 complex = 30/30/40% complex
      const activities = [
        'routine', 'routine', 'routine',
        'moderate', 'moderate', 'moderate',
        'complex', 'complex', 'complex', 'complex'
      ];
      const result = service.auditWeeklyIntensity(activities);
      expect(result.isInflated).toBe(false);
      expect(result.recommendation).toContain('⚠️');
    });

    it('should handle all-routine week without errors', () => {
      const activities = Array(10).fill('routine');
      const result = service.auditWeeklyIntensity(activities);
      expect(result.routinePercent).toBe(100);
      expect(result.isInflated).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getStoryPointMultiplier
  // ─────────────────────────────────────────────────────────────
  describe('getStoryPointMultiplier', () => {
    it('1-point story should use 0.8x multiplier', () => {
      const result = service.getStoryPointMultiplier(1);
      expect(result.multiplier).toBe(0.8);
      expect(result.bonusXP).toBe(0);
      expect(result.bonusName).toBeNull();
    });

    it('2-point story should use 1.0x multiplier', () => {
      const result = service.getStoryPointMultiplier(2);
      expect(result.multiplier).toBe(1.0);
      expect(result.bonusXP).toBe(0);
    });

    it('3-point story should use 1.0x multiplier', () => {
      const result = service.getStoryPointMultiplier(3);
      expect(result.multiplier).toBe(1.0);
    });

    it('5-point story should use 1.3x multiplier', () => {
      const result = service.getStoryPointMultiplier(5);
      expect(result.multiplier).toBe(1.3);
    });

    it('8-point story should use 1.6x multiplier', () => {
      const result = service.getStoryPointMultiplier(8);
      expect(result.multiplier).toBe(1.6);
    });

    it('13-point story should use 2.0x multiplier + Dragon Slayer +50 XP', () => {
      const result = service.getStoryPointMultiplier(13);
      expect(result.multiplier).toBe(2.0);
      expect(result.bonusXP).toBe(50);
      expect(result.bonusName).toBe('Dragon Slayer');
    });

    it('21-point story should also use Dragon Slayer tier (≥13)', () => {
      const result = service.getStoryPointMultiplier(21);
      expect(result.multiplier).toBe(2.0);
      expect(result.bonusXP).toBe(50);
    });

    it('unknown story points should default to 1.0x', () => {
      // 4 points not in the table → default 1.0x
      const result = service.getStoryPointMultiplier(4);
      expect(result.multiplier).toBe(1.0);
      expect(result.bonusXP).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Smoke test — end-to-end calculation scenario
  // ─────────────────────────────────────────────────────────────
  describe('End-to-End Calculation Scenarios', () => {
    it('IQ-2-3pt story: 2.5 hrs coding (moderate) + sonarqube + tests = correct total', () => {
      // 2.5 × 15 × 1.35 = 50.625 base + 2 + 3 = 55.625 → 55.63
      const result = service.calculatePendingXP(
        'coding-complex', 2.5, 'moderate',
        ['clean-sonarqube', 'tests-written']
      );
      expect(result.baseXP).toBeCloseTo(50.63, 2);
      expect(result.totalBonusXP).toBe(5);
      expect(result.pendingXP).toBeCloseTo(55.63, 2);
    });

    it('Warrior sparring 1 hr complex = 43.75 XP', () => {
      // sparring: 25/hr × 1.75 = 43.75
      const result = service.calculatePendingXP('sparring', 1, 'complex');
      expect(result.pendingXP).toBeCloseTo(43.75, 2);
    });

    it('HTB medium 2 hrs complex + root flag = correct total', () => {
      // 2 × 15 × 1.75 = 52.5 + 25 (htb-root) = 77.5
      const result = service.calculatePendingXP('htb-medium', 2, 'complex', ['htb-root']);
      expect(result.pendingXP).toBeCloseTo(77.5, 2);
    });
  });
});
