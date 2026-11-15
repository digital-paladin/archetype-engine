import { XpCalculatorService } from './xpCalculator.service';
import type { ActivityEntry } from './data/IDataService';
import type { TogglTimeEntry } from './togglTrack.service';
import {
  CASUAL_SOCIAL_WEEKLY_CAP,
  CASUAL_SOCIAL_XP,
  CHARISMA_CLASS,
  DEEP_WORK_ACTIVITY_TYPES,
  DEEP_WORK_XP_FLOOR,
  SOCIAL_DYNAMICS_CLASS,
  SOCIAL_SKILL_BASE_XP,
  SOCIAL_SKILL_DURATION_MULTIPLIER,
} from '../config/socialXp.config';
import {
  casualXpAwardedInWeek,
  chicagoWeekContaining,
  collectScheduleBlocks,
  evaluateSocialXp,
  loadCalendarBlocks,
  type ScheduleBlock,
  type SocialXpInput,
} from './socialXp.service';

const REFLECTION = 'Named the goal beforehand and noted one thing to repeat.';

function event(partial: Partial<SocialXpInput> & Pick<SocialXpInput, 'skillGoals' | 'reflection'>): SocialXpInput {
  return {
    activityType: 'social',
    startMs: Date.parse('2026-10-20T18:00:00.000Z'),
    endMs: Date.parse('2026-10-20T18:30:00.000Z'),
    durationMinutes: 30,
    scheduleBlocks: [],
    casualXpAwardedThisWeek: 0,
    ...partial,
  };
}

function block(partial: Partial<ScheduleBlock> & Pick<ScheduleBlock, 'kind' | 'startMs' | 'endMs'>): ScheduleBlock {
  return { source: 'activity-log', label: partial.kind, ...partial };
}

