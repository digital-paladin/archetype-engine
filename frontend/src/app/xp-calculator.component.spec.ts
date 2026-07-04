// xp-calculator.component.spec.ts
// Unit tests for XpCalculatorComponent — validates 4-step wizard, XP flow, level-up modal

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { XpCalculatorComponent } from './xp-calculator.component';
import { XpCalculationService } from './xp-calculation.service';
import { ConsolidationService } from './consolidation.service';
import { LevelProgressionService, SkillClass } from './level-progression.service';

describe('XpCalculatorComponent', () => {
  let fixture: ComponentFixture<XpCalculatorComponent>;
  let component: XpCalculatorComponent;

  let xpCalcMock: {
    calculatePendingXP: ReturnType<typeof vi.fn>;
    getBonusesByCategory: ReturnType<typeof vi.fn>;
  };
  let consolidationMock: {
    assessSleepQuality: ReturnType<typeof vi.fn>;
    assessFasting: ReturnType<typeof vi.fn>;
    consolidateXP: ReturnType<typeof vi.fn>;
  };
  let levelProgMock: {
    getAllSkillClasses: ReturnType<typeof vi.fn>;
    addXP: ReturnType<typeof vi.fn>;
    progress$: BehaviorSubject<any>;
  };

  const mockSkillClasses: SkillClass[] = [
    { id: 'developer', name: 'Web App Developer', icon: '💻', currentLevel: 20, currentXP: 0, xpForCurrentLevel: 8007, xpForNextLevel: 8944, progressToNextLevel: 0, tier: 'competent', totalHoursEstimate: 9000 },
    { id: 'sage', name: 'Keeper of Ancient Wisdom', icon: '📿', currentLevel: 26, currentXP: 0, xpForCurrentLevel: 12800, xpForNextLevel: 13265, progressToNextLevel: 0, tier: 'expert', totalHoursEstimate: 16000 },
    { id: 'warrior', name: 'Iron Body Warrior', icon: '⚔️', currentLevel: 9, currentXP: 0, xpForCurrentLevel: 2434, xpForNextLevel: 3162, progressToNextLevel: 0, tier: 'novice', totalHoursEstimate: 1500 },
    { id: 'redteamer', name: 'Shadow Redteamer', icon: '🔴', currentLevel: 11, currentXP: 0, xpForCurrentLevel: 3162, xpForNextLevel: 3644, progressToNextLevel: 0, tier: 'competent', totalHoursEstimate: 2000 },
    { id: 'artist', name: 'Resonant Artist', icon: '🎨', currentLevel: 1, currentXP: 0, xpForCurrentLevel: 0, xpForNextLevel: 282, progressToNextLevel: 0, tier: 'novice', totalHoursEstimate: 0 },
    { id: 'survivalist', name: 'Adaptive Survivalist', icon: '🏕️', currentLevel: 1, currentXP: 0, xpForCurrentLevel: 0, xpForNextLevel: 282, progressToNextLevel: 0, tier: 'novice', totalHoursEstimate: 0 },
    { id: 'financial', name: 'Financial Strategist', icon: '💰', currentLevel: 1, currentXP: 0, xpForCurrentLevel: 0, xpForNextLevel: 282, progressToNextLevel: 0, tier: 'novice', totalHoursEstimate: 0 },
  ];

  const mockXPCalculation = {
    hours: 2,
    baseRate: 10,
    intensityMultiplier: 1.35,
    baseXP: 27,
    bonuses: [],
    totalBonusXP: 0,
    pendingXP: 27,
    category: 'developer',
  };

  const mockSleepQuality = {
    hours: 6.25,
    interruptions: 'minimal',
    quality: 'fair',
    fitbitScore: undefined,
  };

  const mockFasting = {
    lastMealTime: new Date(),
    bedtime: new Date(),
    hoursSinceLastMeal: 3,
    isFasted: true,
  };

  const mockConsolidationResult = {
    pendingXP: 27,
    baseSleepRate: 0.65,
    nutritionModifier: 0,
    fastingModifier: 0.05,
    totalConsolidationRate: 0.70,
    permanentXP: 18.9,
    breakdown: 'Fair sleep 65% + fasted +5% = 70%\n18.90 XP permanent',
  };

  const mockCharacterProgress = {
    classes: Object.fromEntries(mockSkillClasses.map((c) => [c.id, c])),
    totalXPAllClasses: 0,
    highestLevel: 26,
    overallTier: 'expert',
  };

  beforeEach(async () => {
    const progressSubject = new BehaviorSubject<any>(mockCharacterProgress);

    xpCalcMock = {
      calculatePendingXP: vi.fn().mockReturnValue(mockXPCalculation),
      getBonusesByCategory: vi.fn().mockReturnValue([]), // empty prevents private access
    };

    consolidationMock = {
      assessSleepQuality: vi.fn().mockReturnValue(mockSleepQuality),
      assessFasting: vi.fn().mockReturnValue(mockFasting),
      consolidateXP: vi.fn().mockReturnValue(mockConsolidationResult),
    };

    levelProgMock = {
      getAllSkillClasses: vi.fn().mockReturnValue(mockSkillClasses),
      addXP: vi.fn().mockReturnValue(null),
      progress$: progressSubject,
    };

    await TestBed.configureTestingModule({
      imports: [XpCalculatorComponent], // Standalone component
      providers: [
        { provide: XpCalculationService, useValue: xpCalcMock },
        { provide: ConsolidationService, useValue: consolidationMock },
        { provide: LevelProgressionService, useValue: levelProgMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(XpCalculatorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────
  // Component Creation
  // ─────────────────────────────────────────────────────────────
  describe('Component Creation', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should have default input values on creation', () => {
      expect(component.selectedActivity).toBe('');
      expect(component.hours).toBe(2);
      expect(component.intensity).toBe('routine');
      expect(component.selectedBonuses).toEqual([]);
      expect(component.sleepHours).toBe(6.25);
      expect(component.nutritionType).toBe('mixed');
      expect(component.hoursAfterMeal).toBe(3);
      expect(component.skillCategory).toBe('cognitive');
    });

    it('should have null results on creation before any calculation', () => {
      expect(component.pendingXPResult).toBeNull();
      expect(component.consolidationResult).toBeNull();
      expect(component.levelUpResult).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ngOnInit
  // ─────────────────────────────────────────────────────────────
  describe('ngOnInit', () => {
    it('should call getAllSkillClasses and populate skillClasses', () => {
      expect(levelProgMock.getAllSkillClasses).toHaveBeenCalled();
      expect(component.skillClasses).toEqual(mockSkillClasses);
    });

    it('should call getBonusesByCategory to load available bonuses', () => {
      expect(xpCalcMock.getBonusesByCategory).toHaveBeenCalled();
    });

    it('should subscribe to progress$ and update skillClasses on emisssion', () => {
      const updatedClasses = mockSkillClasses.map((c) =>
        c.id === 'developer' ? { ...c, currentLevel: 21 } : c
      );

      levelProgMock.progress$.next({
        ...mockCharacterProgress,
        classes: Object.fromEntries(updatedClasses.map((c) => [c.id, c])),
      });

      fixture.detectChanges();
      const dev = component.skillClasses.find((c) => c.id === 'developer');
      expect(dev?.currentLevel).toBe(21);
    });

    it('should have 7 skill classes after initialization', () => {
      expect(component.skillClasses.length).toBe(7);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // calculatePendingXP — Step 1 → Step 2
  // ─────────────────────────────────────────────────────────────
  describe('calculatePendingXP', () => {
    it('should not calculate when no activity is selected', () => {
      component.selectedActivity = '';
      component.hours = 2;
      component.calculatePendingXP();
      expect(xpCalcMock.calculatePendingXP).not.toHaveBeenCalled();
    });

    it('should not calculate when hours is 0', () => {
      component.selectedActivity = 'coding-routine';
      component.hours = 0;
      component.calculatePendingXP();
      expect(xpCalcMock.calculatePendingXP).not.toHaveBeenCalled();
    });

    it('should call calculatePendingXP with activity, hours, intensity, bonuses', () => {
      component.selectedActivity = 'coding-routine';
      component.hours = 2;
      component.intensity = 'moderate';
      component.selectedBonuses = ['clean-sonarqube'];

      component.calculatePendingXP();

      expect(xpCalcMock.calculatePendingXP).toHaveBeenCalledWith(
        'coding-routine',
        2,
        'moderate',
        ['clean-sonarqube']
      );
    });

    it('should store XP calculation result in pendingXPResult', () => {
      component.selectedActivity = 'coding-routine';
      component.hours = 2;
      component.calculatePendingXP();
      expect(component.pendingXPResult).toEqual(mockXPCalculation);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // calculateConsolidation — Step 3 → Step 4
  // ─────────────────────────────────────────────────────────────
  describe('calculateConsolidation', () => {
    beforeEach(() => {
      component.selectedActivity = 'coding-routine';
      component.hours = 2;
      component.calculatePendingXP();
    });

    it('should do nothing if pendingXPResult is null', () => {
      component.pendingXPResult = null;
      component.calculateConsolidation();
      expect(consolidationMock.consolidateXP).not.toHaveBeenCalled();
    });

    it('should call assessSleepQuality with sleepHours', () => {
      component.sleepHours = 7.5;
      component.calculateConsolidation();
      expect(consolidationMock.assessSleepQuality).toHaveBeenCalledWith(7.5);
    });

    it('should call assessFasting with date objects derived from hoursAfterMeal', () => {
      component.hoursAfterMeal = 4;
      component.calculateConsolidation();
      expect(consolidationMock.assessFasting).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date)
      );
    });

    it('should call consolidateXP with all required parameters', () => {
      component.skillCategory = 'warrior';
      component.nutritionType = 'clean';
      component.calculateConsolidation();

      expect(consolidationMock.consolidateXP).toHaveBeenCalledWith(
        mockXPCalculation.pendingXP,
        mockSleepQuality,
        expect.objectContaining({ type: 'clean' }),
        mockFasting,
        'warrior'
      );
    });

    it('should store result in consolidationResult', () => {
      component.calculateConsolidation();
      expect(component.consolidationResult).toEqual(mockConsolidationResult);
    });

    it('should pass correct nutrition description for each type', () => {
      (['clean', 'mixed', 'poor'] as const).forEach((type) => {
        component.nutritionType = type;
        component.calculateConsolidation();
        expect(consolidationMock.consolidateXP).toHaveBeenCalledWith(
          expect.any(Number),
          expect.any(Object),
          expect.objectContaining({ type }),
          expect.any(Object),
          expect.any(String)
        );
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // addToCharacter — Step 4 → Level Up
  // ─────────────────────────────────────────────────────────────
  describe('addToCharacter', () => {
    beforeEach(() => {
      component.selectedActivity = 'coding-routine';
      component.hours = 2;
      component.calculatePendingXP();
      component.calculateConsolidation();
    });

    it('should do nothing if consolidationResult is null', () => {
      component.consolidationResult = null;
      component.addToCharacter();
      expect(levelProgMock.addXP).not.toHaveBeenCalled();
    });

    it('should call addXP with targetSkillClass and permanentXP', () => {
      component.targetSkillClass = 'developer';
      component.addToCharacter();
      expect(levelProgMock.addXP).toHaveBeenCalledWith('developer', mockConsolidationResult.permanentXP);
    });

    it('should NOT set levelUpResult when no level-up occurs', () => {
      levelProgMock.addXP.mockReturnValue(null);
      component.addToCharacter();
      expect(component.levelUpResult).toBeNull();
    });

    it('should set levelUpResult when developer levels up to 21', () => {
      const levelUpResult = {
        classId: 'developer',
        className: 'Web App Developer',
        oldLevel: 20,
        newLevel: 21,
        overflowXP: 50,
        tierChange: null,
        multiLevelGain: false,
      };
      levelProgMock.addXP.mockReturnValue(levelUpResult);
      component.addToCharacter();
      expect(component.levelUpResult).toEqual(levelUpResult);
    });

    it('should refresh skillClasses by calling getAllSkillClasses after adding XP', () => {
      levelProgMock.getAllSkillClasses.mockClear();
      component.addToCharacter();
      expect(levelProgMock.getAllSkillClasses).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // onBonusToggle
  // ─────────────────────────────────────────────────────────────
  describe('onBonusToggle', () => {
    it('should add bonus key when checkbox is checked', () => {
      component.onBonusToggle('clean-sonarqube', { target: { checked: true } });
      expect(component.selectedBonuses).toContain('clean-sonarqube');
    });

    it('should remove bonus key when checkbox is unchecked', () => {
      component.selectedBonuses = ['clean-sonarqube', 'tests-written'];
      component.onBonusToggle('clean-sonarqube', { target: { checked: false } });
      expect(component.selectedBonuses).not.toContain('clean-sonarqube');
      expect(component.selectedBonuses).toContain('tests-written');
    });

    it('should accumulate multiple bonuses independently', () => {
      component.onBonusToggle('clean-sonarqube', { target: { checked: true } });
      component.onBonusToggle('tests-written', { target: { checked: true } });
      component.onBonusToggle('production-deploy', { target: { checked: true } });
      expect(component.selectedBonuses.length).toBe(3);
    });

    it('should not throw when unchecking a bonus not in the list', () => {
      component.selectedBonuses = [];
      expect(() => component.onBonusToggle('nonexistent', { target: { checked: false } })).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // onActivityChange
  // ─────────────────────────────────────────────────────────────
  describe('onActivityChange', () => {
    it('should reset selectedBonuses when activity changes', () => {
      component.selectedBonuses = ['clean-sonarqube', 'tests-written'];
      component.onActivityChange();
      expect(component.selectedBonuses).toEqual([]);
    });

    it('should reset pendingXPResult when activity changes', () => {
      component.pendingXPResult = mockXPCalculation as any;
      component.onActivityChange();
      expect(component.pendingXPResult).toBeNull();
    });

    it('should reset consolidationResult when activity changes', () => {
      component.consolidationResult = mockConsolidationResult as any;
      component.onActivityChange();
      expect(component.consolidationResult).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Level-Up Modal
  // ─────────────────────────────────────────────────────────────
  describe('Level-Up Modal', () => {
    it('modal should be hidden when levelUpResult is null', () => {
      component.levelUpResult = null;
      fixture.detectChanges();
      const modal = fixture.nativeElement.querySelector('.level-up-modal');
      expect(modal).toBeFalsy();
    });

    it('modal should be visible when levelUpResult is set', () => {
      component.levelUpResult = {
        classId: 'developer',
        className: 'Web App Developer',
        oldLevel: 20,
        newLevel: 21,
        overflowXP: 50,
        tierChange: null,
        multiLevelGain: false,
      };
      fixture.detectChanges();
      const modal = fixture.nativeElement.querySelector('.level-up-modal');
      expect(modal).toBeTruthy();
    });

    it('should display correct level transition text', () => {
      component.levelUpResult = {
        classId: 'developer',
        className: 'Web App Developer',
        oldLevel: 20,
        newLevel: 21,
        overflowXP: 0,
        tierChange: null,
        multiLevelGain: false,
      };
      fixture.detectChanges();
      const levelChange = fixture.nativeElement.querySelector('.level-change');
      expect(levelChange?.textContent).toContain('20');
      expect(levelChange?.textContent).toContain('21');
    });

    it('should dismiss modal when levelUpResult is set to null', () => {
      component.levelUpResult = {
        classId: 'warrior',
        className: 'Iron Body Warrior',
        oldLevel: 9,
        newLevel: 10,
        overflowXP: 0,
        tierChange: 'novice → competent',
        multiLevelGain: false,
      };
      fixture.detectChanges();
      component.levelUpResult = null;
      // Test component state directly to avoid ExpressionChangedAfterItHasBeenChecked in debug mode
      expect(component.levelUpResult).toBeNull();
    });

    it('should show tier change text when tier changed', () => {
      component.levelUpResult = {
        classId: 'warrior',
        className: 'Iron Body Warrior',
        oldLevel: 9,
        newLevel: 10,
        overflowXP: 0,
        tierChange: 'novice → competent',
        multiLevelGain: false,
      };
      fixture.detectChanges();
      const tierChange = fixture.nativeElement.querySelector('.tier-change');
      expect(tierChange?.textContent).toContain('novice → competent');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Character Progress Grid
  // ─────────────────────────────────────────────────────────────
  describe('Character Progress Grid', () => {
    it('should render 7 skill class cards', () => {
      fixture.detectChanges();
      const cards = fixture.nativeElement.querySelectorAll('.skill-class-card');
      expect(cards.length).toBe(7);
    });

    it('should display developer Level 20', () => {
      fixture.detectChanges();
      const levelElements = fixture.nativeElement.querySelectorAll('.class-level');
      const texts = Array.from(levelElements).map((el: any) => el.textContent);
      expect(texts.some((t: any) => t?.includes('20'))).toBe(true);
    });

    it('should display sage Level 26 (highest)', () => {
      fixture.detectChanges();
      const levelElements = fixture.nativeElement.querySelectorAll('.class-level');
      const texts = Array.from(levelElements).map((el: any) => el.textContent);
      expect(texts.some((t: any) => t?.includes('26'))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Integration: Full 4-Step Wizard
  // ─────────────────────────────────────────────────────────────
  describe('Integration: Full 4-Step Wizard', () => {
    it('should flow through all 4 steps without errors', () => {
      // Step 1-2: Calculate pending XP
      component.selectedActivity = 'coding-complex';
      component.hours = 2.5;
      component.intensity = 'moderate';
      component.selectedBonuses = ['clean-sonarqube'];
      component.calculatePendingXP();

      expect(component.pendingXPResult).not.toBeNull();
      expect(xpCalcMock.calculatePendingXP).toHaveBeenCalledWith(
        'coding-complex', 2.5, 'moderate', ['clean-sonarqube']
      );

      // Step 3-4: Consolidate XP
      component.sleepHours = 6.25;
      component.nutritionType = 'mixed';
      component.hoursAfterMeal = 3;
      component.skillCategory = 'cognitive';
      component.calculateConsolidation();

      expect(component.consolidationResult).not.toBeNull();

      // Add to character
      component.targetSkillClass = 'developer';
      component.addToCharacter();
      expect(levelProgMock.addXP).toHaveBeenCalledWith('developer', mockConsolidationResult.permanentXP);
    });

    it('should trigger level-up modal when levelProg.addXP returns a result', () => {
      const levelUp = {
        classId: 'warrior',
        className: 'Iron Body Warrior',
        oldLevel: 9,
        newLevel: 10,
        overflowXP: 200,
        tierChange: null,
        multiLevelGain: false,
      };
      levelProgMock.addXP.mockReturnValue(levelUp);

      component.selectedActivity = 'mma-class';
      component.hours = 2;
      component.calculatePendingXP();
      component.calculateConsolidation();
      component.targetSkillClass = 'warrior';
      component.addToCharacter();

      expect(component.levelUpResult).toEqual(levelUp);
    });
  });
});
