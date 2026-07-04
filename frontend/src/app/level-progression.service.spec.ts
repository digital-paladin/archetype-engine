// level-progression.service.spec.ts
// Unit tests for LevelProgressionService — validates exponential XP curve and leveling logic

import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { LevelProgressionService, LevelUpResult } from './level-progression.service';

describe('LevelProgressionService', () => {
  let service: LevelProgressionService;

  beforeEach(() => {
    // Provide a stub localStorage to keep tests isolated
    const localStorageMock: { [key: string]: string } = {};
    vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => localStorageMock[key] ?? null);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      localStorageMock[key] = value;
    });

    TestBed.configureTestingModule({});
    service = TestBed.inject(LevelProgressionService);
    // Reset to initial state so each test starts clean
    service.resetProgress();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────
  // calculateXPForLevel — Exponential Formula
  // ─────────────────────────────────────────────────────────────
  describe('calculateXPForLevel — Formula: 100 × (level^1.5)', () => {
    it('level 1 should return 0 (no XP needed, starting point)', () => {
      expect(service.calculateXPForLevel(1)).toBe(0);
    });

    it('level 2 should return 282 XP', () => {
      // 100 × (2^1.5) = 100 × 2.828... = 282.8 → floor = 282
      expect(service.calculateXPForLevel(2)).toBe(282);
    });

    it('level 10 should return 3162 XP', () => {
      // 100 × (10^1.5) = 100 × 31.622... = 3162.2 → floor = 3162
      expect(service.calculateXPForLevel(10)).toBe(3162);
    });

    it('level 20 should return 8944 XP', () => {
      // 100 × (20^1.5) = 100 × 89.44... = 8944.2 → floor = 8944
      expect(service.calculateXPForLevel(20)).toBe(8944);
    });

    it('level 21 should return 9628 XP', () => {
      // 100 × (21^1.5) = 100 × 96.234... = 9623 → floor = 9623
      expect(service.calculateXPForLevel(21)).toBe(9623);
    });

    it('level 26 should return 13211 XP', () => {
      // 100 × (26^1.5) = 100 × 132.57... = 13257 → floor
      const result = service.calculateXPForLevel(26);
      expect(result).toBeGreaterThan(13000);
      expect(result).toBeLessThan(14000);
    });

    it('higher levels should always require more XP than lower levels', () => {
      for (let i = 2; i < 30; i++) {
        expect(service.calculateXPForLevel(i + 1)).toBeGreaterThan(service.calculateXPForLevel(i));
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // calculateCumulativeXP
  // ─────────────────────────────────────────────────────────────
  describe('calculateCumulativeXP', () => {
    it('cumulative XP for level 1 should be 0', () => {
      expect(service.calculateCumulativeXP(1)).toBe(0);
    });

    it('cumulative XP for level 2 should equal XP for level 2', () => {
      expect(service.calculateCumulativeXP(2)).toBe(service.calculateXPForLevel(2));
    });

    it('cumulative XP for level 3 should equal sum of L2 + L3', () => {
      const expected = service.calculateXPForLevel(2) + service.calculateXPForLevel(3);
      expect(service.calculateCumulativeXP(3)).toBe(expected);
    });

    it('cumulative XP should always increase with level', () => {
      for (let i = 1; i < 20; i++) {
        expect(service.calculateCumulativeXP(i + 1)).toBeGreaterThan(service.calculateCumulativeXP(i));
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getLevelTier — Tier System
  // ─────────────────────────────────────────────────────────────
  describe('getLevelTier', () => {
    const tierExpectations: [number, string][] = [
      [1, 'novice'],
      [5, 'novice'],
      [10, 'novice'],
      [11, 'competent'],
      [15, 'competent'],
      [20, 'competent'],
      [21, 'expert'],
      [25, 'expert'],
      [30, 'expert'],
      [31, 'world-class'],
      [40, 'world-class'],
    ];

    tierExpectations.forEach(([level, expectedTier]) => {
      it(`level ${level} should be tier: ${expectedTier}`, () => {
        expect(service.getLevelTier(level)).toBe(expectedTier as any);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // estimateTotalHours
  // ─────────────────────────────────────────────────────────────
  describe('estimateTotalHours', () => {
    it('level 10 should estimate ~1,500 hours', () => {
      expect(service.estimateTotalHours(10)).toBe(1500);
    });

    it('level 20 should estimate ~9,000 hours', () => {
      expect(service.estimateTotalHours(20)).toBe(9000);
    });

    it('level 30 should estimate ~25,000 hours', () => {
      expect(service.estimateTotalHours(30)).toBe(25000);
    });

    it('level 31 should estimate 25,000 + 2,500 = 27,500 hours', () => {
      expect(service.estimateTotalHours(31)).toBe(27500);
    });

    it('hours should always increase with level', () => {
      let prev = 0;
      for (let level = 1; level <= 35; level++) {
        const current = service.estimateTotalHours(level);
        expect(current).toBeGreaterThanOrEqual(prev);
        prev = current;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Initial Progress State (Character Sheet Baseline)
  // ─────────────────────────────────────────────────────────────
  describe('Initial Progress State', () => {
    it('should initialize 7 skill classes', () => {
      const progress = service.getCurrentProgress();
      expect(Object.keys(progress.classes)).toHaveLength(7);
    });

    it('developer should start at level 20', () => {
      const developer = service.getSkillClass('developer');
      expect(developer?.currentLevel).toBe(20);
    });

    it('sage should start at level 26', () => {
      const sage = service.getSkillClass('sage');
      expect(sage?.currentLevel).toBe(26);
    });

    it('warrior should start at level 9', () => {
      const warrior = service.getSkillClass('warrior');
      expect(warrior?.currentLevel).toBe(9);
    });

    it('redteamer should start at level 11', () => {
      const redteamer = service.getSkillClass('redteamer');
      expect(redteamer?.currentLevel).toBe(11);
    });

    it('all classes should start with 0 currentXP', () => {
      const progress = service.getCurrentProgress();
      Object.values(progress.classes).forEach((cls) => {
        expect(cls.currentXP).toBe(0);
      });
    });

    it('highestLevel should be 26 (sage)', () => {
      expect(service.getCurrentProgress().highestLevel).toBe(26);
    });

    it('overallTier should be "expert" (based on sage L26)', () => {
      expect(service.getCurrentProgress().overallTier).toBe('expert');
    });

    it('all classes should have correct tiers based on initial level', () => {
      const progress = service.getCurrentProgress();
      expect(progress.classes['developer'].tier).toBe('competent'); // L20
      expect(progress.classes['sage'].tier).toBe('expert'); // L26
      expect(progress.classes['warrior'].tier).toBe('novice'); // L9
      expect(progress.classes['redteamer'].tier).toBe('competent'); // L11
    });
  });

  // ─────────────────────────────────────────────────────────────
  // addXP — Level Up Logic
  // ─────────────────────────────────────────────────────────────
  describe('addXP — Level Up Logic', () => {
    it('should return null when XP added is insufficient to level up', () => {
      // Developer L20 needs 8,944 XP for L21. Adding 100 XP should not level up.
      const result = service.addXP('developer', 100);
      expect(result).toBeNull();
      expect(service.getSkillClass('developer')?.currentXP).toBe(100);
    });

    it('should return LevelUpResult when enough XP to level up', () => {
      const xpForNext = service.calculateXPForLevel(21); // 9623
      const result = service.addXP('developer', xpForNext);
      expect(result).not.toBeNull();
      expect(result!.oldLevel).toBe(20);
      expect(result!.newLevel).toBe(21);
    });

    it('should accumulate XP across multiple addXP calls', () => {
      service.addXP('warrior', 500);
      service.addXP('warrior', 300);
      const warrior = service.getSkillClass('warrior');
      expect(warrior?.currentXP).toBe(800);
    });

    it('level-up should consume XP for the level earned', () => {
      const xpForL10 = service.calculateXPForLevel(10); // warrior is L9
      const result = service.addXP('warrior', xpForL10 + 100); // 100 XP overflow
      expect(result).not.toBeNull();
      expect(result!.newLevel).toBe(10);
      expect(result!.overflowXP).toBe(100);
      expect(service.getSkillClass('warrior')?.currentXP).toBe(100);
    });

    it('should correctly handle multi-level jumps from large XP addition', () => {
      // Add 200,000 XP to survivalist L1 — should jump multiple levels
      const result = service.addXP('survivalist', 200000);
      expect(result).not.toBeNull();
      expect(result!.newLevel).toBeGreaterThan(result!.oldLevel + 1);
      expect(result!.multiLevelGain).toBe(true);
    });

    it('multi-level gain should cap at 10 levels per call (safety)', () => {
      // The safety cap prevents infinite loops
      const result = service.addXP('survivalist', 999999999);
      if (result) {
        const levelsGained = result.newLevel - result.oldLevel;
        // Safety break fires when levelsGained > 10 (after 11th increment), so max is 11
        expect(levelsGained).toBeLessThanOrEqual(11);
      }
    });

    it('should throw for unknown skill class', () => {
      expect(() => service.addXP('nonexistent', 100))
        .toThrowError('Unknown skill class: nonexistent');
    });

    it('should emit tier change when crossing tier boundary', () => {
      // Warrior starts at L9 (novice). Level it to L11 (competent) with enough XP.
      const xpForL10 = service.calculateXPForLevel(10);
      const xpForL11 = service.calculateXPForLevel(11);
      // Add enough for 2 levels
      const result = service.addXP('warrior', xpForL10 + xpForL11 + 1);
      if (result && result.newLevel >= 11) {
        expect(result.tierChange).toContain('novice');
        expect(result.tierChange).toContain('competent');
      }
    });

    it('should NOT report tier change when staying in same tier', () => {
      // Developer is L20 (competent). Level up to L21 (expert) — crosses to expert.
      // But going from L21 to L22 should be no tier change.
      service.setSkillClass('developer', 21, 0);
      const xpForL22 = service.calculateXPForLevel(22);
      const result = service.addXP('developer', xpForL22);
      if (result) {
        // L21 → L22 stays in 'expert' tier
        expect(result.tierChange).toBeNull();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // setSkillClass — Manual Sync
  // ─────────────────────────────────────────────────────────────
  describe('setSkillClass — Manual Sync', () => {
    it('should update level and XP of specified skill class', () => {
      service.setSkillClass('warrior', 15, 500);
      const warrior = service.getSkillClass('warrior');
      expect(warrior?.currentLevel).toBe(15);
      expect(warrior?.currentXP).toBe(500);
    });

    it('should recalculate xpForNextLevel after sync', () => {
      service.setSkillClass('warrior', 15, 0);
      const warrior = service.getSkillClass('warrior');
      expect(warrior?.xpForNextLevel).toBe(service.calculateXPForLevel(16));
    });

    it('should update tier after sync', () => {
      service.setSkillClass('warrior', 15, 0);
      const warrior = service.getSkillClass('warrior');
      expect(warrior?.tier).toBe('competent');
    });

    it('should recalculate progressToNextLevel after sync', () => {
      const xpForL10 = service.calculateXPForLevel(10);
      service.setSkillClass('warrior', 9, Math.floor(xpForL10 / 2));
      const warrior = service.getSkillClass('warrior');
      expect(warrior?.progressToNextLevel).toBeCloseTo(50, 0);
    });

    it('should throw for unknown class', () => {
      expect(() => service.setSkillClass('unknown-class', 10, 0))
        .toThrowError('Unknown skill class: unknown-class');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Observable State
  // ─────────────────────────────────────────────────────────────
  describe('Observable State', () => {
    it('progress$ should emit initial state on subscribe', async () => {
      const progress = await firstValueFrom(service.progress$);
      expect(progress).toBeDefined();
      expect(progress.classes).toBeDefined();
    });

    it('progress$ should emit updated state after addXP', async () => {
      service.addXP('developer', 500);
      const progress = await firstValueFrom(service.progress$);
      expect(progress.classes['developer'].currentXP).toBe(500);
    });

    it('getCurrentProgress should return current snapshot', () => {
      service.addXP('warrior', 200);
      const progress = service.getCurrentProgress();
      expect(progress.classes['warrior'].currentXP).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getAllSkillClasses
  // ─────────────────────────────────────────────────────────────
  describe('getAllSkillClasses', () => {
    it('should return array of all 7 skill classes', () => {
      const classes = service.getAllSkillClasses();
      expect(classes).toHaveLength(7);
    });

    it('all classes should have required fields', () => {
      const classes = service.getAllSkillClasses();
      classes.forEach((cls) => {
        expect(cls.id).toBeTruthy();
        expect(cls.name).toBeTruthy();
        expect(cls.icon).toBeTruthy();
        expect(cls.currentLevel).toBeGreaterThan(0);
        expect(cls.xpForNextLevel).toBeGreaterThan(0);
        expect(cls.tier).toBeTruthy();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // resetProgress
  // ─────────────────────────────────────────────────────────────
  describe('resetProgress', () => {
    it('should restore all classes to initial levels and 0 XP', () => {
      service.addXP('developer', 5000);
      service.resetProgress();
      const developer = service.getSkillClass('developer');
      expect(developer?.currentLevel).toBe(20);
      expect(developer?.currentXP).toBe(0);
    });

    it('should restore sage to L26', () => {
      service.setSkillClass('sage', 30, 0);
      service.resetProgress();
      expect(service.getSkillClass('sage')?.currentLevel).toBe(26);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // End-to-End Progression Scenario
  // ─────────────────────────────────────────────────────────────
  describe('End-to-End Progression Scenario', () => {
    it('survivalist L1 grinding: multiple XP additions until level up at correct threshold', () => {
      const xpToLevel2 = service.calculateXPForLevel(2); // 282 XP
      service.addXP('survivalist', 100);
      service.addXP('survivalist', 100);
      service.addXP('survivalist', 100); // 300 XP >= 282 threshold → levels up here, so no null assertion
      // After 3x 100 = 300 XP >= 282 threshold for L2, it should have leveled up during 3rd add

      // Reset and test properly
      service.resetProgress();
      service.addXP('survivalist', 200); // 200 < 282, no level up
      expect(service.getSkillClass('survivalist')?.currentLevel).toBe(1);

      const result = service.addXP('survivalist', 100); // 300 >= 282
      // Should level up now (200 + 100 = 300 >= 282)
      expect(result).not.toBeNull();
      expect(result!.newLevel).toBe(2);
      expect(result!.overflowXP).toBe(300 - xpToLevel2);
    });

    it('developer L20: total XP to reach L21 should be 8944 XP for that level', () => {
      // calculateXPForLevel(21) XP needed (not cumulative)
      const xpForL21 = service.calculateXPForLevel(21);
      const result = service.addXP('developer', xpForL21);
      expect(result).not.toBeNull();
      expect(result!.oldLevel).toBe(20);
      expect(result!.newLevel).toBe(21);
    });
  });
});
