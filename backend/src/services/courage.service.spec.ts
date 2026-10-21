import { applyCourageFlag } from './courage.service';

describe('applyCourageFlag calendar day', () => {
  it('caps the bonus once per supplied day and does not rewind the latest flag day', () => {
    expect(applyCourageFlag('workout-mobility', 'backfill', '2026-10-18')).toBe(10);
    expect(applyCourageFlag('workout-mobility', 'again', '2026-10-18')).toBe(0);
    expect(applyCourageFlag('workout-strength', 'next day', '2026-10-19')).toBe(10);
    expect(applyCourageFlag('workout-strength', 'older', '2026-10-18')).toBe(0);
    expect(applyCourageFlag('workout-strength', 'same newer day', '2026-10-19')).toBe(0);
  });
});
