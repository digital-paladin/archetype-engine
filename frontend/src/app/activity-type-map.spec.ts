import {
  ACTIVITY_TYPE_ALIASES,
  BACKEND_ACTIVITY_TYPES,
  toBackendActivityType,
} from './activity-type-map';

describe('toBackendActivityType', () => {
  it('maps every alias onto a backend activity type', () => {
    for (const [key, backendType] of Object.entries(ACTIVITY_TYPE_ALIASES)) {
      expect(BACKEND_ACTIVITY_TYPES.has(backendType), `${key} -> ${backendType}`).toBe(true);
      expect(toBackendActivityType(key)).toBe(backendType);
    }
  });

  it('passes canonical backend types through, including recovery quests', () => {
    for (const type of BACKEND_ACTIVITY_TYPES) {
      expect(toBackendActivityType(type)).toBe(type);
    }
    expect(toBackendActivityType('recovery-rest-day')).toBe('recovery-rest-day');
    expect(toBackendActivityType('  iq2-story  ')).toBe('iq2-story');
  });

  it('routes the reported logging keys to the intended backend type', () => {
    // Developer
    expect(toBackendActivityType('coding-moderate')).toBe('personal-project');
    expect(toBackendActivityType('coding-routine')).toBe('personal-project');
    expect(toBackendActivityType('deep-focus')).toBe('personal-project');
    expect(toBackendActivityType('dev-story')).toBe('iq2-story');
    expect(toBackendActivityType('dev-bug-fix')).toBe('iq2-bug-fix');

    // Warrior
    expect(toBackendActivityType('mma-training')).toBe('workout-mma');
    expect(toBackendActivityType('mma-class')).toBe('workout-mma');
    expect(toBackendActivityType('strength-training')).toBe('workout-strength');
    expect(toBackendActivityType('swim-training')).toBe('workout-cardio');
    expect(toBackendActivityType('swimming')).toBe('workout-cardio');

    // Redteamer / Artist / Sage
    expect(toBackendActivityType('htb-medium')).toBe('redteam-lab');
    expect(toBackendActivityType('guitar-practice')).toBe('art-music');
    expect(toBackendActivityType('music-practice')).toBe('art-music');
    expect(toBackendActivityType('prayer')).toBe('prayer-routine');
    expect(toBackendActivityType('prayer-routine')).toBe('prayer-routine');
    expect(toBackendActivityType('daily-log')).toBe('admin-planning');
  });

  it('does not send hydration or free text, which the server would file as Sage', () => {
    expect(toBackendActivityType('hydration')).toBeNull();
    expect(toBackendActivityType('protein')).toBeNull();
    expect(toBackendActivityType('Fix the login bug')).toBeNull();
    expect(toBackendActivityType('')).toBeNull();
    expect(toBackendActivityType(null)).toBeNull();
  });
});