describe('social XP rules', () => {
  it('pays skill XP only when a skill goal and a reflection are both present', () => {
    const paid = evaluateSocialXp(event({
      skillGoals: ['networking'],
      reflection: REFLECTION,
    }));
    expect(paid.mode).toBe('skill');
    expect(paid.totalXp).toBe(SOCIAL_SKILL_BASE_XP + Math.floor(30 * SOCIAL_SKILL_DURATION_MULTIPLIER));
    expect(paid.awards).toEqual([
      expect.objectContaining({
        className: SOCIAL_DYNAMICS_CLASS,
        tree: 'social-dynamics',
        xp: paid.totalXp,
        skills: [expect.objectContaining({ id: 'networking' })],
      }),
    ]);

    const noReflection = evaluateSocialXp(event({
      skillGoals: ['networking'],
      reflection: '   ',
    }));
    expect(noReflection.mode).toBe('none');
    expect(noReflection.totalXp).toBe(0);
    expect(noReflection.reasons).toContain('reflection_required');
    expect(noReflection.casualXp).toBe(0);

    const oneWord = evaluateSocialXp(event({
      skillGoals: ['public speaking'],
      reflection: 'ok',
    }));
    expect(oneWord.mode).toBe('skill');
    expect(oneWord.awards[0].className).toBe(CHARISMA_CLASS);
  });

  it('maps practice goals onto Social Dynamics and Charisma', () => {
    const cases: Array<{ goal: string; className: string }> = [
      { goal: 'reading people', className: SOCIAL_DYNAMICS_CLASS },
      { goal: 'reading rooms', className: SOCIAL_DYNAMICS_CLASS },
      { goal: 'networking', className: SOCIAL_DYNAMICS_CLASS },
      { goal: 'group dynamics', className: SOCIAL_DYNAMICS_CLASS },
      { goal: 'hosting', className: SOCIAL_DYNAMICS_CLASS },
      { goal: 'rapport', className: SOCIAL_DYNAMICS_CLASS },
      { goal: 'conflict', className: SOCIAL_DYNAMICS_CLASS },
      { goal: 'hard conversation', className: SOCIAL_DYNAMICS_CLASS },
      { goal: 'presence', className: CHARISMA_CLASS },
      { goal: 'storytelling', className: CHARISMA_CLASS },
      { goal: 'humor', className: CHARISMA_CLASS },
      { goal: 'confident approaches', className: CHARISMA_CLASS },
      { goal: 'stranger conversation', className: CHARISMA_CLASS },
      { goal: 'public speaking', className: CHARISMA_CLASS },
    ];
    for (const { goal, className } of cases) {
      const result = evaluateSocialXp(event({ skillGoals: [goal], reflection: REFLECTION }));
      expect(result.awards.map(award => award.className)).toEqual([className]);
    }
  });

  it('pays both trees only when the event names a skill for each', () => {
    const both = evaluateSocialXp(event({
      skillGoals: ['networking', 'public speaking'],
      reflection: REFLECTION,
    }));
    expect(both.awards.map(award => award.className)).toEqual([
      SOCIAL_DYNAMICS_CLASS,
      CHARISMA_CLASS,
    ]);
    expect(both.awards[0].xp).toBe(both.awards[1].xp);
    expect(both.totalXp).toBe(both.awards[0].xp * 2);

    const oneTree = evaluateSocialXp(event({
      skillGoals: ['storytelling', 'humor'],
      reflection: REFLECTION,
    }));
    expect(oneTree.awards).toHaveLength(1);
    expect(oneTree.awards[0].className).toBe(CHARISMA_CLASS);
    expect(oneTree.awards[0].skills.map(skill => skill.id)).toEqual(['storytelling', 'humor']);
    expect(oneTree.totalXp).toBe(both.awards[0].xp);

    const commaList = evaluateSocialXp(event({
      skillGoals: 'hosting, storytelling',
      reflection: REFLECTION,
    }));
    expect(commaList.awards.map(award => award.tree)).toEqual(['social-dynamics', 'charisma']);
  });

  it('reads a skill named by the activity type', () => {
    const result = evaluateSocialXp(event({
      activityType: 'social-hard-conversation',
      skillGoals: undefined,
      reflection: REFLECTION,
    }));
    expect(result.awards[0]).toEqual(expect.objectContaining({
      className: SOCIAL_DYNAMICS_CLASS,
      skills: [expect.objectContaining({ id: 'conflict' })],
    }));
  });

  it('does not treat an unrecognized goal as casual time', () => {
    const result = evaluateSocialXp(event({
      skillGoals: ['small talk'],
      reflection: REFLECTION,
    }));
    expect(result.mode).toBe('none');
    expect(result.totalXp).toBe(0);
    expect(result.reasons).toContain('unrecognized_skill_goal');
    expect(result.casualXp).toBe(0);
  });

  it('flags an overlap with a work or training block and pays 0', () => {
    const start = Date.parse('2026-10-20T18:00:00.000Z');
    const work = block({
      kind: 'work',
      startMs: start - 30 * 60_000,
      endMs: start + 30 * 60_000,
      label: 'personal-project',
    });
    const training = block({
      kind: 'training',
      startMs: start + 60 * 60_000,
      endMs: start + 120 * 60_000,
      label: 'workout-strength',
    });

    const duringWork = evaluateSocialXp(event({
      skillGoals: ['networking'],
      reflection: REFLECTION,
      scheduleBlocks: [work, training],
    }));
    expect(duringWork.totalXp).toBe(0);
    expect(duringWork.mode).toBe('none');
    expect(duringWork.flags.map(flag => flag.kind)).toEqual(['work']);
    expect(duringWork.reasons).toEqual(['schedule_overlap']);

    const duringTraining = evaluateSocialXp(event({
      skillGoals: [],
      reflection: null,
      startMs: training.startMs + 60_000,
      endMs: training.endMs - 60_000,
      scheduleBlocks: [work, training],
    }));
    expect(duringTraining.totalXp).toBe(0);
    expect(duringTraining.casualXp).toBe(0);
    expect(duringTraining.flags.map(flag => flag.kind)).toEqual(['training']);

    const touching = evaluateSocialXp(event({
      skillGoals: ['networking'],
      reflection: REFLECTION,
      startMs: work.endMs,
      endMs: work.endMs + 30 * 60_000,
      scheduleBlocks: [work],
    }));
    expect(touching.mode).toBe('skill');
    expect(touching.flags).toEqual([]);
  });

  it('does not invent a block when the calendar hook is empty', () => {
    expect(loadCalendarBlocks()).toEqual([]);
    const blocks = collectScheduleBlocks({
      calendarBlocks: loadCalendarBlocks(),
      activityLog: [],
      togglEntries: [{
        id: 'unmapped',
        description: 'Desk time',
        projectName: 'Client delivery',
        tags: [],
        start: '2026-10-20T15:00:00.000Z',
        stop: '2026-10-20T17:00:00.000Z',
        duration: 7200,
      }],
    });
    expect(blocks).toEqual([]);

    const paid = evaluateSocialXp(event({
      skillGoals: ['rapport'],
      reflection: REFLECTION,
      scheduleBlocks: blocks,
    }));
    expect(paid.mode).toBe('skill');
    expect(paid.flags).toEqual([]);
  });

  it('builds training blocks from workout-mapped Toggl entries and timed activity rows', () => {
    const toggl: TogglTimeEntry = {
      id: 'toggl-1',
      description: 'Tuesday session',
      projectName: 'Sambo',
      tags: [],
      start: '2026-10-20T23:00:00.000Z',
      stop: '2026-10-21T00:00:00.000Z',
      duration: 3600,
    };
    const log = [
      {
        id: 'work-1',
        user_id: 'user-1',
        class_name: 'Developer',
        activity_type: 'personal-project',
        logged_at: '2026-10-20T15:00:00.000Z',
        duration_hours: 1,
      },
      {
        id: 'train-1',
        user_id: 'user-1',
        class_name: 'Warrior',
        activity_type: 'workout-strength',
        logged_at: '2026-10-20T16:00:00.000Z',
        duration_hours: '0.50',
      },
      {
        user_id: 'user-1',
        class_name: 'Warrior',
        activity_type: 'workout-cardio',
        logged_at: '2026-10-20T12:00:00.000Z',
      },
      {
        user_id: 'user-1',
        class_name: 'Sage',
        activity_type: 'admin-planning',
        logged_at: '2026-10-20T13:00:00.000Z',
        duration_hours: 1,
      },
      {
        user_id: 'user-1',
        class_name: 'Social',
        activity_type: 'social',
        logged_at: '2026-10-20T17:00:00.000Z',
        duration_hours: 1,
      },
    ];

    const blocks = collectScheduleBlocks({ activityLog: log, togglEntries: [toggl] });
    expect(blocks).toEqual([
      expect.objectContaining({ kind: 'work', source: 'activity-log', sourceId: 'work-1', label: 'personal-project' }),
      expect.objectContaining({ kind: 'training', source: 'activity-log', sourceId: 'train-1' }),
      expect.objectContaining({ kind: 'training', source: 'toggl', sourceId: 'toggl-1', label: 'Sambo' }),
    ]);

    const duringSambo = evaluateSocialXp(event({
      skillGoals: ['stranger conversation'],
      reflection: REFLECTION,
      startMs: Date.parse('2026-10-20T23:15:00.000Z'),
      endMs: Date.parse('2026-10-20T23:45:00.000Z'),
      scheduleBlocks: blocks,
    }));
    expect(duringSambo.totalXp).toBe(0);
    expect(duringSambo.flags).toEqual([
      expect.objectContaining({ kind: 'training', source: 'toggl', label: 'Sambo' }),
    ]);
  });

  it('pays a flat casual amount and stops at the weekly cap', () => {
    const open = evaluateSocialXp(event({ skillGoals: [], reflection: null }));
    expect(open.mode).toBe('casual');
    expect(open.casualXp).toBe(CASUAL_SOCIAL_XP);
    expect(open.awards).toEqual([
      expect.objectContaining({ className: SOCIAL_DYNAMICS_CLASS, tree: 'social-dynamics', xp: CASUAL_SOCIAL_XP, skills: [] }),
    ]);
    expect(open.reasons).toContain('no_skill_goal');
    expect(open.reasons).toContain('casual_tree_default');

    const partial = evaluateSocialXp(event({
      skillGoals: undefined,
      reflection: REFLECTION,
      casualXpAwardedThisWeek: CASUAL_SOCIAL_WEEKLY_CAP - 1,
    }));
    expect(partial.mode).toBe('casual');
    expect(partial.casualXp).toBe(1);
    expect(partial.awards[0].xp).toBe(1);
    expect(partial.casualXpWithheld).toBe(CASUAL_SOCIAL_XP - 1);
    expect(partial.reasons).toContain('weekly_cap');

    const closed = evaluateSocialXp(event({
      skillGoals: [],
      reflection: null,
      casualXpAwardedThisWeek: CASUAL_SOCIAL_WEEKLY_CAP,
    }));
    expect(closed.mode).toBe('none');
    expect(closed.totalXp).toBe(0);
    expect(closed.reasons).toContain('weekly_cap');

    const stillPractice = evaluateSocialXp(event({
      skillGoals: ['conflict'],
      reflection: REFLECTION,
      casualXpAwardedThisWeek: CASUAL_SOCIAL_WEEKLY_CAP,
    }));
    expect(stillPractice.mode).toBe('skill');
    expect(stillPractice.totalXp).toBeGreaterThan(CASUAL_SOCIAL_WEEKLY_CAP);
  });

  it('keeps a capped casual week below one minimum deep-work award', () => {
    const calc = new XpCalculatorService();
    const bases = calc.getActivityTypes();
    const deepWorkBases = DEEP_WORK_ACTIVITY_TYPES.map(type => {
      const found = bases.find(entry => entry.type === type);
      expect(found).toBeDefined();
      return found!.baseXP;
    });
    const floor = Math.min(...deepWorkBases);
    expect(floor).toBe(DEEP_WORK_XP_FLOOR);
    expect(CASUAL_SOCIAL_WEEKLY_CAP).toBeLessThan(floor);
    expect(CASUAL_SOCIAL_XP).toBeLessThanOrEqual(CASUAL_SOCIAL_WEEKLY_CAP);

    let awarded = 0;
    for (let i = 0; i < 20; i++) {
      const result = evaluateSocialXp(event({
        skillGoals: [],
        reflection: null,
        casualXpAwardedThisWeek: awarded,
      }));
      awarded += result.casualXp;
    }
    expect(awarded).toBe(CASUAL_SOCIAL_WEEKLY_CAP);
    expect(awarded).toBeLessThan(floor);
    expect(awarded).toBeLessThan(calc.calculateXP('art-music', 60));
    expect(calc.calculateXP('art-music', 60)).toBe(
      SOCIAL_SKILL_BASE_XP + Math.floor(60 * SOCIAL_SKILL_DURATION_MULTIPLIER),
    );
  });

  it('credits casual XP to the tree named by the activity, or the default tree', () => {
    const dynamics = ['networking lunch', 'group workshop', 'rapport chat'];
    for (const label of dynamics) {
      const result = evaluateSocialXp(event({ skillGoals: [], reflection: null, label }));
      expect(result.awards[0].className).toBe(SOCIAL_DYNAMICS_CLASS);
      expect(result.reasons).toContain('casual_tree_inferred');
      expect(result.totalXp).toBe(CASUAL_SOCIAL_XP);
    }

    const charisma = ['presence drill', 'storytelling night', 'humor set', 'speaking practice'];
    for (const notes of charisma) {
      const result = evaluateSocialXp(event({ skillGoals: [], reflection: null, notes }));
      expect(result.awards[0].className).toBe(CHARISMA_CLASS);
    }

    const tie = evaluateSocialXp(event({
      skillGoals: [],
      reflection: null,
      label: 'group',
      notes: 'humor',
    }));
    expect(tie.awards[0].className).toBe(SOCIAL_DYNAMICS_CLASS);
    expect(tie.reasons).toContain('casual_tree_default');
  });

  it('counts casual tags inside the America/Chicago week that starts Sunday', () => {
    const instant = new Date('2026-10-20T18:00:00.000Z');
    const week = chicagoWeekContaining(instant);
    expect(week.startDate).toBe('2026-10-18');
    expect(new Date(week.startMs).toISOString()).toBe('2026-10-18T05:00:00.000Z');
    expect(new Date(week.endMs).toISOString()).toBe('2026-10-25T05:00:00.000Z');
    expect(week.endMs - week.startMs).toBe(7 * 24 * 60 * 60 * 1000);

    const rows: ActivityEntry[] = [
      {
        user_id: 'user-1',
        class_name: 'Social Dynamics',
        activity_type: 'social',
        logged_at: '2026-10-18T04:59:00.000Z',
        notes: '[social-xp:casual:2]',
      },
      {
        user_id: 'user-1',
        class_name: 'Social Dynamics',
        activity_type: 'social',
        logged_at: '2026-10-18T05:00:00.000Z',
        notes: 'Noted the room. [social-xp:casual:2]',
      },
      {
        user_id: 'user-1',
        class_name: 'Social Dynamics',
        activity_type: 'social',
        logged_at: '2026-10-21T18:00:00.000Z',
        notes: '[social-xp:skill:16]',
      },
      {
        user_id: 'user-1',
        class_name: 'Charisma',
        activity_type: 'social',
        logged_at: '2026-10-25T05:00:00.000Z',
        notes: '[social-xp:casual:2]',
      },
    ];
    expect(casualXpAwardedInWeek(rows, week.startMs, week.endMs)).toBe(2);
  });

  it('does not zero skill XP when the event has no interval to compare', () => {
    const result = evaluateSocialXp({
      activityType: 'social',
      startMs: null,
      endMs: null,
      durationMinutes: null,
      skillGoals: ['rapport'],
      reflection: REFLECTION,
      scheduleBlocks: [block({
        kind: 'work',
        startMs: Date.parse('2026-10-20T15:00:00.000Z'),
        endMs: Date.parse('2026-10-20T17:00:00.000Z'),
      })],
    });
    expect(result.mode).toBe('skill');
    expect(result.reasons).toContain('interval_unknown');
    expect(result.flags).toEqual([]);
    expect(result.totalXp).toBe(SOCIAL_SKILL_BASE_XP);
  });
});
