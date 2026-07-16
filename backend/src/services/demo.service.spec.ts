import {
  _resetDemoRateLimitForTests,
  assertDemoUserSafe,
  checkDemoRateLimit,
  DEMO_BIRTH_DATE,
  DEMO_CLASS_STATS,
  getConfiguredDemoUserId,
} from './demo.service';

describe('demo.service', () => {
  const prevDemo = process.env.DEMO_USER_ID;
  const prevOwner = process.env.OWNER_USER_ID;

  afterEach(() => {
    _resetDemoRateLimitForTests();
    if (prevDemo === undefined) delete process.env.DEMO_USER_ID;
    else process.env.DEMO_USER_ID = prevDemo;
    if (prevOwner === undefined) delete process.env.OWNER_USER_ID;
    else process.env.OWNER_USER_ID = prevOwner;
  });

  it('getConfiguredDemoUserId returns null when unset', () => {
    delete process.env.DEMO_USER_ID;
    expect(getConfiguredDemoUserId()).toBeNull();
  });

  it('getConfiguredDemoUserId trims UUID', () => {
    process.env.DEMO_USER_ID = '  aaa-bbb-ccc  ';
    expect(getConfiguredDemoUserId()).toBe('aaa-bbb-ccc');
  });

  it('assertDemoUserSafe throws when DEMO equals OWNER', () => {
    process.env.OWNER_USER_ID = 'same-id';
    expect(() => assertDemoUserSafe('same-id')).toThrow(/must not equal OWNER_USER_ID/);
  });

  it('assertDemoUserSafe allows distinct ids', () => {
    process.env.OWNER_USER_ID = 'owner';
    expect(() => assertDemoUserSafe('demo')).not.toThrow();
  });

  it('checkDemoRateLimit blocks after max hits', () => {
    expect(checkDemoRateLimit('1.2.3.4', 3)).toBe(true);
    expect(checkDemoRateLimit('1.2.3.4', 3)).toBe(true);
    expect(checkDemoRateLimit('1.2.3.4', 3)).toBe(true);
    expect(checkDemoRateLimit('1.2.3.4', 3)).toBe(false);
  });

  it('fake seed constants are not Owner-shaped', () => {
    expect(DEMO_BIRTH_DATE).toBe('1998-06-15');
    expect(DEMO_CLASS_STATS).toHaveLength(7);
    expect(DEMO_CLASS_STATS.every((c) => c.level >= 2 && c.level <= 10)).toBe(true);
  });
});
