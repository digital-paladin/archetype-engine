import { BodyCompositionError, StoredBodyComposition } from '../domain/bodyComposition';
import {
  BodyCompositionStore,
  MemoryBodyCompositionStore,
  setBodyCompositionStore,
} from './bodyComposition.store';
import { listBodyComposition, logBodyComposition } from './bodyComposition.service';

function reading(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'scale-example-001',
    source: 'hume',
    measuredAt: '2026-01-15T15:00:00.000Z',
    fasted: true,
    context: 'morning',
    notes: 'synthetic fixture',
    healthScore: 111,
    healthScoreLabel: 'Example Band',
    healthScoreConfidencePct: 42,
    biologicalAgeYears: 30,
    metabolicAgeYears: 28.5,
    bodyFatPct: 15.5,
    bodyWaterPct: 60,
    skeletalMuscleMassLb: 50.25,
    weightLb: null,
    bodyCompositionGrade: 'B',
    activityGrade: 'C',
    sleepGrade: 'A-',
    bodyFatLabel: 'Example High',
    bodyWaterLabel: 'Example Standard',
    skeletalMuscleMassLabel: 'Example Low',
    weightLabel: null,
    biologicalAgeLabel: 'Example Younger',
    metabolicAgeLabel: 'Example Standard',
    xp: 99999,
    ...overrides,
  };
}

