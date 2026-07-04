import * as fs from 'fs';
import * as path from 'path';

export class ArchiveReaderService {
  /**
   * Reads character-sheet.md and concatenates it with all archive files 
   * in reverse chronological order.
   */
  public static getFullCharacterHistory(overridePath?: string): string {
    const mainFilePath = overridePath || process.env.CHARACTER_FILE_PATH || '../character-sheet.md';
    let fullContent = fs.readFileSync(mainFilePath, 'utf-8');

    // The archive directory based on characters file path
    const archiveDirPath = path.join(path.dirname(mainFilePath), 'archive');

    if (fs.existsSync(archiveDirPath)) {
      const archiveFiles = fs.readdirSync(archiveDirPath)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();

      for (const file of archiveFiles) {
        fullContent += '\n' + fs.readFileSync(path.join(archiveDirPath, file), 'utf-8');
      }
    }

    return fullContent;
  }
}
