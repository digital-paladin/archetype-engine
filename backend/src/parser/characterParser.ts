import { readFile } from 'fs/promises';
import { CharacterData, SkillTree, VitalityData, PhaseInfo, Title, LockedTitle, TitleCollection, TitleRarity, RecoveryFactor, SleepDebtData, AcmMetrics, RpgStats, RpgLift, OverallLevelInfo, QuestLine, QuestChapter, GrandConvergence, GrandConvergenceCondition } from '../models/character.model';

export class CharacterParser {
  constructor(private filePath: string) {}

  async parse(): Promise<CharacterData> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      return {
        name: this.extractName(content),
        overallLevelInfo: this.calculateOverallLevelInfo(),
        phase: this.extractPhaseInfo(content),
        vitality: this.extractVitality(content),
        sleepDebt: this.extractSleepDebt(content),
        skillTrees: this.extractSkillTrees(content),
        titles: this.extractTitles(content),
        gritScore: { current: 0, percentage: 0, checklistItems: [], streak: 0, tier: 'Moderate' }, // TODO: Implement in Week 5
        gitGudLog: [], // TODO: Implement in Week 5
        lastUpdated: new Date(),
        sageStreak: this.extractSageStreak(content),
        acmMetrics: this.extractAcmMetrics(content),
        rpgStats: this.extractRpgStats(content),
        questLines: this.extractQuestLines(content),
        grandConvergence: this.extractGrandConvergence(content)
      };
    } catch (error) {
      throw new Error(`Failed to parse character file: ${error}`);
    }
  }

  private extractName(content: string): string {
    const match = content.match(/\*\*Owner:\*\* (.+)/);
    return match ? match[1].trim() : 'Unknown';
  }

  private calculateOverallLevelInfo(): OverallLevelInfo {
    const birthDateStr = process.env.PLAYER_BIRTH_DATE || '1990-01-01';
    const birthDate = new Date(`${birthDateStr}T00:00:00Z`);
    const now = new Date();
    
    // Calculate current age
    let age = now.getFullYear() - birthDate.getFullYear();
    const hasHadBirthdayThisYear = (now.getMonth() > birthDate.getMonth()) || 
        (now.getMonth() === birthDate.getMonth() && now.getDate() >= birthDate.getDate());
    
    if (!hasHadBirthdayThisYear) {
      age--;
    }

    // Calculate next birthday
    const [, birthMonth, birthDay] = birthDateStr.split('-');
    const nextBirthdayYear = hasHadBirthdayThisYear ? now.getFullYear() + 1 : now.getFullYear();
    const nextBirthday = new Date(`${nextBirthdayYear}-${birthMonth}-${birthDay}T00:00:00Z`);
    
    // Calculate days remaining
    const diffTime = Math.abs(nextBirthday.getTime() - now.getTime());
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Format date string gracefully (e.g., "May 18, 2026")
    const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    const nextLevelDateStr = nextBirthday.toLocaleDateString('en-US', dateOptions);

    return {
      level: age,
      nextLevel: age + 1,
      nextLevelDate: nextLevelDateStr,
      daysRemaining: daysRemaining
    };
  }

  private extractPhaseInfo(content: string): PhaseInfo {
    const phaseMatch = content.match(/### Current Phase: Phase (\d+) \((.+?)\)/);
    const current = phaseMatch ? parseInt(phaseMatch[1]) : 1;
    const name = phaseMatch ? phaseMatch[2].trim() : 'Foundation';
    const startMatch = content.match(/\*\*Start Date:\*\* (.+)/);
    const endMatch = content.match(/\*\*End Date:\*\* (.+?) \((\d+) days remaining\)/);
    const startDate = startMatch ? new Date(startMatch[1].trim()) : new Date();
    const endDate = endMatch ? new Date(endMatch[1].trim()) : new Date();
    const daysRemaining = endMatch ? parseInt(endMatch[2]) : 0;
    const focusMatch = content.match(/\*\*Focus:\*\* (.+)/);
    const focus = focusMatch ? focusMatch[1].trim() : '';
    const targetsSection = content.match(/\*\*Phase 1 Targets[^:]*:\*\*\n((?:- .+\n?)+)/);
    const targets = [];
    if (targetsSection) {
      const targetStrings = targetsSection[1].split(/\r?\n/).filter(line => line.startsWith('- ')).map(line => line.substring(2).trim());
      targets.push(...targetStrings.map(desc => ({ 
        category: 'Strength' as const, 
        metric: desc, 
        target: desc, 
        onTrack: true 
      })));
    }
    return { current, name, startDate, endDate, daysRemaining, focus, targets, weeklyVolume: '0 hrs', monthlyBudget: 'return { current, name, startDate, endDate, daysRemaining, focus, targets };' };
  }

  private extractVitality(content: string): VitalityData {
    // Match vitality with decimal support: **Current:** 79.8/100 or **Vitality:** 79.8/100
    const currentMatch = content.match(/\*\*(?:Current|Vitality):\*\* ([\d.]+)\/([\d.]+)/);
    const statusMatch = content.match(/\*\*Status:\*\* ([A-Za-z ]+)/);
    
    if (currentMatch) {
      const current = parseFloat(currentMatch[1]);
      const max = parseFloat(currentMatch[2]);
      const percentage = Math.round((current / max) * 100);
      const status = statusMatch ? statusMatch[1].trim() as VitalityData['status'] : this.getVitalityStatus(percentage);
      
      // Determine trend from context
      let trend: VitalityData['trend'] = 'stable';
      if (content.includes('Hard cap active')) {
        trend = 'down'; // Capped by sleep debt
      } else if (percentage >= 90) {
        trend = 'up'; // Peak condition
      }
      
      // Extract recovery factors from vitality section
      const recoveryFactors: RecoveryFactor[] = [];
      const recoverySection = content.match(/\*\*Recovery Bonuses.*?\*\*Total recovery: \+(\d+) vitality\*\*/s);
      if (recoverySection) {
        const totalRecovery = parseInt(recoverySection[1]);
        recoveryFactors.push({ name: 'Total Recovery', modifier: totalRecovery, description: `${totalRecovery} vitality recovered` });
      }
      
      return { current, max, percentage, status, trend, changeFromYesterday: 0, recoveryFactors };
    }
    return { current: 100, max: 100, percentage: 100, status: 'Peak Condition', trend: 'stable', changeFromYesterday: 0, recoveryFactors: [] };
  }

  private extractSleepDebt(content: string): SleepDebtData {
    // Match: **Current Debt:** 10.29 hrs  OR legacy "hours" format
    const currentDebtMatch = content.match(/\*\*Current Debt:\*\* ([\d.]+) (?:hrs?|hours)/);
    const currentDebt = currentDebtMatch ? parseFloat(currentDebtMatch[1]) : 0;
    
    // Match trend: **Trend:** Decreasing ⬇️ (-0.5 hrs paydown from yesterday)
    const trendMatch = content.match(/\*\*Trend:\*\* (Decreasing|Increasing|Stable)/i);
    const trend = trendMatch ? trendMatch[1].toLowerCase() as 'decreasing' | 'increasing' | 'stable' : 'stable';
    
    // Match change from yesterday
    const changeMatch = content.match(/\(([+-][\d.]+) hrs paydown from yesterday\)/);
    const changeFromYesterday = changeMatch ? parseFloat(changeMatch[1]) : 0;
    
    // Match progress: 11.73 → <5 hrs target = 13 days remaining (projected Jan 1, 2026)
    const progressMatch = content.match(/([\d.]+) → <([\d.]+) hrs target = (\d+) days remaining \(projected (.+?)\)/);
    const targetDebt = progressMatch ? parseFloat(progressMatch[2]) : 5;
    const targetDate = progressMatch ? new Date(progressMatch[4].trim()) : undefined;
    const onTrackForTarget = currentDebt > 0 && trend === 'decreasing';
    
    // Effect on vitality (hard cap formula)
    const effectOnVitality = currentDebt > 5 ? Math.round((100 - (currentDebt - 5) * 3) * 10) / 10 : 100;
    
    // Effect on consolidation (estimate based on debt level)
    const effectOnConsolidation = currentDebt > 10 ? 85 : currentDebt > 5 ? 90 : 95;
    
    return {
      currentDebt,
      trend,
      changeFromYesterday,
      targetDate,
      targetDebt,
      onTrackForTarget,
      effectOnVitality,
      effectOnConsolidation
    };
  }

  private extractSkillTrees(content: string): SkillTree[] {
    return [
      this.extractSkillTree(content, 'Developer'),
      this.extractSkillTree(content, 'Sage'),
      this.extractSkillTree(content, 'Warrior'),
      this.extractSkillTree(content, 'Artist'),
      this.extractSkillTree(content, 'Redteamer'),
      this.extractSkillTree(content, 'Financial Strategist'),
      this.extractSkillTree(content, 'Survivalist')
    ];
  }

  /**
   * Extracts the most recent XP snapshot for a class from the history log.
   * History is reverse-chronological so the first matching "Level Progress" line is the latest.
   * This supersedes the CURRENT STATS section which is updated infrequently.
   */
  private extractLatestHistoryXP(content: string, className: string): { level: number; currentXP: number; xpToNextLevel: number; percentToNext: number } | null {
    const historyIdx = content.indexOf('[HISTORY-LOG-BEGIN]');
    if (historyIdx === -1) return null;

    const historyContent = content.substring(historyIdx);
    const escapedName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Format: "- Developer L20: 5,010 / 8,944 (56.0% to L21)"
    const match = historyContent.match(new RegExp(`- ${escapedName} L(\\d+): ([\\d,]+) \\/ ([\\d,]+) \\(([\\d.]+)% to L\\d+\\)`));
    if (!match) return null;

    return {
      level: parseInt(match[1]),
      currentXP: parseInt(match[2].replace(/,/g, '')),
      xpToNextLevel: parseInt(match[3].replace(/,/g, '')),
      percentToNext: parseFloat(match[4])
    };
  }

  private extractSkillTree(content: string, name: string): SkillTree {
    const iconMap: any = { Developer: '', Sage: '', Warrior: '', Artist: '', Redteamer: '' };
    const icon = iconMap[name] || '';

    // History log (reverse-chron) is the authoritative live source for XP numbers.
    // CURRENT STATS section is only updated periodically; use it for metadata only.
    const historyXP = this.extractLatestHistoryXP(content, name);

    const sectionPattern = new RegExp(`### .+ ${name}[^#]*?\\*\\*Level:\\*\\* (\\d+).*?\\*\\*Current XP:\\*\\* ([\\d,]+) \\/ ([\\d,]+) \\(([\\d.]+)% to Level (\\d+)\\).*?\\*\\*Total.*?XP:\\*\\* ([\\d,]+).*?\\*\\*Tier:\\*\\* (.+?)\\n`, 's');
    const match = content.match(sectionPattern);
    if (!match && !historyXP) {
      return { id: name.toLowerCase(), name, icon, level: 1, currentXP: 0, xpToNextLevel: 100, totalCareerXP: 0, percentToNext: 0, tier: 'Novice', activeBuffs: [], weeklyActivity: '0 hrs/week', weeklyXPRate: 0, estimatedWeeksToLevel: 999, rustStatus: 'sharp' };
    }

    // XP numbers: prefer history (live) over CURRENT STATS (stale)
    const level = historyXP?.level ?? (match ? parseInt(match[1]) : 1);
    const currentXP = historyXP?.currentXP ?? (match ? parseInt(match[2].replace(/,/g, '')) : 0);
    const xpToNextLevel = historyXP?.xpToNextLevel ?? (match ? parseInt(match[3].replace(/,/g, '')) : 100);
    const percentToNext = historyXP?.percentToNext ?? (match ? parseFloat(match[4]) : 0);
    const totalCareerXP = match ? parseInt(match[6].replace(/,/g, '')) : 0;
    const tier = match ? match[7].trim() : 'Novice';
    
    // Extract rust status: **Rust Status:** ✅ Sharp (no penalty) or ⚠️ Rusty or N/A
    const rustPattern = new RegExp(`### .+ ${name}[^#]*?\\*\\*Rust Status:\\*\\* (✅ Sharp|⚠️ Rusty|🔴 Very Rusty|N\\/A)`, 's');
    const rustMatch = content.match(rustPattern);
    let rustStatus: 'sharp' | 'rusty' | 'very-rusty' | 'n/a' = 'sharp';
    if (rustMatch) {
      const rustText = rustMatch[1];
      if (rustText.includes('Sharp')) rustStatus = 'sharp';
      else if (rustText.includes('Very Rusty')) rustStatus = 'very-rusty';
      else if (rustText.includes('Rusty')) rustStatus = 'rusty';
      else if (rustText.includes('N/A')) rustStatus = 'n/a';
    }
    
    const buffsPattern = new RegExp(`### .+ ${name}[^#]*?\\*\\*Active Buffs:\\*\\*\\n((?:- .+\\n?)+)`, 's');
    const buffsMatch = content.match(buffsPattern);
    const buffStrings = buffsMatch ? buffsMatch[1].split(/\r?\n/).filter(line => line.trim().startsWith('- ')).map(line => line.trim().substring(2).trim()) : [];
    const activeBuffs = buffStrings.map(buff => ({ name: buff, description: buff, effect: '', active: true }));
    const activityMatch = content.match(new RegExp(`### .+ ${name}[^#]*?\\*\\*Weekly Activity:\\*\\* (.+?)\\n`, 's'));
    const weeklyActivity = activityMatch ? activityMatch[1].trim() : '0 hrs/week';
    const weeksMatch = content.match(new RegExp(`### .+ ${name}[^#]*?\\*\\*Estimated Time to Level:\\*\\* ~(\\d+) weeks`, 's'));
    const estimatedWeeksToLevel = weeksMatch ? parseInt(weeksMatch[1]) : 999;
    const weeklyXPRate = estimatedWeeksToLevel > 0 ? Math.round((xpToNextLevel - currentXP) / estimatedWeeksToLevel) : 0;
    return { id: name.toLowerCase(), name, icon, level, currentXP, xpToNextLevel, totalCareerXP, percentToNext, tier, activeBuffs, weeklyActivity, weeklyXPRate, estimatedWeeksToLevel, rustStatus };
  }

  private extractSageStreak(content: string): number {
    const match = content.match(/\*\*Current Streak:\*\* (\d+) days/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractAcmMetrics(content: string): AcmMetrics | undefined {
    const section = content.match(/## 🎯 Action Consequence Matrix[\s\S]*?(?=\n## )/);
    if (!section) return undefined;
    const text = section[0];
    const pc = text.match(/\*\*Pleasure Capacity:\*\* ([\d.]+)\/100/);
    const mc = text.match(/\*\*Mental Clarity:\*\* ([\d.]+)\/100/);
    const pv = text.match(/\*\*Physical Vitality:\*\* ([\d.]+)\/100/);
    const sa = text.match(/\*\*Spiritual Alignment:\*\* ([\d.]+)\/100/);
    const lu = text.match(/\*\*Last Updated:\*\* (.+)/);
    if (!pc || !mc || !pv || !sa) return undefined;
    return {
      pleasureCapacity: parseFloat(pc[1]),
      mentalClarity: parseFloat(mc[1]),
      physicalVitality: parseFloat(pv[1]),
      spiritualAlignment: parseFloat(sa[1]),
      lastUpdated: lu ? lu[1].trim() : 'Unknown'
    };
  }

  private extractRpgStats(content: string): RpgStats | undefined {
    const section = content.match(/## 💪 RPG STATS[\s\S]*?(?=\n## )/);
    if (!section) return undefined;
    const text = section[0];
    return {
      squat:       this.parseRpgLift(text, 'Squat'),
      deadlift:    this.parseRpgLift(text, 'Deadlift'),
      benchPress:  this.parseRpgLift(text, 'Bench Press'),
      overheadPress: this.parseRpgLift(text, 'Overhead Press')
    };
  }

  private parseRpgLift(sectionText: string, liftName: string): RpgLift {
    const escaped = liftName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = sectionText.match(new RegExp(`\\*\\*${escaped}:\\*\\* (.+?)(?:\\n|$)`));
    if (!match) return { value: '[TBD]' };
    const raw = match[1].trim();
    if (raw.startsWith('[TBD]')) return { value: '[TBD]' };
    const numMatch = raw.match(/^([\d.]+) lbs?/);
    const targetMatch = raw.match(/target ([^)]+)/);
    return {
      value: raw.split(' (')[0].trim(),
      numericValue: numMatch ? parseFloat(numMatch[1]) : undefined,
      target: targetMatch ? targetMatch[1].trim() : undefined
    };
  }

  private getVitalityStatus(percentage: number): VitalityData['status'] {
    if (percentage >= 90) return 'Excellent';
    if (percentage >= 75) return 'Good';
    if (percentage >= 50) return 'Fair';
    if (percentage >= 25) return 'Low';
    return 'Critical';
  }

  private extractTitles(content: string): TitleCollection {
    const active = this.extractActiveTitles(content);
    const locked = this.extractLockedTitles(content);
    const totalTitles = active.length + locked.length;
    const highestRarity = this.getHighestRarity(active);
    return { active, locked, totalTitles, highestRarity };
  }

  private extractActiveTitles(content: string): Title[] {
    const activeTitlesSection = content.match(/### Active Titles \(Earned\)([\s\S]*?)(?=### Locked Titles|---)/);
    if (!activeTitlesSection) return [];

    const titleBlocks = activeTitlesSection[1].match(/\*\*[^*]+\*\*[\s\S]*?(?=\n\*\*[^*]+\*\*|$)/g) || [];
    
    return titleBlocks.map(block => {
      const nameMatch = block.match(/\*\*(.+?)\*\*/);
      const requirementMatch = block.match(/\*\*Requirement:\*\* (.+?)(?:\s*✅)?\n/);
      const effectMatch = block.match(/\*\*Effect:\*\* (.+?)\n/);
      const earnedMatch = block.match(/\*\*Earned:\*\* (.+?)\n/);
      const rarityMatch = block.match(/\*\*Rarity:\*\* (.+?)(?:\s*\(|\n)/);

      const name = nameMatch ? nameMatch[1].replace(/[🌅⚡💻🔓📖🎯]/g, '').trim().replace(/"/g, '') : 'Unknown Title';
      const requirement = requirementMatch ? requirementMatch[1].trim() : '';
      const effect = effectMatch ? effectMatch[1].trim() : '';
      const earnedDateStr = earnedMatch ? earnedMatch[1].trim() : new Date().toISOString();
      const rarity = (rarityMatch ? rarityMatch[1].trim() : 'Common') as TitleRarity;

      return {
        id: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        icon: this.extractIcon(block),
        rarity,
        requirement,
        effect,
        earnedDate: new Date(earnedDateStr),
        equipped: false // Default to unequipped, user can equip via UI later
      };
    }).filter(title => title.name !== 'Unknown Title');
  }

  private extractLockedTitles(content: string): LockedTitle[] {
    const lockedTitlesSection = content.match(/### Locked Titles \(Not Yet Earned\)([\s\S]*?)(?=### Title Rarity System|---)/);
    if (!lockedTitlesSection) return [];

    // Each title starts with "**" followed by emoji and title name
    // Split on double newline followed by "**" and emoji pattern
    const titleText = lockedTitlesSection[1].trim();
    const titleBlocks: string[] = [];
    let currentBlock = '';
    const lines = titleText.split(/\r?\n/);
    
    for (const line of lines) {
      // Check if this line starts a new title (bold text with emoji at start)
      if (line.trim().startsWith('**') && /[💀😴🏃🥋🎓🔥⚔️🎨🧘🏆📈]/.test(line)) {
        if (currentBlock.trim().length > 0) {
          titleBlocks.push(currentBlock);
        }
        currentBlock = line + '\n';
      } else if (currentBlock.length > 0) {
        currentBlock += line + '\n';
      }
    }
    // Push the last block
    if (currentBlock.trim().length > 0) {
      titleBlocks.push(currentBlock);
    }
    
    return titleBlocks.map(block => {
      const nameMatch = block.match(/\*\*(.+?)\*\*/);
      const requirementMatch = block.match(/- \*\*Requirement:\*\* (.+?)(?:\s*\n|$)/);
      const effectMatch = block.match(/- \*\*Effect:\*\* (.+?)(?:\s*\n|$)/);
      const progressMatch = block.match(/- \*\*Progress:\*\* (.+?)(?:\s*\n|$)/);
      const estimatedMatch = block.match(/- \*\*Estimated:\*\* (.+?)(?:\s*\n|$)/);
      const rarityMatch = block.match(/- \*\*Rarity:\*\* (.+?)(?:\s*\n|$)/);

      const name = nameMatch ? nameMatch[1].replace(/[💀😴🏃🥋🎓🔥⚔️🎨🧘🏆📈]/g, '').trim().replace(/"/g, '') : 'Unknown Title';
      const requirement = requirementMatch ? requirementMatch[1].trim() : '';
      const effect = effectMatch ? effectMatch[1].trim() : '';
      const progressStr = progressMatch ? progressMatch[1].trim() : '0%';
      const estimatedStr = estimatedMatch ? estimatedMatch[1].trim() : 'Unknown';
      const rarity = (rarityMatch ? rarityMatch[1].trim() : 'Common') as TitleRarity;

      // Parse progress percentage
      let progress = 0;
      const percentMatch = progressStr.match(/([\d.]+)%/);
      if (percentMatch) {
        progress = parseFloat(percentMatch[1]);
      } else {
        // Try to parse fraction format like "11.36 / 5 hrs (44.1% to target)"
        const fractionMatch = progressStr.match(/([\d.]+)\s*\/\s*([\d.]+)/);
        if (fractionMatch) {
          const current = parseFloat(fractionMatch[1]);
          const target = parseFloat(fractionMatch[2]);
          progress = Math.round((current / target) * 100 * 10) / 10;
        } else {
          // Try "X/Y format" like "0/1", "2/5 trees"
          const slashMatch = progressStr.match(/(\d+)\/(\d+)/);
          if (slashMatch) {
            const current = parseInt(slashMatch[1]);
            const target = parseInt(slashMatch[2]);
            progress = target > 0 ? Math.round((current / target) * 100 * 10) / 10 : 0;
          }
        }
      }

      // Parse estimated unlock date (try to parse as date, fallback to undefined)
      let estimatedUnlock: Date | undefined;
      try {
        const parsedDate = new Date(estimatedStr);
        if (!isNaN(parsedDate.getTime())) {
          estimatedUnlock = parsedDate;
        }
      } catch {
        // If parsing fails, leave as undefined
      }

      return {
        id: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        icon: this.extractIcon(block),
        rarity,
        requirement,
        effect,
        progress,
        estimatedUnlock
      };
    }).filter(title => title.name !== 'Unknown Title');
  }

  private extractIcon(block: string): string {
    const iconMatch = block.match(/([🌅⚡💻🔓📖🎯💀😴🏃🥋🎓🔥⚔️🎨🧘🏆📈])+/);
    return iconMatch ? iconMatch[1] : '';
  }


  private getHighestRarity(titles: Title[]): TitleRarity {
    if (titles.length === 0) return 'Common';
    
    const rarityOrder: TitleRarity[] = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];
    
    for (const rarity of rarityOrder) {
      if (titles.some(t => t.rarity === rarity)) {
        return rarity;
      }
    }
    
    return 'Common';
  }

  // ─────────────────────────────────────────────
  // QUEST LINES PARSER
  // ─────────────────────────────────────────────

  private parseChapterStatus(statusStr: string): 'complete' | 'active' | 'locked' {
    if (statusStr.includes('✅') || statusStr.toLowerCase().includes('complete')) return 'complete';
    if (statusStr.includes('🟡') || statusStr.toLowerCase().includes('active') || statusStr.toLowerCase().includes('in progress')) return 'active';
    return 'locked';
  }

  private parseQuestLineBlock(block: string): QuestLine | null {
    const headerMatch = block.match(/### Quest Line (\d+): ([^\n]+)/);
    if (!headerMatch) return null;

    const number = parseInt(headerMatch[1], 10);
    const nameWithIcon = headerMatch[2].trim();

    // Icon: last emoji cluster
    const iconMatch = nameWithIcon.match(/([\u{1F300}-\u{1FFFF}⚔️🔪🏗️🛡️📈🎨★☆]+)$/u);
    const icon = iconMatch ? iconMatch[1].trim() : '';
    const name = nameWithIcon.replace(/([\u{1F300}-\u{1FFFF}⚔️🔪🏗️🛡️📈🎨★]+)$/u, '').trim();

    // Class and status line
    const classStatusMatch = block.match(/\*\*Class:\*\* ([^|]+)\|\s*\*\*Status:\*\* ([^\n]+)/);
    const className = classStatusMatch ? classStatusMatch[1].trim() : '';
    const statusRaw = classStatusMatch ? classStatusMatch[2].trim() : '';
    const statusEmojiMatch = statusRaw.match(/^([\u{1F7E2}\u{1F7E1}⬜🟢🟡]+)/u);
    const statusEmoji = statusEmojiMatch ? statusEmojiMatch[1] : '';
    const statusText = statusRaw.replace(/^[\u{1F7E2}\u{1F7E1}⬜🟢🟡]+\s*/u, '').trim();

    // Tagline
    const taglineMatch = block.match(/\*"([^"]+)"\*/);
    const tagline = taglineMatch ? taglineMatch[1] : '';

    // Chapter table rows
    const chapters: QuestChapter[] = [];
    const tableRowRegex = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm;
    let tableMatch: RegExpExecArray | null;
    while ((tableMatch = tableRowRegex.exec(block)) !== null) {
      const ch = tableMatch[1].trim();
      const milestone = tableMatch[2].trim();
      const statusStr = tableMatch[3].trim();
      if (ch === 'Chapter' || ch.startsWith('---') || ch.startsWith('|')) continue;
      chapters.push({
        chapter: ch.replace(/\*\*/g, '').trim(),
        milestone: milestone.replace(/\*\*/g, '').trim(),
        status: this.parseChapterStatus(statusStr),
        statusIcon: statusStr,
      });
    }

    // Current XP drivers
    const xpMatch = block.match(/\*\*Current XP drivers:\*\* ([^\n]+)/);
    const currentXpDrivers = xpMatch ? xpMatch[1].trim() : '';

    // Unlocks
    const unlocksMatch = block.match(/\*\*What (?:this |unlocks )?unlocks.*?:\*\* ([^\n]+)/);
    const unlocks = unlocksMatch ? unlocksMatch[1].trim() : '';

    return {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      number,
      name,
      icon,
      class: className,
      statusText,
      statusEmoji,
      tagline,
      chapters,
      currentXpDrivers,
      unlocks,
    };
  }

  extractQuestLines(content: string): QuestLine[] {
    const sectionMatch = content.match(/`\[QUEST-LINES-BEGIN\]`([\s\S]*?)`\[QUEST-LINES-END\]`/);
    if (!sectionMatch) return [];

    const section = sectionMatch[1];
    const blocks = section.split(/(?=### Quest Line \d+:)/);
    const questLines: QuestLine[] = [];

    for (const block of blocks) {
      if (!block.trim().startsWith('### Quest Line')) continue;
      const ql = this.parseQuestLineBlock(block);
      if (ql) questLines.push(ql);
    }

    return questLines;
  }

  private extractGrandConvergence(content: string): GrandConvergence | undefined {
    const sectionMatch = content.match(/`\[QUEST-LINES-BEGIN\]`([\s\S]*?)`\[QUEST-LINES-END\]`/);
    if (!sectionMatch) return undefined;

    const convergenceMatch = sectionMatch[1].match(/### ★ GRAND CONVERGENCE[\s\S]*?(?=---\s*`\[QUEST-LINES-END\]`)/);
    if (!convergenceMatch) return undefined;

    const block = convergenceMatch[0];
    const conditions: GrandConvergenceCondition[] = [];
    const rowRegex = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm;
    let m: RegExpExecArray | null;
    while ((m = rowRegex.exec(block)) !== null) {
      const condition = m[1].trim();
      const questLine = m[2].trim();
      const statusStr = m[3].trim();
      if (condition === 'Convergence Condition' || condition.startsWith('---')) continue;
      conditions.push({
        condition,
        questLine,
        complete: statusStr.includes('✅'),
      });
    }

    return {
      conditions,
      allComplete: conditions.length > 0 && conditions.every(c => c.complete),
    };
  }
}

