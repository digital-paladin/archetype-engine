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

  it('leaves everything else unmapped, including a description-only name and PT inside another word', () => {
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
});
