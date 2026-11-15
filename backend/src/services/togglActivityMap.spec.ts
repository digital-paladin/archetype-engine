import { mapTogglProjectOrTags } from './togglActivityMap';

describe('mapTogglProjectOrTags', () => {
  it.each([
    ['Sambo', 'workout-mma', 'Sambo'],
    ['sambo', 'workout-mma', 'Sambo'],
    ['Tuesday Sambo', 'workout-mma', 'Sambo'],
    ['BJJ', 'workout-mma', 'BJJ'],
    ['No-Gi BJJ', 'workout-mma', 'BJJ'],
    ['MMA', 'workout-mma', 'MMA'],
    ['Wrestling', 'workout-mma', 'Wrestling'],
    ['judo', 'workout-mma', 'Judo'],
    ['Lifting', 'workout-strength', 'Lifting'],
    ['Strength Training', 'workout-strength', 'Strength'],
    ['resistance bands', 'workout-strength', 'Resistance'],
    ['PT', 'workout-mobility', 'PT'],
    ['Hinge Health', 'workout-mobility', 'Hinge Health'],
    ['mobility', 'workout-mobility', 'Mobility'],
    ['Power Yoga', 'workout-mobility', 'Yoga'],
  ])('project %s → %s (%s)', (project, activityType, label) => {
    expect(mapTogglProjectOrTags(project, [])).toEqual({ activityType, label });
  });

  it('matches a tag when the project name is unmapped', () => {
    expect(mapTogglProjectOrTags('Training', ['Sambo'])).toEqual({
      activityType: 'workout-mma',
      label: 'Sambo',
    });
  });

  it('leaves unmapped project names and tags unmapped, including PT inside another word', () => {
    expect(mapTogglProjectOrTags('Email', ['commute'])).toBeNull();
    expect(mapTogglProjectOrTags('option', [])).toBeNull();
    expect(mapTogglProjectOrTags(null, [])).toBeNull();
    expect(mapTogglProjectOrTags('Run', null)).toBeNull();
  });

  it('prefers the longer keyword, then the project name over a tag', () => {
    expect(mapTogglProjectOrTags('Hinge Health PT', ['yoga'])).toEqual({
      activityType: 'workout-mobility',
      label: 'Hinge Health',
    });
    expect(mapTogglProjectOrTags('Sambo', ['Yoga'])).toEqual({
      activityType: 'workout-mma',
      label: 'Sambo',
    });
  });

  it.each([
    ['sambo', 'workout-mma', 'Sambo'],
    ['SAMBO', 'workout-mma', 'Sambo'],
    ['FtWorth Combatives - Sambo', 'workout-mma', 'Sambo'],
    ['strength work', 'workout-strength', 'Strength'],
    ['Strength-work', 'workout-strength', 'Strength'],
    ['mobility', 'workout-mobility', 'Mobility'],
    ['stretch', 'workout-mobility', 'Stretch'],
    ['stretching', 'workout-mobility', 'Stretch'],
    ['Hip Stretch', 'workout-mobility', 'Stretch'],
  ])('description %s → %s (%s) when the project and tags do not map', (description, activityType, label) => {
    expect(mapTogglProjectOrTags('Warrior', [], description)).toEqual({ activityType, label });
    expect(mapTogglProjectOrTags(null, [], description)).toEqual({ activityType, label });
    expect(mapTogglProjectOrTags(null, null, description)).toEqual({ activityType, label });
  });

  it('leaves parkour unmapped so Sport stays on the cardio rate', () => {
    expect(mapTogglProjectOrTags(null, [], 'parkour')).toBeNull();
    expect(mapTogglProjectOrTags('Warrior', [], 'Parkour')).toBeNull();
    expect(mapTogglProjectOrTags(null, ['parkour'], 'parkour session')).toBeNull();
  });

  it('on a length tie, prefers the project name, then the description, then a tag', () => {
    expect(mapTogglProjectOrTags('Yoga', [], 'judo')).toEqual({
      activityType: 'workout-mobility',
      label: 'Yoga',
    });
    expect(mapTogglProjectOrTags('Training', ['Yoga'], 'judo')).toEqual({
      activityType: 'workout-mma',
      label: 'Judo',
    });
    expect(mapTogglProjectOrTags('PT', [], 'Hinge Health')).toEqual({
      activityType: 'workout-mobility',
      label: 'Hinge Health',
    });
  });
});
