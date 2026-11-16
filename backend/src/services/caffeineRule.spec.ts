import { JournalEntry } from './data/IDataService';
import { correctConsumption, logConsumption } from './consumption.service';
import { getLogs, resetActivityLogForTests } from './activityLogStore';
import { getStatusEffectStore, MemoryStatusEffectStore, setStatusEffectStore } from './statusEffect.store';
import { MemorySystemQuestStore, setSystemQuestStore } from './systemQuest.store';
import {
  CAFFEINE_RULE_XP,
  CAFFEINATED_KEY,
  SLEEP_RISK_KEY,
  caffeineSleepFlagLine,
  caffeineWindow,
  chicagoDateOf,
  dailyCaffeineMg,
  dayTriggersSleepRisk,
  isAtOrAfterChicagoAfternoon,
  nextChicagoMorning,
  readCaffeineSleepFlag,
  syncCaffeineRule,
} from './caffeineRule';

function journalFake() {
  const rows = new Map<string, JournalEntry>();
  return {
    rows,
    async getJournalEntry(userId: string, date: string): Promise<JournalEntry | null> {
      return rows.get(`${userId}:${date}`) ?? null;
    },
    async upsertJournalEntry(userId: string, entry: Partial<JournalEntry>): Promise<void> {
      const key = `${userId}:${entry.entry_date}`;
      const prev = rows.get(key);
      rows.set(key, {
        ...(prev ?? { user_id: userId, entry_date: entry.entry_date! }),
        ...entry,
        user_id: userId,
      });
    },
    async listJournalFoodDays(userId: string) {
      const days = [];
      for (const [key, row] of rows) {
        if (!key.startsWith(`${userId}:`) || !Array.isArray(row.food_log)) continue;
        days.push({ entry_date: row.entry_date, food_log: row.food_log ?? [] });
      }
      return days;
    },
  };
}

const USER = 'player-1';

