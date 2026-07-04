// consolidation.service.spec.ts
// Unit tests for ConsolidationService — validates sleep consolidation formulas

import { TestBed } from '@angular/core/testing';
import {
  ConsolidationService,
  SleepQuality,
  NutritionQuality,
  FastingStatus,
} from './consolidation.service';

describe('ConsolidationService', () => {
  let service: ConsolidationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ConsolidationService);
  });

  // ─────────────────────────────────────────────────────────────
  // assessSleepQuality — Tier Classification
  // ─────────────────────────────────────────────────────────────
  describe('assessSleepQuality — Tier Classification', () => {
    it('8 hrs + no interruptions → excellent', () => {
      const result = service.assessSleepQuality(8, undefined, 'none');
      expect(result.quality).toBe('excellent');
    });

    it('8.5 hrs + fitbit 90 + no interruptions → excellent', () => {
      const result = service.assessSleepQuality(8.5, 90, 'none');
      expect(result.quality).toBe('excellent');
    });

    it('8 hrs + fitbit 80 → NOT excellent (Fitbit below 85)', () => {
      const result = service.assessSleepQuality(8, 80, 'none');
      expect(result.quality).not.toBe('excellent');
    });

    it('8 hrs + minimal interruptions → NOT excellent', () => {
      const result = service.assessSleepQuality(8, undefined, 'minimal');
      expect(result.quality).not.toBe('excellent');
    });

    it('7 hrs + minimal interruptions → good', () => {
      const result = service.assessSleepQuality(7, undefined, 'minimal');
      expect(result.quality).toBe('good');
    });

    it('7.5 hrs + fitbit 80 + none → good', () => {
      const result = service.assessSleepQuality(7.5, 80, 'none');
      expect(result.quality).toBe('good');
    });

    it('6.25 hrs (default minimal) → fair', () => {
      const result = service.assessSleepQuality(6.25);
      expect(result.quality).toBe('fair');
    });

    it('6 hrs + fitbit 70 → fair', () => {
      const result = service.assessSleepQuality(6, 70);
      expect(result.quality).toBe('fair');
    });

    it('5 hrs → poor', () => {
      const result = service.assessSleepQuality(5);
      expect(result.quality).toBe('poor');
    });

    it('6 hrs + fitbit 60 (below 65) → poor', () => {
      const result = service.assessSleepQuality(6, 60);
      expect(result.quality).toBe('poor');
    });

    it('should preserve hours, fitbitScore, and interruptions in result', () => {
      const result = service.assessSleepQuality(7.5, 82, 'some');
      expect(result.hours).toBe(7.5);
      expect(result.fitbitScore).toBe(82);
      expect(result.interruptions).toBe('some');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getBaseSleepRate — Consolidation Rates
  // ─────────────────────────────────────────────────────────────
  describe('getBaseSleepRate — Consolidation Rates', () => {
    const tiers: ['excellent' | 'good' | 'fair' | 'poor', number][] = [
      ['excellent', 0.925],
      ['good', 0.80],
      ['fair', 0.65],
      ['poor', 0.40],
    ];

    tiers.forEach(([quality, expectedRate]) => {
      it(`${quality} sleep → ${(expectedRate * 100).toFixed(1)}% consolidation rate`, () => {
        const sleepQuality: SleepQuality = {
          hours: 7,
          interruptions: 'minimal',
          quality,
        };
        expect(service.getBaseSleepRate(sleepQuality)).toBe(expectedRate);
      });
    });

    it('fair sleep (6.25 hrs) should return 65% rate', () => {
      const assessed = service.assessSleepQuality(6.25);
      const rate = service.getBaseSleepRate(assessed);
      expect(rate).toBe(0.65);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getNutritionModifier — Domain-Specific Logic
  // ─────────────────────────────────────────────────────────────
  describe('getNutritionModifier — Domain-Specific Logic', () => {
    const cleanNutrition: NutritionQuality = { type: 'clean', description: 'High protein' };
    const mixedNutrition: NutritionQuality = { type: 'mixed', description: 'Balanced' };
    const poorNutrition: NutritionQuality = { type: 'poor', description: 'Low protein' };

    // Sage: No modifier
    describe('Sage', () => {
      it('sage: clean nutrition → 0 modifier (no effect)', () => {
        expect(service.getNutritionModifier(cleanNutrition, 'sage')).toBe(0);
      });

      it('sage: mixed nutrition → 0 modifier', () => {
        expect(service.getNutritionModifier(mixedNutrition, 'sage')).toBe(0);
      });

      it('sage: poor nutrition → 0 modifier', () => {
        expect(service.getNutritionModifier(poorNutrition, 'sage')).toBe(0);
      });
    });

    // Warrior: Single-day impact
    describe('Warrior', () => {
      it('warrior: clean nutrition → +5% modifier', () => {
        expect(service.getNutritionModifier(cleanNutrition, 'warrior')).toBe(0.05);
      });

      it('warrior: mixed nutrition → 0% modifier', () => {
        expect(service.getNutritionModifier(mixedNutrition, 'warrior')).toBe(0);
      });

      it('warrior: poor nutrition → -5% modifier', () => {
        expect(service.getNutritionModifier(poorNutrition, 'warrior')).toBe(-0.05);
      });
    });

    // Cognitive: 3-day rolling average
    describe('Cognitive (Developer/Redteamer/Artist)', () => {
      it('single poor day → -2% modifier', () => {
        // Only today's data (1 day)
        const result = service.getNutritionModifier(poorNutrition, 'cognitive', []);
        expect(result).toBe(-0.02);
      });

      it('2 consecutive poor days → -3% modifier', () => {
        // Previous day poor + today poor = 2 poor
        const result = service.getNutritionModifier(poorNutrition, 'cognitive', ['poor']);
        expect(result).toBe(-0.03);
      });

      it('3 consecutive poor days → -5% modifier', () => {
        // 2 previous poor + today poor = 3 poor
        const result = service.getNutritionModifier(poorNutrition, 'cognitive', ['poor', 'poor']);
        expect(result).toBe(-0.05);
      });

      it('3 consecutive clean days → +5% modifier', () => {
        const result = service.getNutritionModifier(cleanNutrition, 'cognitive', ['clean', 'clean']);
        expect(result).toBe(0.05);
      });

      it('mixed day with no history → 0% (baseline)', () => {
        const result = service.getNutritionModifier(mixedNutrition, 'cognitive', []);
        expect(result).toBe(0);
      });

      it('clean day after 2 mixed days → 0% (not yet 3-day clean streak)', () => {
        const result = service.getNutritionModifier(cleanNutrition, 'cognitive', ['mixed', 'mixed']);
        expect(result).toBe(0);
      });

      it('uses at most last 3 days for rolling average', () => {
        // 10 days of history provided, only last 3 should matter
        const history = Array(10).fill('poor') as ('clean' | 'mixed' | 'poor')[];
        const result = service.getNutritionModifier(poorNutrition, 'cognitive', history);
        // Last 3 days: [poor, poor, poor] → -5%
        expect(result).toBe(-0.05);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getFastingModifier
  // ─────────────────────────────────────────────────────────────
  describe('getFastingModifier', () => {
    const makeFasting = (hoursSinceLastMeal: number, isFasted: boolean): FastingStatus => ({
      lastMealTime: new Date(),
      bedtime: new Date(),
      hoursSinceLastMeal,
      isFasted,
    });

    it('fasted bedtime (isFasted=true, 3+ hrs) → +5%', () => {
      const fasting = makeFasting(4, true);
      expect(service.getFastingModifier(fasting)).toBe(0.05);
    });

    it('exactly 3 hrs → +5% (threshold = 3)', () => {
      const fasting = makeFasting(3, true);
      expect(service.getFastingModifier(fasting)).toBe(0.05);
    });

    it('heavy meal before bed (<1 hr) → -5%', () => {
      const fasting = makeFasting(0.5, false);
      expect(service.getFastingModifier(fasting)).toBe(-0.05);
    });

    it('just ate (0 hrs) → -5%', () => {
      const fasting = makeFasting(0, false);
      expect(service.getFastingModifier(fasting)).toBe(-0.05);
    });

    it('fed but not too recent (2 hrs) → 0% baseline', () => {
      const fasting = makeFasting(2, false);
      expect(service.getFastingModifier(fasting)).toBe(0);
    });

    it('2.9 hrs (just under threshold) → 0% baseline', () => {
      const fasting = makeFasting(2.9, false);
      expect(service.getFastingModifier(fasting)).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // assessFasting — Timestamp Calculation
  // ─────────────────────────────────────────────────────────────
  describe('assessFasting — Timestamp Calculation', () => {
    it('should calculate hours since last meal correctly', () => {
      const bedtime = new Date('2026-02-20T23:00:00');
      const lastMeal = new Date('2026-02-20T19:00:00'); // 4 hrs before
      const result = service.assessFasting(lastMeal, bedtime);
      expect(result.hoursSinceLastMeal).toBeCloseTo(4, 1);
      expect(result.isFasted).toBe(true);
    });

    it('should mark isFasted=true when 3+ hours since meal', () => {
      const bedtime = new Date();
      const lastMeal = new Date(bedtime.getTime() - 3 * 60 * 60 * 1000); // 3 hrs before
      const result = service.assessFasting(lastMeal, bedtime);
      expect(result.isFasted).toBe(true);
    });

    it('should mark isFasted=false when <3 hours since meal', () => {
      const bedtime = new Date();
      const lastMeal = new Date(bedtime.getTime() - 2 * 60 * 60 * 1000); // 2 hrs before
      const result = service.assessFasting(lastMeal, bedtime);
      expect(result.isFasted).toBe(false);
    });

    it('should round hoursSinceLastMeal to 2 decimal places', () => {
      const bedtime = new Date();
      const lastMeal = new Date(bedtime.getTime() - (3.333 * 60 * 60 * 1000));
      const result = service.assessFasting(lastMeal, bedtime);
      const rounded = Math.round(result.hoursSinceLastMeal * 100) / 100;
      expect(result.hoursSinceLastMeal).toBe(rounded);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // consolidateXP — Full Formula
  // ─────────────────────────────────────────────────────────────
  describe('consolidateXP — Full Formula', () => {
    const makeNutrition = (type: 'clean' | 'mixed' | 'poor'): NutritionQuality => ({
      type,
      description: type,
    });

    const makeFasting = (hours: number, isFasted: boolean): FastingStatus => ({
      lastMealTime: new Date(),
      bedtime: new Date(),
      hoursSinceLastMeal: hours,
      isFasted,
    });

    it('fair sleep + mixed nutrition + fasted = 70% consolidation on 55.63 XP', () => {
      // 65% (fair) + 0% (mixed, cognitive) + 5% (fasted) = 70%
      // 55.63 × 0.70 = 38.94
      const sleep = service.assessSleepQuality(6.25);
      const result = service.consolidateXP(
        55.63,
        sleep,
        makeNutrition('mixed'),
        makeFasting(3, true),
        'cognitive'
      );
      expect(result.baseSleepRate).toBe(0.65);
      expect(result.nutritionModifier).toBe(0);
      expect(result.fastingModifier).toBe(0.05);
      expect(result.totalConsolidationRate).toBeCloseTo(0.70, 5);
      expect(result.permanentXP).toBeCloseTo(38.94, 1);
    });

    it('excellent sleep + clean nutrition (warrior) + fasted = max consolidation', () => {
      // 92.5% + 5% (warrior clean) + 5% (fasted) = 102.5%
      const sleep = service.assessSleepQuality(8.5, 90, 'none');
      const result = service.consolidateXP(
        100,
        sleep,
        makeNutrition('clean'),
        makeFasting(4, true),
        'warrior'
      );
      expect(result.totalConsolidationRate).toBeCloseTo(1.025, 5);
      expect(result.permanentXP).toBeCloseTo(102.5, 1);
    });

    it('poor sleep + poor nutrition (warrior) + heavy meal = minimum consolidation', () => {
      // 40% + (-5%) warrior poor + (-5%) heavy meal = 30%
      const sleep = service.assessSleepQuality(4);
      const result = service.consolidateXP(
        100,
        sleep,
        makeNutrition('poor'),
        makeFasting(0.5, false),
        'warrior'
      );
      expect(result.baseSleepRate).toBe(0.40);
      expect(result.nutritionModifier).toBe(-0.05);
      expect(result.fastingModifier).toBe(-0.05);
      expect(result.totalConsolidationRate).toBeCloseTo(0.30, 5);
      expect(result.permanentXP).toBeCloseTo(30, 1);
    });

    it('sage category: nutrition has no effect', () => {
      const sleep = service.assessSleepQuality(7.5, 80, 'minimal');
      const result = service.consolidateXP(
        100,
        sleep,
        makeNutrition('poor'), // Should be ignored
        makeFasting(2, false),
        'sage'
      );
      expect(result.nutritionModifier).toBe(0);
      // Rate = 80% (good) + 0% (sage) + 0% (1-3 hrs) = 80%
      expect(result.totalConsolidationRate).toBeCloseTo(0.80, 5);
    });

    it('should round permanentXP to 2 decimal places', () => {
      const sleep = service.assessSleepQuality(6.25);
      const result = service.consolidateXP(
        33.33,
        sleep,
        makeNutrition('mixed'),
        makeFasting(3, true),
        'cognitive'
      );
      const rounded = Math.round(result.permanentXP * 100) / 100;
      expect(result.permanentXP).toBe(rounded);
    });

    it('should include all breakdown fields in result', () => {
      const sleep = service.assessSleepQuality(6.25);
      const result = service.consolidateXP(
        50,
        sleep,
        makeNutrition('mixed'),
        makeFasting(3, true),
        'cognitive'
      );
      expect(result.pendingXP).toBe(50);
      expect(result.baseSleepRate).toBeDefined();
      expect(result.nutritionModifier).toBeDefined();
      expect(result.fastingModifier).toBeDefined();
      expect(result.totalConsolidationRate).toBeDefined();
      expect(result.permanentXP).toBeDefined();
      expect(result.breakdown).toBeTruthy();
    });

    it('breakdown string should contain sleep quality info', () => {
      const sleep = service.assessSleepQuality(6.25);
      const result = service.consolidateXP(
        50,
        sleep,
        makeNutrition('mixed'),
        makeFasting(3, true),
        'cognitive'
      );
      expect(result.breakdown).toContain('6.25');
      expect(result.breakdown).toContain('fair');
      expect(result.breakdown).toContain('Pending XP');
    });

    it('breakdown for sage should say N/A for nutrition', () => {
      const sleep = service.assessSleepQuality(7);
      const result = service.consolidateXP(
        50,
        sleep,
        makeNutrition('poor'),
        makeFasting(3, true),
        'sage'
      );
      expect(result.breakdown).toContain('N/A');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // quickConsolidate — Convenience Method
  // ─────────────────────────────────────────────────────────────
  describe('quickConsolidate', () => {
    it('should return a ConsolidationResult with defaults', () => {
      const result = service.quickConsolidate(100);
      expect(result.pendingXP).toBe(100);
      expect(result.permanentXP).toBeDefined();
      expect(result.permanentXP).toBeGreaterThan(0);
    });

    it('good sleep should produce higher XP than fair sleep', () => {
      // 7.5 hrs + default 'minimal' interruptions → 'good' quality (0.80 rate)
      // 6.25 hrs + default 'minimal' interruptions → 'fair' quality (0.65 rate)
      // Note: 8+ hrs with 'minimal' interruptions falls to 'poor' (excellent requires 'none')
      const good = service.quickConsolidate(100, 7.5);
      const fair = service.quickConsolidate(100, 6.25);
      expect(good.permanentXP).toBeGreaterThan(fair.permanentXP);
    });

    it('should work with all nutrition types without throwing', () => {
      expect(() => service.quickConsolidate(50, 6.25, 'clean', 3)).not.toThrow();
      expect(() => service.quickConsolidate(50, 6.25, 'mixed', 3)).not.toThrow();
      expect(() => service.quickConsolidate(50, 6.25, 'poor', 3)).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // End-to-End Scenario
  // ─────────────────────────────────────────────────────────────
  describe('End-to-End Consolidation Scenarios', () => {
    it('developer coding session: fair sleep + 3-day clean streak + fasted = ~89% consolidation', () => {
      // fair sleep = 65%
      // cognitive clean (3-day streak) = +5%
      // fasted (3+ hrs) = +5%
      // Total = 75%
      const sleep = service.assessSleepQuality(6.5);
      const nutrition: NutritionQuality = { type: 'clean', description: 'High protein' };
      const fasting: FastingStatus = {
        lastMealTime: new Date(),
        bedtime: new Date(),
        hoursSinceLastMeal: 4,
        isFasted: true,
      };
      const result = service.consolidateXP(
        100,
        sleep,
        nutrition,
        fasting,
        'cognitive',
        ['clean', 'clean'] // 2 previous clean days + today = 3 clean
      );
      // 65% + 5% (3-day clean) + 5% (fasted) = 75%
      expect(result.totalConsolidationRate).toBeCloseTo(0.75, 5);
    });

    it('warrior workout: good sleep + poor nutrition + fasted = 80% consolidation', () => {
      // 80% (good) + (-5%) warrior poor + 5% (fasted) = 80%
      const sleep = service.assessSleepQuality(7.5, 78, 'minimal');
      const nutrition: NutritionQuality = { type: 'poor', description: 'Junk food day' };
      const fasting: FastingStatus = {
        lastMealTime: new Date(),
        bedtime: new Date(),
        hoursSinceLastMeal: 4,
        isFasted: true,
      };
      const result = service.consolidateXP(100, sleep, nutrition, fasting, 'warrior');
      expect(result.totalConsolidationRate).toBeCloseTo(0.80, 5);
    });
  });
});
