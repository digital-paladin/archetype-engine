// xpProjection.service.ts
// Service to parse character-sheet.md and compute XP analytics (converted from Python)

import * as fs from 'fs';
import * as path from 'path';

import { ArchiveReaderService } from './archiveReader.service';

export interface XPProjection {
  [className: string]: {
    totalXP: number;
    daysTracked: number;
    avgDailyXP: number;
    avgWeeklyXP: number;
    projected6mo: number;
    projected12mo: number;
  };
}

export class XPProjectionService {
  // Matches lines like: - Sage: +12 XP (15 × 77.4% = 11.6 ≈ 12) → 5,256 → 5,268
  private static readonly XP_REGEX = /^- (\w+): \+(\d+) XP/gm;
  // Matches character-sheet date headers like: ### Feb 6 → Feb 7, 2026 (Fri → Sat)
  private static readonly DATE_REGEX = /^### \w{3} \d{1,2} (?:→|->) /gm;  // handles both Unicode → and ASCII -> formats

  static parseXPProjections(filePath: string): XPProjection {
    const content = ArchiveReaderService.getFullCharacterHistory(filePath);
    const classXP: { [className: string]: number[] } = {};

    // Count date headers (each ### MMM DD → ... = one tracked day)
    const dateMatches = content.match(this.DATE_REGEX) || [];
    const daysTracked = dateMatches.length || 1;

    // Find all Permanent XP entries (only inside **Permanent XP:** blocks)
    let match;
    while ((match = this.XP_REGEX.exec(content)) !== null) {
      const className = match[1];
      const xp = parseInt(match[2], 10);
      if (!classXP[className]) classXP[className] = [];
      classXP[className].push(xp);
    }

    const daysTrackedFinal = daysTracked;
    const projections: XPProjection = {};
    for (const [className, xpList] of Object.entries(classXP)) {
      const totalXP = xpList.reduce((a, b) => a + b, 0);
      const avgDailyXP = totalXP / daysTrackedFinal;
      const avgWeeklyXP = avgDailyXP * 7;
      const projected6mo = Math.round(avgDailyXP * 182.5);
      const projected12mo = Math.round(avgDailyXP * 365);
      projections[className] = {
        totalXP,
        daysTracked: daysTrackedFinal,
        avgDailyXP: Number(avgDailyXP.toFixed(2)),
        avgWeeklyXP: Number(avgWeeklyXP.toFixed(2)),
        projected6mo,
        projected12mo,
      };
    }
    return projections;
  }
}

// Example usage (for testing):
// const result = XPProjectionService.parseXPProjections(path.join(__dirname, '../../../character-progression/character-sheet.md'));
// console.log(result);