describe('logBodyComposition', () => {
  beforeEach(() => {
    setBodyCompositionStore(new MemoryBodyCompositionStore());
  });

  afterEach(() => {
    setBodyCompositionStore(null);
  });

  it('stores a sparse reading with raw labels and a null weight, and ignores xp', async () => {
    const result = await logBodyComposition('player-1', reading());
    expect(result.idempotentReplay).toBe(false);
    expect(result.reading.weightLb).toBeNull();
    expect(result.reading.healthScore).toBe(111);
    expect(result.reading.healthScoreLabel).toBe('Example Band');
    expect(result.reading.healthScoreConfidencePct).toBe(42);
    expect(result.reading.metabolicAgeYears).toBe(28.5);
    expect(result.reading.skeletalMuscleMassLb).toBe(50.25);
    expect(result.reading.sleepGrade).toBe('A-');
    expect(result.reading.bodyFatLabel).toBe('Example High');
    expect(result.reading.fasted).toBe(true);
    expect(result.reading.context).toBe('morning');
    expect(result.reading.source).toBe('hume');
    expect(result.reading.measuredAt).toBe('2026-01-15T15:00:00.000Z');
    expect(result.reading).not.toHaveProperty('xp');
    expect(result.reading).not.toHaveProperty('userId');
  });

  it('keeps source text as sent and trims labels', async () => {
    const result = await logBodyComposition('player-1', reading({
      source: '  Hume Pod  ',
      healthScoreLabel: '  Example Band  ',
      idempotencyKey: 'scale-example-002',
    }));
    expect(result.reading.source).toBe('Hume Pod');
    expect(result.reading.healthScoreLabel).toBe('Example Band');
  });

  it('accepts a reading that only has source, time, and an idempotency key', async () => {
    const result = await logBodyComposition('player-1', {
      idempotencyKey: 'scale-empty-001',
      source: 'manual',
      measuredAt: '2026-02-01T08:00:00-06:00',
    });
    expect(result.reading.weightLb).toBeNull();
    expect(result.reading.healthScore).toBeNull();
    expect(result.reading.bodyFatPct).toBeNull();
    expect(result.reading.fasted).toBeNull();
    expect(result.reading.measuredAt).toBe('2026-02-01T14:00:00.000Z');
  });

  it('replays the original row when the same key is posted again', async () => {
    const first = await logBodyComposition('player-1', reading());
    const second = await logBodyComposition('player-1', reading({
      healthScore: 999,
      weightLb: 400,
      notes: 'should not replace',
    }));
    expect(second.idempotentReplay).toBe(true);
    expect(second.reading.id).toBe(first.reading.id);
    expect(second.reading.healthScore).toBe(111);
    expect(second.reading.weightLb).toBeNull();
    expect(second.reading.notes).toBe('synthetic fixture');

    const listed = await listBodyComposition('player-1', undefined);
    expect(listed).toHaveLength(1);
  });

  it('lets two players reuse an idempotency key', async () => {
    await logBodyComposition('player-1', reading());
    const other = await logBodyComposition('player-2', reading({ healthScore: 222 }));
    expect(other.idempotentReplay).toBe(false);
    expect(other.reading.healthScore).toBe(222);
    expect(await listBodyComposition('player-1', undefined)).toHaveLength(1);
    expect(await listBodyComposition('player-2', undefined)).toHaveLength(1);
  });

  it('lists newest measured_at first and honors limit', async () => {
    await logBodyComposition('player-1', reading({
      idempotencyKey: 'older',
      measuredAt: '2026-01-01T00:00:00.000Z',
      weightLb: 150,
    }));
    await logBodyComposition('player-1', reading({
      idempotencyKey: 'newer',
      measuredAt: '2026-03-01T00:00:00.000Z',
      weightLb: 151,
    }));
    const listed = await listBodyComposition('player-1', '1');
    expect(listed).toHaveLength(1);
    expect(listed[0].idempotencyKey).toBe('newer');
    expect(listed[0].weightLb).toBe(151);
  });

  it('turns a unique-constraint race into an idempotent replay', async () => {
    const saved: StoredBodyComposition = {
      id: 'existing',
      userId: 'player-1',
      idempotencyKey: 'scale-example-001',
      source: 'hume',
      measuredAt: '2026-01-15T15:00:00.000Z',
      fasted: null,
      context: null,
      notes: 'original',
      healthScore: 111,
      healthScoreLabel: null,
      healthScoreConfidencePct: null,
      biologicalAgeYears: null,
      metabolicAgeYears: null,
      bodyFatPct: null,
      bodyWaterPct: null,
      skeletalMuscleMassLb: null,
      weightLb: null,
      bodyCompositionGrade: null,
      activityGrade: null,
      sleepGrade: null,
      bodyFatLabel: null,
      bodyWaterLabel: null,
      skeletalMuscleMassLabel: null,
      weightLabel: null,
      biologicalAgeLabel: null,
      metabolicAgeLabel: null,
      createdAt: '2026-01-15T15:01:00.000Z',
    };
    let finds = 0;
    const raceStore: BodyCompositionStore = {
      async findByIdempotency() {
        finds += 1;
        return finds === 1 ? null : saved;
      },
      async insert() {
        const err = new Error('duplicate key') as Error & { code: string };
        err.code = '23505';
        throw err;
      },
      async list() {
        return [];
      },
    };
    setBodyCompositionStore(raceStore);
    const result = await logBodyComposition('player-1', reading({ healthScore: 999 }));
    expect(result.idempotentReplay).toBe(true);
    expect(result.reading.healthScore).toBe(111);
    expect(result.reading.notes).toBe('original');
  });

  it.each([
    [{}, /idempotencyKey/],
    [reading({ source: '   ' }), /source/],
    [reading({ measuredAt: 'not-a-date' }), /measuredAt/],
    [reading({ healthScore: 10.5 }), /healthScore/],
    [reading({ healthScore: 100001 }), /healthScore/],
    [reading({ healthScoreConfidencePct: 101 }), /healthScoreConfidencePct/],
    [reading({ bodyFatPct: -1 }), /bodyFatPct/],
    [reading({ bodyWaterPct: 100.1 }), /bodyWaterPct/],
    [reading({ weightLb: 0 }), /weightLb/],
    [reading({ skeletalMuscleMassLb: -5 }), /skeletalMuscleMassLb/],
    [reading({ biologicalAgeYears: 201 }), /biologicalAgeYears/],
    [reading({ fasted: 'true' }), /fasted/],
    [reading({ sleepGrade: 'too-long-grade!!!' }), /sleepGrade/],
    [reading({ bodyFatLabel: 'line\nbreak' }), /bodyFatLabel/],
    [reading({ idempotencyKey: 'bad\nkey' }), /idempotencyKey/],
  ])('rejects %j', async (body, pattern) => {
    await expect(logBodyComposition('player-1', body)).rejects.toMatchObject({
      code: 'invalid_body_composition',
      status: 400,
    });
    await expect(logBodyComposition('player-1', body)).rejects.toBeInstanceOf(BodyCompositionError);
    await expect(logBodyComposition('player-1', body)).rejects.toThrow(pattern);
  });

  it('rejects a limit outside 1–200', async () => {
    await expect(listBodyComposition('player-1', '0')).rejects.toMatchObject({ status: 400 });
    await expect(listBodyComposition('player-1', '201')).rejects.toMatchObject({ status: 400 });
    await expect(listBodyComposition('player-1', 'nope')).rejects.toMatchObject({ status: 400 });
  });
});