describe('caffeine clock', () => {
  it('treats 2:00 PM America/Chicago as the cutoff in both CST and CDT', () => {
    const before = [
      '2026-01-15T19:59:00.000Z', // 1:59 PM CST
      '2026-07-15T18:59:00.000Z', // 1:59 PM CDT
      '2026-03-08T18:59:00.000Z', // 1:59 PM CDT, spring-forward day
      '2026-11-01T19:59:00.000Z', // 1:59 PM CST, fall-back day
    ];
    const after = [
      '2026-01-15T20:00:00.000Z', // 2:00 PM CST
      '2026-07-15T19:00:00.000Z', // 2:00 PM CDT
      '2026-03-08T19:00:00.000Z', // 2:00 PM CDT, spring-forward day
      '2026-11-01T20:00:00.000Z', // 2:00 PM CST, fall-back day
    ];
    for (const iso of before) expect(isAtOrAfterChicagoAfternoon(new Date(iso))).toBe(false);
    for (const iso of after) expect(isAtOrAfterChicagoAfternoon(new Date(iso))).toBe(true);
  });

  it('puts the next morning at 6:00 AM America/Chicago across the DST changes', () => {
    expect(nextChicagoMorning('2026-01-15').toISOString()).toBe('2026-01-16T12:00:00.000Z');
    expect(nextChicagoMorning('2026-07-15').toISOString()).toBe('2026-07-16T11:00:00.000Z');
    expect(nextChicagoMorning('2026-03-07').toISOString()).toBe('2026-03-08T11:00:00.000Z');
    expect(nextChicagoMorning('2026-03-08').toISOString()).toBe('2026-03-09T11:00:00.000Z');
    expect(nextChicagoMorning('2026-10-31').toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(nextChicagoMorning('2026-11-01').toISOString()).toBe('2026-11-02T12:00:00.000Z');
  });

  it('keeps the daily total on the Chicago calendar day, including the UTC date change', () => {
    const late = { at: '2026-11-15T05:59:00.000Z', mg: 300, itemName: 'Late' };
    const early = { at: '2026-11-15T06:00:00.000Z', mg: 300, itemName: 'Early' };
    expect(chicagoDateOf(new Date(late.at))).toBe('2026-11-14');
    expect(chicagoDateOf(new Date(early.at))).toBe('2026-11-15');
    expect(dailyCaffeineMg([late, early], '2026-11-14')).toBe(300);
    expect(dailyCaffeineMg([late, early], '2026-11-15')).toBe(300);
  });

  it('triggers sleep risk after 2:00 PM or over 400 mg, and not at exactly 400 mg', () => {
    const morning = (mg: number, hourUtc: string) => ({
      at: `2026-11-15T${hourUtc}:00:00.000Z`,
      mg,
      itemName: 'Coffee',
    });
    const under = [morning(200, '15'), morning(200, '16')];
    expect(dailyCaffeineMg(under, '2026-11-15')).toBe(400);
    expect(dayTriggersSleepRisk(under, '2026-11-15')).toBe(false);
    expect(dayTriggersSleepRisk([...under, morning(1, '17')], '2026-11-15')).toBe(true);
    expect(dayTriggersSleepRisk([morning(95, '20')], '2026-11-15')).toBe(true);
    expect(dayTriggersSleepRisk([morning(95, '19')], '2026-11-15')).toBe(false);
  });

  it('extends a window that is still open and starts a new one at the exact expiry', () => {
    const first = { at: '2026-11-15T16:00:00.000Z', mg: 95, itemName: 'Coffee' };
    const extended = caffeineWindow([
      first,
      { at: '2026-11-15T20:59:00.000Z', mg: 50, itemName: 'Tea' },
    ], new Date('2026-11-15T20:59:00.000Z'));
    expect(extended!.start.toISOString()).toBe(first.at);
    expect(extended!.end.toISOString()).toBe('2026-11-16T01:59:00.000Z');
    expect(extended!.doses).toHaveLength(2);

    const restarted = caffeineWindow([
      first,
      { at: '2026-11-15T21:00:00.000Z', mg: 50, itemName: 'Tea' },
    ], new Date('2026-11-15T21:00:00.000Z'));
    expect(restarted!.start.toISOString()).toBe('2026-11-15T21:00:00.000Z');
    expect(restarted!.end.toISOString()).toBe('2026-11-16T02:00:00.000Z');
    expect(restarted!.doses).toHaveLength(1);
  });
});

describe('caffeine sleep flag', () => {
  const late = { at: '2026-11-14T20:00:00.000Z', mg: 95, itemName: 'Coffee' };
  const early = { at: '2026-11-14T19:59:00.000Z', mg: 95, itemName: 'Coffee' };

  it('flags a score under 70 only when the prior Chicago day had caffeine at or after 2:00 PM', () => {
    const line = caffeineSleepFlagLine(69, [late]);
    expect(line).toBe('Sleep score 69 after caffeine at or after 2:00 PM America/Chicago the prior day.');
    expect(line).not.toMatch(/more caffeine|another cup|take caffeine/i);
    expect(caffeineSleepFlagLine(70, [late])).toBeNull();
    expect(caffeineSleepFlagLine(69, [early])).toBeNull();
    expect(caffeineSleepFlagLine(null, [late])).toBeNull();
    expect(caffeineSleepFlagLine(0, [late])).toBeNull();
    expect(caffeineSleepFlagLine(69, [])).toBeNull();
  });

  it('uses the prior Chicago day on both sides of DST and reports no XP change', async () => {
    const summer = await readCaffeineSleepFlag(USER, '2026-07-16', {
      sleepScore: async () => 64,
      intakes: async () => [{ at: '2026-07-15T19:00:00.000Z', mg: 80, itemName: 'Coffee' }],
    });
    expect(summer.flagged).toBe(true);
    expect(summer.xpDelta).toBe(0);
    expect(summer.priorDate).toBe('2026-07-15');

    const winter = await readCaffeineSleepFlag(USER, '2026-11-02', {
      sleepScore: async () => 64,
      intakes: async () => [{ at: '2026-11-01T19:59:00.000Z', mg: 80, itemName: 'Coffee' }],
    });
    expect(winter.flagged).toBe(false);
    expect(winter.xpDelta).toBe(CAFFEINE_RULE_XP);

    const sameNight = await readCaffeineSleepFlag(USER, '2026-11-15', {
      sleepScore: async () => 64,
      intakes: async () => [{ at: '2026-11-15T20:00:00.000Z', mg: 80, itemName: 'Coffee' }],
    });
    expect(sameNight.flagged).toBe(false);
  });
});

describe('logConsumption caffeine rule', () => {
  let journal: ReturnType<typeof journalFake>;

  beforeEach(() => {
    setStatusEffectStore(new MemoryStatusEffectStore());
    setSystemQuestStore(new MemorySystemQuestStore());
    resetActivityLogForTests();
    journal = journalFake();
  });

  async function logCaffeine(key: string, mg: number, at: string) {
    return logConsumption(USER, {
      idempotencyKey: key,
      itemName: 'Coffee',
      caffeineMg: mg,
      consumedAt: at,
    }, { journal, notifySystem: false });
  }

  it('creates one status-only buff, extends it, and does not award XP', async () => {
    const first = await logCaffeine('cup-1', 95, '2026-11-15T16:00:00.000Z');
    const buff = first.effects.find(effect => effect.effectKey === CAFFEINATED_KEY);
    expect(buff?.name).toBe('Caffeinated');
    expect(buff?.effects).toEqual([]);
    expect(buff?.appliedAt).toBe('2026-11-15T16:00:00.000Z');
    expect(buff?.expiresAt).toBe('2026-11-15T21:00:00.000Z');
    expect(buff?.meta).toMatchObject({ xp: 0, fatBurn: false });
    expect(first.effects.find(effect => effect.effectKey === SLEEP_RISK_KEY)).toBeUndefined();
    expect(first).not.toHaveProperty('xp');
    expect(first).not.toHaveProperty('xpAwarded');
    expect(getLogs()).toEqual([]);
    const ruled = first.effects.filter(effect => effect.effectKey === CAFFEINATED_KEY || effect.effectKey === SLEEP_RISK_KEY);
    expect(ruled).toHaveLength(1);
    expect(ruled.every(effect => effect.effects.length === 0)).toBe(true);
    expect(JSON.stringify(first.effects)).not.toMatch(/Fat Oxidation|fat-burning|XP Consolidation/i);
    expect(first.noticeBody ?? '').not.toMatch(/more caffeine|another cup|take caffeine/i);

    const second = await logCaffeine('cup-2', 50, '2026-11-15T18:00:00.000Z');
    const extended = second.effects.find(effect => effect.effectKey === CAFFEINATED_KEY);
    expect(extended?.id).toBe(buff?.id);
    expect(extended?.appliedAt).toBe('2026-11-15T16:00:00.000Z');
    expect(extended?.expiresAt).toBe('2026-11-15T23:00:00.000Z');
    expect(extended?.dose).toBe('50 mg caffeine');
    const rows = await getStatusEffectStore().listAll(USER);
    expect(rows.filter(effect => effect.effectKey === CAFFEINATED_KEY)).toHaveLength(1);
  });

  it('does not duplicate the buff when the same intake is posted again', async () => {
    const first = await logCaffeine('cup-same', 95, '2026-11-15T16:00:00.000Z');
    const replay = await logCaffeine('cup-same', 95, '2026-11-15T16:00:00.000Z');
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.effects.find(effect => effect.effectKey === CAFFEINATED_KEY)?.id)
      .toBe(first.effects.find(effect => effect.effectKey === CAFFEINATED_KEY)?.id);
    const day = journal.rows.get(`${USER}:2026-11-15`);
    expect(day?.food_log).toHaveLength(1);
    const rows = await getStatusEffectStore().listAll(USER);
    expect(rows.filter(effect => effect.effectKey === CAFFEINATED_KEY)).toHaveLength(1);
    expect(getLogs()).toEqual([]);
  });

  it('applies sleep risk at 2:00 PM Central and not at 1:59 PM, in winter and summer', async () => {
    const earlyWinter = await logCaffeine('early-cst', 40, '2026-01-15T19:59:00.000Z');
    expect(earlyWinter.effects.find(effect => effect.effectKey === SLEEP_RISK_KEY)).toBeUndefined();

    const lateWinter = await logCaffeine('late-cst', 40, '2026-01-15T20:00:00.000Z');
    const winterRisk = lateWinter.effects.find(effect => effect.effectKey === SLEEP_RISK_KEY);
    expect(winterRisk?.name).toBe('Sleep Risk');
    expect(winterRisk?.effects).toEqual([]);
    expect(winterRisk?.expiresAt).toBe('2026-01-16T12:00:00.000Z');
    expect(winterRisk?.meta).toMatchObject({ xp: 0, chicagoDate: '2026-01-15' });

    const lateSummer = await logCaffeine('late-cdt', 40, '2026-07-15T19:00:00.000Z');
    expect(lateSummer.effects.find(effect => effect.effectKey === SLEEP_RISK_KEY)?.expiresAt)
      .toBe('2026-07-16T11:00:00.000Z');
  });

  it('applies sleep risk when the Chicago day goes over 400 mg and clears it if the total is corrected', async () => {
    await logCaffeine('am-1', 200, '2026-11-15T15:00:00.000Z');
    const atLimit = await logCaffeine('am-2', 200, '2026-11-15T16:00:00.000Z');
    expect(atLimit.effects.find(effect => effect.effectKey === SLEEP_RISK_KEY)).toBeUndefined();

    const over = await logCaffeine('am-3', 1, '2026-11-15T17:00:00.000Z');
    const risk = over.effects.find(effect => effect.effectKey === SLEEP_RISK_KEY);
    expect(risk?.dose).toContain('401 mg on 2026-11-15');
    expect(risk?.expiresAt).toBe('2026-11-16T12:00:00.000Z');
    expect(risk?.effects).toEqual([]);
    expect(getLogs()).toEqual([]);

    const corrected = await correctConsumption(USER, over.id, {
      idempotencyKey: 'am-3-fix',
      caffeineMg: 0,
    }, { journal });
    expect(corrected.effects.find(effect => effect.effectKey === SLEEP_RISK_KEY)).toBeUndefined();
    const rows = await getStatusEffectStore().listAll(USER);
    expect(rows.some(effect => effect.effectKey === SLEEP_RISK_KEY)).toBe(false);
    expect(rows.filter(effect => effect.effectKey === CAFFEINATED_KEY)).toHaveLength(1);
  });

  it('keeps the buff when a later non-caffeine intake is logged', async () => {
    const coffee = await logCaffeine('keep', 95, '2026-11-15T16:00:00.000Z');
    await logConsumption(USER, {
      idempotencyKey: 'water',
      itemName: 'Water',
      waterOz: 8,
      consumedAt: '2026-11-15T17:00:00.000Z',
    }, { journal, notifySystem: false });
    const rows = await getStatusEffectStore().listAll(USER);
    expect(rows.find(effect => effect.effectKey === CAFFEINATED_KEY)?.id)
      .toBe(coffee.effects.find(effect => effect.effectKey === CAFFEINATED_KEY)?.id);
  });

  it('removes both effects when the only caffeine dose is corrected to zero', async () => {
    const logged = await logCaffeine('only', 120, '2026-11-15T20:00:00.000Z');
    expect(logged.effects.some(effect => effect.effectKey === CAFFEINATED_KEY)).toBe(true);
    expect(logged.effects.some(effect => effect.effectKey === SLEEP_RISK_KEY)).toBe(true);

    await correctConsumption(USER, logged.id, {
      idempotencyKey: 'only-clear',
      caffeineMg: 0,
    }, { journal });
    const rows = await getStatusEffectStore().listAll(USER);
    expect(rows.some(effect => effect.effectKey === CAFFEINATED_KEY || effect.effectKey === SLEEP_RISK_KEY)).toBe(false);
    expect(getLogs()).toEqual([]);
  });

  it('still applies the buff when the journal cannot list every food day', async () => {
    const narrow = {
      async getJournalEntry(userId: string, date: string): Promise<JournalEntry | null> {
        return journal.rows.get(`${userId}:${date}`) ?? null;
      },
      async upsertJournalEntry(userId: string, entry: Partial<JournalEntry>): Promise<void> {
        await journal.upsertJournalEntry(userId, entry);
      },
    };
    const logged = await logConsumption(USER, {
      idempotencyKey: 'narrow',
      itemName: 'Coffee',
      caffeineMg: 80,
      consumedAt: '2026-07-15T19:00:00.000Z',
    }, { journal: narrow, notifySystem: false });
    const buff = logged.effects.find(effect => effect.effectKey === CAFFEINATED_KEY);
    expect(buff?.expiresAt).toBe('2026-07-16T00:00:00.000Z');
    expect(logged.effects.find(effect => effect.effectKey === SLEEP_RISK_KEY)?.expiresAt)
      .toBe('2026-07-16T11:00:00.000Z');
  });

  it('reuses the same row when the same doses are projected twice', async () => {
    const doses = [{ at: '2026-11-15T20:00:00.000Z', mg: 95, itemName: 'Coffee', entryId: 'e1' }];
    const first = await syncCaffeineRule(USER, doses);
    const second = await syncCaffeineRule(USER, doses);
    expect(second.find(effect => effect.effectKey === CAFFEINATED_KEY)?.id)
      .toBe(first.find(effect => effect.effectKey === CAFFEINATED_KEY)?.id);
    expect(second.find(effect => effect.effectKey === SLEEP_RISK_KEY)?.id)
      .toBe(first.find(effect => effect.effectKey === SLEEP_RISK_KEY)?.id);
    expect(await getStatusEffectStore().listAll(USER)).toHaveLength(2);
  });
});
