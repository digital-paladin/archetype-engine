import { JournalEntry } from './data/IDataService';
import { logConsumption } from './consumption.service';
import { getAllEffects } from './statusEffects.service';
import { MemoryStatusEffectStore, setStatusEffectStore } from './statusEffect.store';
import { MemorySystemQuestStore, setSystemQuestStore } from './systemQuest.store';
import { postSystemMessage } from './systemQuest.service';
import * as abstinence from './abstinence.service';

jest.mock('./abstinence.service', () => ({
  logBreak: jest.fn(),
}));

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
      rows.set(key, { ...(prev ?? { user_id: userId, entry_date: entry.entry_date! }), ...entry, user_id: userId });
    },
  };
}

describe('logConsumption', () => {
  const userId = 'paul';
  let journal: ReturnType<typeof journalFake>;

  beforeEach(() => {
    setStatusEffectStore(new MemoryStatusEffectStore());
    setSystemQuestStore(new MemorySystemQuestStore());
    journal = journalFake();
    (abstinence.logBreak as jest.Mock).mockClear();
  });

  it('logs a 7 PM Miller Lite, merges a second pour, and does not break abstinence', async () => {
    const first = await logConsumption(userId, {
      idempotencyKey: 'beer-1',
      itemName: 'Miller Lite (12 oz)',
      calories: 96,
      alcohol: { volumeOz: 12, abvPercent: 4.2 },
      consumedAt: '2026-10-20T19:00:00-05:00',
      bedtime: '23:00',
    }, { journal, notifySystem: false, authKind: 'user' });

    expect(first.idempotentReplay).toBe(false);
    expect(first.abstinencePrompt?.broken).toBe(false);
    expect(first.abstinencePrompt?.itemIndex).toBe(0);
    expect(first.effects.map(e => e.name)).toContain('Alcohol Shadow');
    expect(first.effects.find(e => e.effectKey === 'alcohol')?.dose).toBe('0.84 standard drinks');
    expect(first.effects.find(e => e.effectKey === 'alcohol')?.autoApplied).toBe(true);
    expect(abstinence.logBreak).not.toHaveBeenCalled();

    const replay = await logConsumption(userId, {
      idempotencyKey: 'beer-1',
      itemName: 'ignored on replay',
      alcohol: { volumeOz: 12, abvPercent: 4.2 },
    }, { journal });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.effects.find(e => e.effectKey === 'alcohol')?.id)
      .toBe(first.effects.find(e => e.effectKey === 'alcohol')?.id);
    expect((await getAllEffects(userId)).filter(e => e.effectKey === 'alcohol')).toHaveLength(1);

    const second = await logConsumption(userId, {
      idempotencyKey: 'beer-2',
      itemName: 'Miller Lite (12 oz)',
      calories: 96,
      alcohol: { volumeOz: 12, abvPercent: 4.2 },
      consumedAt: '2026-10-20T19:20:00-05:00',
      bedtime: '23:00',
    }, { journal });
    const shadow = second.effects.find(e => e.effectKey === 'alcohol');
    expect(shadow?.id).toBe(first.effects.find(e => e.effectKey === 'alcohol')?.id);
    expect(Number((shadow?.dose ?? '').split(' ')[0])).toBeGreaterThan(0.84);
    expect((await getAllEffects(userId, new Date('2026-10-20T19:20:00-05:00'))).filter(e => e.effectKey === 'alcohol')).toHaveLength(1);
    const saved = journal.rows.get(`${userId}:2026-10-20`);
    expect(saved?.food_log).toHaveLength(2);
    expect(saved?.food_log?.[0].alcohol).toEqual({ volumeOz: 12, abvPercent: 4.2 });
  });

  it('posts one System notice and replays without a second message', async () => {
    const logged = await logConsumption(userId, {
      idempotencyKey: 'coffee-1',
      itemName: 'Black Coffee (8 oz)',
      caffeineMg: 95,
      consumedAt: '2026-10-20T15:00:00-05:00',
    }, { journal, notifySystem: true, authKind: 'service' });
    expect(logged.noticeBody).toContain('Caffeine Clarity');
    expect(logged.effects.find(e => e.effectKey === 'caffeine')?.dose).toBe('95 mg caffeine');

    await logConsumption(userId, {
      idempotencyKey: 'coffee-1',
      itemName: 'Black Coffee (8 oz)',
      caffeineMg: 95,
    }, { journal, notifySystem: true, authKind: 'service' });

    const messages = await (await import('./systemQuest.store')).getSystemQuestStore().listMessages(userId, 10);
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toContain('Caffeine Clarity');
    expect(postSystemMessage).toBeDefined();
  });

  it('replaces dehydration with Hydrated once the fluid goal is met', async () => {
    const dry = await logConsumption(userId, {
      itemName: "Paladin's Vow of Water",
      waterOz: 18,
      consumedAt: '2026-10-20T20:00:00-05:00',
    }, { journal });
    expect(dry.effects.find(e => e.effectKey === 'dehydration')?.dose).toBe('18 / 100 oz');

    const wet = await logConsumption(userId, {
      itemName: "Paladin's Vow of Water",
      waterOz: 82,
      consumedAt: '2026-10-20T20:30:00-05:00',
    }, { journal });
    expect(wet.hydrationOz).toBe(100);
    expect(wet.effects.find(e => e.effectKey === 'hydrated')).toBeTruthy();
    expect(wet.effects.find(e => e.effectKey === 'dehydration')).toBeUndefined();
    const active = await getAllEffects(userId, new Date('2026-10-20T20:30:00-05:00'));
    expect(active.some(e => e.effectKey === 'dehydration')).toBe(false);
  });

  it('flags avocado in the name and still records the protein goal', async () => {
    const logged = await logConsumption(userId, {
      itemName: 'Avocado (½ medium)',
      protein: 140,
      calories: 120,
      consumedAt: '2026-10-20T18:00:00-05:00',
    }, { journal });
    expect(logged.dietFlags).toContain('avocado');
    expect(logged.effects.find(e => e.effectKey === 'protein-goal')?.dose).toBe('140 g / 130 g');
    expect(logged.abstinencePrompt).toBeNull();
  });

  it('uses Tuesday 22:15 and a normal weekday 21:30 unless the request sets bedtime', async () => {
    const tuesday = await logConsumption(userId, {
      itemName: 'Miller Lite (12 oz)',
      alcohol: { volumeOz: 12, abvPercent: 4.2 },
      consumedAt: '2026-10-20T19:00:00-05:00',
      clientDate: '2026-10-20',
    }, { journal });
    const tuesdayShadow = tuesday.effects.find(e => e.effectKey === 'alcohol');
    expect(tuesdayShadow?.source).toContain('3.25h before bedtime');
    expect(tuesdayShadow?.effects.find(s => s.stat === 'Sleep Quality')?.modifier).toBe('-5%');
    expect(tuesdayShadow?.duration).toBe(160);

    const explicit = await logConsumption('other-player', {
      idempotencyKey: 'beer-explicit',
      itemName: 'Miller Lite (12 oz)',
      alcohol: { volumeOz: 12, abvPercent: 4.2 },
      consumedAt: '2026-10-20T19:00:00-05:00',
      clientDate: '2026-10-20',
      bedtime: '23:00',
    }, { journal });
    const explicitShadow = explicit.effects.find(e => e.effectKey === 'alcohol');
    expect(explicitShadow?.source).toContain('4h before bedtime');
    expect(explicitShadow?.effects.find(s => s.stat === 'Sleep Quality')?.modifier).toBe('-4%');

    const wednesday = await logConsumption(userId, {
      itemName: 'Miller Lite (12 oz)',
      alcohol: { volumeOz: 12, abvPercent: 4.2 },
      consumedAt: '2026-10-21T21:45:00-05:00',
      clientDate: '2026-10-21',
    }, { journal });
    const nightcap = wednesday.effects.find(e => e.effectKey === 'alcohol');
    expect(nightcap?.source).toContain('at or after bedtime');
    expect(nightcap?.effects.find(s => s.stat === 'Sleep Quality')?.modifier).toBe('-11%');
    expect(nightcap?.duration).toBe(290);
  });

  it('uses yesterday sleep_start as bedtime when tonight is not logged yet', async () => {
    journal.rows.set(`${userId}:2026-10-19`, {
      user_id: userId,
      entry_date: '2026-10-19',
      sleep_start: '22:30:00',
    });
    const logged = await logConsumption(userId, {
      itemName: 'Miller Lite (12 oz)',
      alcohol: { volumeOz: 12, abvPercent: 4.2 },
      consumedAt: '2026-10-20T19:00:00-05:00',
      clientDate: '2026-10-20',
    }, { journal });
    expect(logged.effects.find(e => e.effectKey === 'alcohol')?.source).toContain('3.5h before bedtime');
  });
});
