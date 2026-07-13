import {
  suggestClassTemplate,
  normalizeDomains,
  LIFE_DOMAINS,
} from './classTemplates';

describe('classTemplates', () => {
  it('exposes a non-empty domain catalog', () => {
    expect(LIFE_DOMAINS.length).toBeGreaterThanOrEqual(15);
  });

  it('normalizes and dedupes domains', () => {
    expect(normalizeDomains(['Strength Training', 'bogus', 'Strength Training', 'Music'])).toEqual([
      'Strength Training',
      'Music',
    ]);
  });

  it('suggests Berserker for strength/martial domains', () => {
    const t = suggestClassTemplate(['Strength Training', 'Martial Arts', 'Endurance']);
    expect(t.id).toBe('berserker');
  });

  it('suggests Shadow Assassin for security/tech', () => {
    const t = suggestClassTemplate(['Security/Hacking', 'Programming/Tech', 'Chess']);
    expect(t.id).toBe('shadow-assassin');
  });

  it('suggests Artificer for creative domains', () => {
    const t = suggestClassTemplate(['Music', 'Visual Art', 'Writing']);
    expect(t.id).toBe('artificer');
  });
});
