/**
 * xpProjection.service.ts — Unit Tests
 *
 * Tests pure parsing logic of XPProjectionService.parseXPProjections().
 * ArchiveReaderService.getFullCharacterHistory is mocked so no real file is needed.
 */

import { XPProjectionService } from './xpProjection.service';
import * as ArchiveReaderModule from './archiveReader.service';

// ── Fixture: minimal character-sheet.md history block ─────────────────────
const FIXTURE_CONTENT = `
### Feb 01 -> Feb 02, 2026 (Sat -> Sun)

**Permanent XP:**
- Sage: +12 XP (15 x 80% = 12) -> 100 -> 112
- Developer: +10 XP (12 x 83% = 10) -> 200 -> 210
- Warrior: +8 XP (10 x 80% = 8) -> 50 -> 58
- Redteamer: +6 XP (8 x 75% = 6) -> 30 -> 36

---

### Feb 02 -> Feb 03, 2026 (Sun -> Mon)

**Permanent XP:**
- Sage: +15 XP (18 x 83% = 15) -> 112 -> 127
- Developer: +14 XP (17 x 82% = 14) -> 210 -> 224
- Warrior: +0 XP
- Redteamer: +0 XP
`;

jest.spyOn(ArchiveReaderModule.ArchiveReaderService, 'getFullCharacterHistory')
  .mockReturnValue(FIXTURE_CONTENT);

// ─────────────────────────────────────────────────────────────────────────────
describe('XPProjectionService.parseXPProjections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ArchiveReaderModule.ArchiveReaderService, 'getFullCharacterHistory')
      .mockReturnValue(FIXTURE_CONTENT);
  });

  it('returns a non-null result for valid content', () => {
    const result = XPProjectionService.parseXPProjections('any-path.md');
    expect(result).not.toBeNull();
    expect(typeof result).toBe('object');
  });

  it('returns an object keyed by class name', () => {
    const result = XPProjectionService.parseXPProjections('any-path.md');
    const keys = Object.keys(result);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('detects Sage XP entries from fixture', () => {
    const result = XPProjectionService.parseXPProjections('any-path.md');
    expect(result['Sage']).toBeDefined();
    expect(result['Sage'].totalXP).toBeGreaterThan(0);
  });

  it('detects Developer XP entries from fixture', () => {
    const result = XPProjectionService.parseXPProjections('any-path.md');
    expect(result['Developer']).toBeDefined();
    expect(result['Developer'].totalXP).toBeGreaterThan(0);
  });

  it('each class entry has all required projection fields', () => {
    const result = XPProjectionService.parseXPProjections('any-path.md');
    const sage = result['Sage'];
    expect(sage).toHaveProperty('totalXP');
    expect(sage).toHaveProperty('daysTracked');
    expect(sage).toHaveProperty('avgDailyXP');
    expect(sage).toHaveProperty('avgWeeklyXP');
    expect(sage).toHaveProperty('projected6mo');
    expect(sage).toHaveProperty('projected12mo');
  });

  it('Sage totalXP matches fixture values (12 + 15 = 27)', () => {
    const result = XPProjectionService.parseXPProjections('any-path.md');
    expect(result['Sage'].totalXP).toBe(27);
  });

  it('handles empty content gracefully without throwing', () => {
    jest.spyOn(ArchiveReaderModule.ArchiveReaderService, 'getFullCharacterHistory')
      .mockReturnValue('');

    expect(() => XPProjectionService.parseXPProjections('any-path.md')).not.toThrow();
    const result = XPProjectionService.parseXPProjections('any-path.md');
    expect(Object.keys(result).length).toBe(0);
  });
});
