import { ANALYTICS_EMPTY_MSG } from './progression-analytics.component';

describe('ProgressionAnalyticsComponent empty copy', () => {
  it('does not blame the retired character-sheet parser', () => {
    expect(ANALYTICS_EMPTY_MSG).toBe('No XP history in the database yet');
    expect(ANALYTICS_EMPTY_MSG.toLowerCase()).not.toContain('character sheet');
  });
});
