import { JournalEntry } from './data/IDataService';
import { correctConsumption, listConsumption, logConsumption } from './consumption.service';
import { getAllEffects } from './statusEffects.service';
import { getStatusEffectStore, MemoryStatusEffectStore, setStatusEffectStore } from './statusEffect.store';
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
    async listJournalFoodDays(userId: string) {
      const days = [];
      for (const [key, row] of rows) {
        if (!key.startsWith(`${userId}:`) || !Array.isArray(row.food_log)) continue;
        days.push({
          entry_date: row.entry_date,
          food_log: row.food_log,
          protein_grams_logged: row.protein_grams_logged,
          meal_count: row.meal_count,
          hydration_oz: row.hydration_oz,
          sleep_start: row.sleep_start,
        });
      }
      return days;
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
    // Alcohol Shadow clears a few hours after the pour. getAllEffects defaults
    // to wall-clock now, so an unscoped read goes empty once that window has
    // passed (the row is still stored; it is no longer active). Ask at the pour.
    const atPour = new Date('2026-10-20T19:00:00-05:00');
    expect((await getAllEffects(userId, atPour)).filter(e => e.effectKey === 'alcohol')).toHaveLength(1);
    expect((await getAllEffects(userId, new Date('2026-10-21T12:00:00-05:00'))).filter(e => e.effectKey === 'alcohol')).toHaveLength(0);

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

describe('correctConsumption', () => {
  const userId = 'player-1';
  let journal: ReturnType<typeof journalFake>;
  const at = '2026-10-27T19:30:00-05:00';

  beforeEach(() => {
    setStatusEffectStore(new MemoryStatusEffectStore());
    setSystemQuestStore(new MemorySystemQuestStore());
    journal = journalFake();
  });

  function sugarGrams(effect: { meta?: Record<string, unknown> } | undefined): number {
    const doses = effect?.meta && Array.isArray(effect.meta.doses)
      ? effect.meta.doses as Array<{ grams?: number; entryId?: string }>
      : [];
    return doses.reduce((sum, dose) => sum + (dose.grams ?? 0), 0);
  }

  it('sets added sugar on an existing row, flags it, and does not double-count the meal', async () => {
    const slice = await logConsumption(userId, {
      idempotencyKey: 'tres-leches',
      itemName: 'Tres Leches Slice',
      calories: 540,
      protein: 9,
      consumedAt: at,
      clientDate: '2026-10-27',
    }, { journal, notifySystem: true, authKind: 'service' });
    const side = await logConsumption(userId, {
      idempotencyKey: 'side-salad',
      itemName: 'Side Salad',
      calories: 120,
      protein: 4,
      consumedAt: '2026-10-27T19:40:00-05:00',
      clientDate: '2026-10-27',
    }, { journal });
    expect(slice.effects.find(effect => effect.effectKey === 'sugar')).toBeUndefined();
    expect(side.mealCount).toBe(2);
    expect(side.proteinGrams).toBe(13);

    const corrected = await correctConsumption(userId, slice.id, {
      idempotencyKey: 'tres-leches-sugar',
      addedSugarG: 42.5,
      notes: 'Label sugar for the portion eaten',
      reason: 'Label was read after the meal was logged',
    }, { journal, notifySystem: true, authKind: 'service', now: new Date(at) });

    expect(corrected.idempotentReplay).toBe(false);
    expect(corrected.dietFlags).toEqual(['added-sugar']);
    expect(corrected.previous).toEqual({ addedSugarG: 0, notes: null });
    expect(corrected.changes).toEqual([
      'notes: (empty) → Label sugar for the portion eaten',
      'addedSugarG: 0 → 42.5',
    ]);
    expect(corrected.mealCount).toBe(2);
    expect(corrected.proteinGrams).toBe(13);
    const rush = corrected.effects.find(effect => effect.effectKey === 'sugar');
    expect(rush?.name).toBe('Sugar Rush');
    expect(rush?.dose).toBe('42.5 g added sugar');
    expect(sugarGrams(rush)).toBe(42.5);
    expect(corrected.noticeBody).toContain('Sugar Rush');
    expect(corrected.noticeBody).toContain('added-sugar');

    const saved = journal.rows.get(`${userId}:2026-10-27`);
    expect(saved?.food_log).toHaveLength(2);
    expect(saved?.meal_count).toBe(2);
    const messages = await (await import('./systemQuest.store')).getSystemQuestStore().listMessages(userId, 10);
    expect(messages).toHaveLength(2);

    const replay = await correctConsumption(userId, slice.id, {
      idempotencyKey: 'tres-leches-sugar',
      addedSugarG: 80,
    }, { journal, notifySystem: true, authKind: 'service', now: new Date(at) });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.entry.addedSugarG).toBe(42.5);
    const still = await getAllEffects(userId, new Date(at));
    expect(sugarGrams(still.find(effect => effect.effectKey === 'sugar'))).toBe(42.5);
    const afterReplay = await (await import('./systemQuest.store')).getSystemQuestStore().listMessages(userId, 10);
    expect(afterReplay).toHaveLength(2);
  });

  it('replaces a sugar dose instead of stacking, and clears Sugar Rush at zero', async () => {
    const logged = await logConsumption(userId, {
      itemName: 'Tres Leches Slice',
      calories: 540,
      addedSugarG: 42.5,
      consumedAt: at,
      clientDate: '2026-10-27',
    }, { journal });
    const lowered = await correctConsumption(userId, logged.id, {
      addedSugarG: 10,
    }, { journal, now: new Date(at) });
    expect(sugarGrams(lowered.effects.find(effect => effect.effectKey === 'sugar'))).toBe(10);
    expect(lowered.mealCount).toBe(1);

    const cleared = await correctConsumption(userId, logged.id, {
      addedSugarG: 0,
    }, { journal, now: new Date(at) });
    expect(cleared.dietFlags).not.toContain('added-sugar');
    expect(cleared.effects.find(effect => effect.effectKey === 'sugar')).toBeUndefined();
    expect((await getAllEffects(userId, new Date(at))).some(effect => effect.effectKey === 'sugar')).toBe(false);
  });

  it('keeps another meal\'s sugar dose when this row is corrected', async () => {
    const first = await logConsumption(userId, {
      itemName: 'Soda',
      calories: 140,
      addedSugarG: 10,
      consumedAt: '2026-10-27T18:00:00-05:00',
      clientDate: '2026-10-27',
    }, { journal });
    const second = await logConsumption(userId, {
      itemName: 'Tres Leches Slice',
      calories: 540,
      consumedAt: at,
      clientDate: '2026-10-27',
    }, { journal });
    const corrected = await correctConsumption(userId, second.id, {
      addedSugarG: 6,
    }, { journal, now: new Date(at) });
    expect(sugarGrams(corrected.effects.find(effect => effect.effectKey === 'sugar'))).toBe(16);
    expect(corrected.mealCount).toBe(2);
    expect(first.id).not.toBe(second.id);
  });

  it('stores total sugar without a flag or a Sugar Rush', async () => {
    const logged = await logConsumption(userId, {
      itemName: 'Apple',
      calories: 95,
      consumedAt: at,
      clientDate: '2026-10-27',
    }, { journal });
    const corrected = await correctConsumption(userId, logged.id, {
      totalSugarG: 19,
      notes: 'Fruit sugar, none added',
    }, { journal, now: new Date(at) });
    expect(corrected.entry.totalSugarG).toBe(19);
    expect(corrected.dietFlags).toEqual([]);
    expect(corrected.effects.find(effect => effect.effectKey === 'sugar')).toBeUndefined();
  });

  it('flags seed oil from notes and adjusts water without wiping the day total', async () => {
    const logged = await logConsumption(userId, {
      itemName: 'Roasted Vegetables',
      calories: 180,
      consumedAt: at,
      clientDate: '2026-10-27',
    }, { journal });
    journal.rows.set(`${userId}:2026-10-27`, {
      ...journal.rows.get(`${userId}:2026-10-27`)!,
      hydration_oz: 80,
    });
    const corrected = await correctConsumption(userId, logged.id, {
      notes: 'Finished in canola oil',
      waterOz: 8,
      calories: 0,
    }, { journal, now: new Date(at) });
    expect(corrected.dietFlags).toContain('seed-oil');
    expect(corrected.hydrationOz).toBe(88);
    expect(corrected.mealCount).toBe(0);
    expect(corrected.entry.calories).toBe(0);
  });

  it('matches a pre-id sugar dose by timestamp instead of appending a second one', async () => {
    const logged = await logConsumption(userId, {
      itemName: 'Tres Leches Slice',
      calories: 540,
      addedSugarG: 12,
      consumedAt: at,
      clientDate: '2026-10-27',
    }, { journal });
    const store = getStatusEffectStore();
    const sugar = (await store.listAll(userId)).find(effect => effect.effectKey === 'sugar');
    expect(sugar).toBeTruthy();
    const doses = (sugar!.meta as { doses: Array<{ entryId?: string }> }).doses;
    delete doses[0].entryId;
    await store.update(userId, sugar!);

    const corrected = await correctConsumption(userId, logged.id, {
      addedSugarG: 8,
    }, { journal, now: new Date(at) });
    const next = corrected.effects.find(effect => effect.effectKey === 'sugar');
    expect(sugarGrams(next)).toBe(8);
    const nextDoses = (next?.meta as { doses: unknown[] }).doses;
    expect(nextDoses).toHaveLength(1);
  });

  it('assigns an id when a legacy day is listed, then corrects that id', async () => {
    journal.rows.set(`${userId}:2026-10-27`, {
      user_id: userId,
      entry_date: '2026-10-27',
      protein_grams_logged: 9,
      meal_count: 1,
      food_log: [{ item: 'Tres Leches Slice', protein: 9, calories: 540, ts: at }],
    });
    const listed = await listConsumption(userId, '2026-10-27', { journal });
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0].id).toBeTruthy();
    const again = await listConsumption(userId, '2026-10-27', { journal });
    expect(again.entries[0].id).toBe(listed.entries[0].id);

    const corrected = await correctConsumption(userId, listed.entries[0].id, {
      addedSugarG: 42.5,
    }, { journal, now: new Date(at) });
    expect(corrected.dietFlags).toContain('added-sugar');
    expect(corrected.effects.find(effect => effect.name === 'Sugar Rush')?.dose).toBe('42.5 g added sugar');
    expect(corrected.mealCount).toBe(1);
    expect(corrected.proteinGrams).toBe(9);
  });

  it('returns 404 for an unknown id and does not cross users', async () => {
    const logged = await logConsumption(userId, {
      itemName: 'Apple',
      calories: 95,
      consumedAt: at,
      clientDate: '2026-10-27',
    }, { journal });
    await expect(correctConsumption(userId, 'missing-id', { notes: 'nope' }, { journal }))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(correctConsumption('someone-else', logged.id, { notes: 'nope' }, { journal }))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('rejects an empty patch and a negative amount', async () => {
    const logged = await logConsumption(userId, {
      itemName: 'Apple',
      calories: 95,
      consumedAt: at,
      clientDate: '2026-10-27',
    }, { journal });
    await expect(correctConsumption(userId, logged.id, { reason: 'no fields' }, { journal }))
      .rejects.toMatchObject({ status: 400 });
    await expect(correctConsumption(userId, logged.id, { addedSugarG: -1 }, { journal }))
      .rejects.toMatchObject({ status: 400 });
  });
});
