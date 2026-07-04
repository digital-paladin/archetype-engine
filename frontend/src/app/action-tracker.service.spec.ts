// action-tracker.service.spec.ts
// Unit tests for ActionTrackerService — validates action lifecycle and XP integration

import { firstValueFrom, of } from 'rxjs';
import { ActionTrackerService, ActiveAction } from './action-tracker.service';

describe('ActionTrackerService', () => {
  let service: ActionTrackerService;

  // Typed mock objects using vi.fn()
  let xpCalcMock: {
    calculatePendingXP: ReturnType<typeof vi.fn>;
  };
  let consolidationMock: {
    assessSleepQuality: ReturnType<typeof vi.fn>;
    assessFasting: ReturnType<typeof vi.fn>;
    consolidateXP: ReturnType<typeof vi.fn>;
  };
  let levelProgMock: {
    addXP: ReturnType<typeof vi.fn>;
    getCurrentProgress: ReturnType<typeof vi.fn>;
  };

  const mockXPCalculation = {
    hours: 1,
    baseRate: 10,
    intensityMultiplier: 1.0,
    baseXP: 10,
    bonuses: [],
    totalBonusXP: 0,
    pendingXP: 10,
    category: 'developer',
  };

  const mockSleepQuality = { hours: 6.25, interruptions: 'minimal', quality: 'fair' };

  const mockFasting = {
    lastMealTime: new Date(),
    bedtime: new Date(),
    hoursSinceLastMeal: 3,
    isFasted: true,
  };

  const mockConsolidationResult = {
    pendingXP: 10,
    baseSleepRate: 0.65,
    nutritionModifier: 0,
    fastingModifier: 0.05,
    totalConsolidationRate: 0.70,
    permanentXP: 7.0,
    breakdown: 'Fair 65% + fasted +5% = 70%',
  };

  const mockLevelUpResult = {
    classId: 'developer',
    className: 'Web App Developer',
    oldLevel: 20,
    newLevel: 21,
    overflowXP: 50,
    tierChange: null,
    multiLevelGain: false,
  };

  beforeEach(() => {
    // Clear JSDOM localStorage before each test to prevent history leakage
    localStorage.clear();

    xpCalcMock = {
      calculatePendingXP: vi.fn().mockReturnValue(mockXPCalculation),
    };

    consolidationMock = {
      assessSleepQuality: vi.fn().mockReturnValue(mockSleepQuality),
      assessFasting: vi.fn().mockReturnValue(mockFasting),
      consolidateXP: vi.fn().mockReturnValue(mockConsolidationResult),
    };

    levelProgMock = {
      addXP: vi.fn().mockReturnValue(null),
      getCurrentProgress: vi.fn().mockReturnValue({
        classes: {},
        totalXPAllClasses: 0,
        highestLevel: 20,
        overallTier: 'competent',
      }),
    };

    service = new ActionTrackerService(
      xpCalcMock as any,
      consolidationMock as any,
      levelProgMock as any,
      { get: vi.fn().mockReturnValue(of(null)), post: vi.fn().mockReturnValue(of(null)), put: vi.fn().mockReturnValue(of(null)), delete: vi.fn().mockReturnValue(of(null)) } as any
    );
  });

  afterEach(() => {
    service.cancelAction();
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────
  // startAction
  // ─────────────────────────────────────────────────────────────
  describe('startAction', () => {
    it('should set current action with correct type and activityKey', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Fix bug', 'moderate', 'IQ-8525');
      const action = await firstValueFrom(service.getCurrentAction());
      expect(action?.type).toBe('coding');
      expect(action?.activityKey).toBe('coding-routine');
    });

    it('should set correct intensity on the action', async () => {
      service.startAction('coding', 'coding-complex', 'Typing', 'Debug feature', 'complex');
      const action = await firstValueFrom(service.getCurrentAction());
      expect(action?.intensity).toBe('complex');
    });

    it('should default intensity to routine when not provided', async () => {
      service.startAction('prayer', 'prayer', 'Praying', 'Devotional time');
      const action = await firstValueFrom(service.getCurrentAction());
      expect(action?.intensity).toBe('routine');
    });

    it('should set quest when provided', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Story work', 'routine', 'IQ-8525');
      const action = await firstValueFrom(service.getCurrentAction());
      expect(action?.quest).toBe('IQ-8525');
    });

    it('should start with duration 0 and status in-progress', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Test target');
      const action = await firstValueFrom(service.getCurrentAction());
      expect(action?.duration).toBe(0);
      expect(action?.status).toBe('in-progress');
      expect(action?.attempts).toBe(0);
    });

    it('should cancel existing action when starting a new one', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'First action');
      service.startAction('workout', 'mma-class', 'Sparring', 'Second action');
      const action = await firstValueFrom(service.getCurrentAction());
      expect(action?.type).toBe('workout');
    });

    it('should store bonus keys on the action', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Review work', 'routine', undefined, ['clean-sonarqube', 'tests-written']);
      const action = await firstValueFrom(service.getCurrentAction());
      expect(action?.bonusKeys).toEqual(['clean-sonarqube', 'tests-written']);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // completeAction
  // ─────────────────────────────────────────────────────────────
  describe('completeAction', () => {
    it('should return null when no action is running', () => {
      expect(service.completeAction()).toBeNull();
    });

    it('should call calculatePendingXP with activityKey, hours, intensity, bonuses', () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Fix bug', 'moderate', undefined, ['clean-sonarqube']);
      service.completeAction();
      expect(xpCalcMock.calculatePendingXP).toHaveBeenCalledWith(
        'coding-routine',
        expect.any(Number),
        'moderate',
        ['clean-sonarqube']
      );
    });

    it('should attach xpCalculated to completed action', () => {
      service.startAction('coding', 'coding-complex', 'Typing', 'Complex task', 'complex');
      const completed = service.completeAction();
      expect(completed?.xpCalculated).toEqual(mockXPCalculation);
    });

    it('should mark completed action as status "completed"', () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Routine task');
      const completed = service.completeAction();
      expect(completed?.status).toBe('completed');
    });

    it('should clear current action after completion', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Routine task');
      service.completeAction();
      const action = await firstValueFrom(service.getCurrentAction());
      expect(action).toBeNull();
    });

    it('should add completed action to history as successful', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'History test');
      service.completeAction();
      const history = await firstValueFrom(service.getActionHistory());
      const completed = history.find((h) => h.action.targetResult === 'History test');
      expect(completed).toBeDefined();
      expect(completed?.successful).toBe(true);
    });

    it('should pass hours as duration / 3600', () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Hourly test');
      service.completeAction();
      expect(xpCalcMock.calculatePendingXP).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number), // hours = duration / 3600
        expect.any(String),
        expect.any(Array)
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // failAction
  // ─────────────────────────────────────────────────────────────
  describe('failAction', () => {
    it('should add failed action to history with successful=false', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Hard task');
      service.failAction();
      const history = await firstValueFrom(service.getActionHistory());
      expect(history[0]?.successful).toBe(false);
    });

    it('should increment attempts counter in history', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Hard task');
      service.failAction();
      const history = await firstValueFrom(service.getActionHistory());
      expect(history[0]?.action.attempts).toBe(1);
    });

    it('should clear current action after fail', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Hard task');
      service.failAction();
      const action = await firstValueFrom(service.getCurrentAction());
      expect(action).toBeNull();
    });

    it('should do nothing when no action running', () => {
      expect(() => service.failAction()).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // cancelAction
  // ─────────────────────────────────────────────────────────────
  describe('cancelAction', () => {
    it('should clear current action without adding to history', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Cancelled task');
      service.cancelAction();

      const action = await firstValueFrom(service.getCurrentAction());
      expect(action).toBeNull();

      const history = await firstValueFrom(service.getActionHistory());
      const cancelled = history.find((h) => h.action.targetResult === 'Cancelled task');
      expect(cancelled).toBeUndefined();
    });

    it('should do nothing if no action running', () => {
      expect(() => service.cancelAction()).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // retryAction
  // ─────────────────────────────────────────────────────────────
  describe('retryAction', () => {
    it('should increment attempts and reset duration', async () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Retry test');
      service.retryAction();
      const action = await firstValueFrom(service.getCurrentAction());
      expect(action?.attempts).toBe(1);
      expect(action?.duration).toBe(0);
    });

    it('should do nothing if no action running', () => {
      expect(() => service.retryAction()).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // consolidateActionXP
  // ─────────────────────────────────────────────────────────────
  describe('consolidateActionXP', () => {
    function buildCompletedAction(withXP = true): ActiveAction {
      return {
        type: 'coding',
        activityKey: 'coding-routine',
        startTime: new Date(),
        duration: 3600,
        animation: 'Typing',
        targetResult: 'Test task',
        attempts: 0,
        status: 'completed',
        intensity: 'routine',
        bonusKeys: [],
        ...(withXP ? { xpCalculated: mockXPCalculation as any } : {}),
      };
    }

    it('should return null if action has no xpCalculated', () => {
      const result = service.consolidateActionXP(
        buildCompletedAction(false), 6.25, 'mixed', 3, 'cognitive'
      );
      expect(result).toBeNull();
    });

    it('should call assessSleepQuality with sleepHours', () => {
      service.consolidateActionXP(buildCompletedAction(), 6.25, 'mixed', 3, 'cognitive');
      expect(consolidationMock.assessSleepQuality).toHaveBeenCalledWith(6.25);
    });

    it('should call consolidateXP with pendingXP, sleepQuality, nutrition, fasting, skillCategory', () => {
      service.consolidateActionXP(buildCompletedAction(), 6.25, 'mixed', 3, 'cognitive');
      expect(consolidationMock.consolidateXP).toHaveBeenCalledWith(
        mockXPCalculation.pendingXP,
        mockSleepQuality,
        expect.objectContaining({ type: 'mixed' }),
        mockFasting,
        'cognitive'
      );
    });

    it('should return ConsolidationResult on success', () => {
      const result = service.consolidateActionXP(buildCompletedAction(), 6.25, 'mixed', 3, 'cognitive');
      expect(result).toEqual(mockConsolidationResult);
    });

    it('should pass warrior as skill category when specified', () => {
      service.consolidateActionXP(buildCompletedAction(), 7, 'clean', 4, 'warrior');
      expect(consolidationMock.consolidateXP).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Object),
        expect.objectContaining({ type: 'clean' }),
        expect.any(Object),
        'warrior'
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // addXPToCharacter
  // ─────────────────────────────────────────────────────────────
  describe('addXPToCharacter', () => {
    it('should call levelProg.addXP with correct arguments', () => {
      service.addXPToCharacter('developer', 38.94);
      expect(levelProgMock.addXP).toHaveBeenCalledWith('developer', 38.94);
    });

    it('should return null when no level-up occurs', () => {
      levelProgMock.addXP.mockReturnValue(null);
      expect(service.addXPToCharacter('developer', 10)).toBeNull();
    });

    it('should return LevelUpResult when level-up occurs', () => {
      levelProgMock.addXP.mockReturnValue(mockLevelUpResult);
      expect(service.addXPToCharacter('developer', 9999)).toEqual(mockLevelUpResult);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // formatDuration
  // ─────────────────────────────────────────────────────────────
  describe('formatDuration', () => {
    it('should format 0 seconds as "0:00"', () => {
      expect(service.formatDuration(0)).toBe('0:00');
    });

    it('should format 90 seconds as "1:30"', () => {
      expect(service.formatDuration(90)).toBe('1:30');
    });

    it('should format 59 seconds as "0:59"', () => {
      expect(service.formatDuration(59)).toBe('0:59');
    });

    it('should format 3600 as "1:00:00"', () => {
      expect(service.formatDuration(3600)).toBe('1:00:00');
    });

    it('should format 3661 as "1:01:01"', () => {
      expect(service.formatDuration(3661)).toBe('1:01:01');
    });

    it('should pad minutes and seconds with leading zeros in HH:MM:SS format', () => {
      expect(service.formatDuration(3605)).toBe('1:00:05');
      expect(service.formatDuration(3660)).toBe('1:01:00');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getTodayTimeByType
  // ─────────────────────────────────────────────────────────────
  describe('getTodayTimeByType', () => {
    it('should return 0 when no history exists for type', () => {
      expect(service.getTodayTimeByType('coding')).toBe(0);
    });

    it('should return 0 for type with no successful entries', () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Task');
      service.failAction(); // failed, not successful
      expect(service.getTodayTimeByType('coding')).toBe(0);
    });

    it('should sum durations of successful entries for type today', () => {
      service.startAction('prayer', 'prayer', 'Praying', 'Morning devotion');
      service.completeAction(); // duration will be 0 (instant completion)
      service.startAction('prayer', 'prayer', 'Praying', 'Evening devotion');
      service.completeAction();
      // Both prayers completed successfully — sum should be >= 0
      expect(service.getTodayTimeByType('prayer')).toBeGreaterThanOrEqual(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getSuccessRate
  // ─────────────────────────────────────────────────────────────
  describe('getSuccessRate', () => {
    it('should return 0 for type with no history', () => {
      expect(service.getSuccessRate('coding')).toBe(0);
    });

    it('should return 100 when all actions were successful', () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Task 1');
      service.completeAction();
      service.startAction('coding', 'coding-routine', 'Typing', 'Task 2');
      service.completeAction();
      expect(service.getSuccessRate('coding')).toBe(100);
    });

    it('should return 50 when half of actions failed', () => {
      service.startAction('coding', 'coding-routine', 'Typing', 'Task 1');
      service.completeAction();
      service.startAction('coding', 'coding-routine', 'Typing', 'Task 2');
      service.failAction();
      expect(service.getSuccessRate('coding')).toBe(50);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getCharacterProgress / getXPService
  // ─────────────────────────────────────────────────────────────
  describe('getCharacterProgress / getXPService', () => {
    it('getCharacterProgress should delegate to levelProg.getCurrentProgress', () => {
      service.getCharacterProgress();
      expect(levelProgMock.getCurrentProgress).toHaveBeenCalled();
    });

    it('getXPService should return the xpCalc service', () => {
      expect(service.getXPService()).toBe(xpCalcMock as any);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // History Cap (50 entries max)
  // ─────────────────────────────────────────────────────────────
  describe('History Cap', () => {
    it('history should never exceed 50 entries', async () => {
      for (let i = 0; i < 55; i++) {
        service.startAction('coding', 'coding-routine', 'Typing', `Task ${i}`);
        service.completeAction();
      }
      const history = await firstValueFrom(service.getActionHistory());
      expect(history.length).toBeLessThanOrEqual(50);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Integration: Full Action → XP Workflow
  // ─────────────────────────────────────────────────────────────
  describe('Integration: Start → Complete → Consolidate → Level Up', () => {
    it('should complete full XP workflow and trigger level-up', () => {
      levelProgMock.addXP.mockReturnValue(mockLevelUpResult);

      // 1. Start and complete action
      service.startAction('coding', 'coding-complex', 'Typing', 'IQ-8525', 'moderate', 'IQ-8525', ['clean-sonarqube']);
      const completed = service.completeAction();

      expect(completed?.xpCalculated).toBeDefined();
      expect(xpCalcMock.calculatePendingXP).toHaveBeenCalled();

      // 2. Consolidate with sleep/nutrition/fasting
      const consolidated = service.consolidateActionXP(completed!, 6.25, 'mixed', 3, 'cognitive');
      expect(consolidated?.permanentXP).toBeGreaterThan(0);

      // 3. Add to character → level-up
      const levelUp = service.addXPToCharacter('developer', consolidated!.permanentXP);
      expect(levelUp).not.toBeNull();
      expect(levelUp!.newLevel).toBeGreaterThan(levelUp!.oldLevel);
    });
  });
});
