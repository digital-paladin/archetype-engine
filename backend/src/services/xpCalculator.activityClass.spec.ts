import { XpCalculatorService } from './xpCalculator.service';
import { toCanonicalClassName } from './xpAward.service';

/**
 * Class contract the frontend activity-type map relies on.
 * Unknown keys are category "general", which persists as Sage — that is why
 * the client must translate before it posts.
 */
describe('XpCalculatorService activity class routing', () => {
  const calc = new XpCalculatorService();

  function classOf(activityType: string): string {
    return toCanonicalClassName(calc.getCategoryFromActivity(activityType));
  }

  it('routes the types the frontend map sends to the intended class', () => {
    expect(classOf('personal-project')).toBe('Developer');
    expect(classOf('iq2-story')).toBe('Developer');
    expect(classOf('iq2-bug-fix')).toBe('Developer');
    expect(classOf('admin-review')).toBe('Developer');
    expect(classOf('paladin-app-dev')).toBe('Developer');

    expect(classOf('workout-mma')).toBe('Warrior');
    expect(classOf('workout-strength')).toBe('Warrior');
    expect(classOf('workout-cardio')).toBe('Warrior');
    expect(classOf('workout-mobility')).toBe('Warrior');

    expect(classOf('redteam-lab')).toBe('Redteamer');
    expect(classOf('redteam-ctf')).toBe('Redteamer');
    expect(classOf('redteam-training')).toBe('Redteamer');

    expect(classOf('art-music')).toBe('Artist');
    expect(classOf('art-drawing')).toBe('Artist');
    expect(classOf('art-writing')).toBe('Artist');

    expect(classOf('prayer-routine')).toBe('Sage');
    expect(classOf('admin-planning')).toBe('Sage');

    expect(classOf('financial-study')).toBe('Financial Strategist');
    expect(classOf('wilderness-training')).toBe('Survivalist');

    expect(classOf('social')).toBe('Social');
    expect(classOf('social-networking')).toBe('Social');
    expect(calc.calculateXP('social', 60)).toBe(0);
    expect(calc.calculateXP('social-networking', 30)).toBe(0);
  });

  it('files the old frontend keys as Sage', () => {
    for (const key of ['coding-moderate', 'dev-story', 'dev-bug-fix', 'mma-training', 'guitar-practice', 'Fix the login bug']) {
      expect(classOf(key)).toBe('Sage');
    }
  });

  it('lists story and bug-fix types as iq2-*, not the quick-log labels', () => {
    const types = new Set(calc.getActivityTypes().map(entry => entry.type));
    expect(types.has('iq2-story')).toBe(true);
    expect(types.has('iq2-bug-fix')).toBe(true);
    expect(types.has('dev-story')).toBe(false);
    expect(types.has('dev-bug-fix')).toBe(false);
    expect(calc.getCategoryFromActivity('prayer-routine')).toBe('prayer');
  });
});
