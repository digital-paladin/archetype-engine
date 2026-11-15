import { MemoryBodyCompositionStore, setBodyCompositionStore } from './bodyComposition.store';
import { adaptBodyCompositionReading, loadHumeScanSource, setHumeScanSource } from './humeScanSource';

describe('Hume scan source', () => {
  afterEach(() => {
    setHumeScanSource(null);
    setBodyCompositionStore(null);
  });

  it('adapts a PR #43 reading and treats the idempotency key as the app record', () => {
    const reading = adaptBodyCompositionReading({
      source: 'hume',
      measuredAt: '2026-11-09T15:00:00.000Z',
      idempotencyKey: 'scale-example-001',
      skeletalMuscleMassLb: 40,
      bodyFatPct: 18,
      weightLb: null,
      fasted: true,
    });
    expect(reading).toMatchObject({
      source: 'hume',
      appRecordId: 'scale-example-001',
      proofRef: null,
      skeletalMuscleMassLb: 40,
      weightLb: null,
      fasted: true,
    });
  });

  it('prefers an explicit proof field and snake_case columns', () => {
    const reading = adaptBodyCompositionReading({
      source: 'hume-pod',
      measured_at: '2026-11-09T15:00:00.000Z',
      idempotency_key: 'scale-example-002',
      proof_ref: 'app-record:scan-2',
      skeletal_muscle_mass_lb: '41.5',
      body_fat_pct: '17.5',
      weight_lb: '180',
    });
    expect(reading).toMatchObject({
      source: 'hume-pod',
      measuredAt: '2026-11-09T15:00:00.000Z',
      proofRef: 'app-record:scan-2',
      appRecordId: 'scale-example-002',
      skeletalMuscleMassLb: 41.5,
      weightLb: 180,
    });
  });

  it('uses a registered source, and otherwise lists the body-composition store', async () => {
    setHumeScanSource({
      async listReadings() {
        return [{ source: 'hume', measuredAt: '2026-11-09T15:00:00.000Z', proofRef: 'app-record:1' }];
      },
    });
    const registered = await loadHumeScanSource();
    expect(await registered!.listReadings('player-1')).toHaveLength(1);

    setHumeScanSource(null);
    setBodyCompositionStore(new MemoryBodyCompositionStore());
    const loaded = await loadHumeScanSource();
    expect(loaded).not.toBeNull();
    expect(await loaded!.listReadings('player-1')).toEqual([]);
  });
});
