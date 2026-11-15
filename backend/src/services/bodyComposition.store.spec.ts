import { StoredBodyComposition } from '../domain/bodyComposition';
import { readingToRow, rowToReading } from './bodyComposition.store';

function stored(): StoredBodyComposition {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    userId: 'player-1',
    idempotencyKey: 'scale-example-001',
    source: 'hume',
    measuredAt: '2026-01-15T15:00:00.000Z',
    fasted: false,
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
    createdAt: '2026-01-15T15:01:00.000Z',
  };
}

describe('body composition row mapping', () => {
  it('uses the body_composition_readings column names', () => {
    expect(Object.keys(readingToRow(stored())).sort()).toEqual([
      'activity_grade',
      'biological_age_label',
      'biological_age_years',
      'body_composition_grade',
      'body_fat_label',
      'body_fat_pct',
      'body_water_label',
      'body_water_pct',
      'context',
      'created_at',
      'fasted',
      'health_score',
      'health_score_confidence_pct',
      'health_score_label',
      'id',
      'idempotency_key',
      'measured_at',
      'metabolic_age_label',
      'metabolic_age_years',
      'notes',
      'skeletal_muscle_mass_label',
      'skeletal_muscle_mass_lb',
      'sleep_grade',
      'source',
      'user_id',
      'weight_label',
      'weight_lb',
    ]);
  });

  it('round-trips numeric strings from Postgres and keeps null weight', () => {
    const row = readingToRow(stored());
    const back = rowToReading({
      ...row,
      health_score_confidence_pct: '42',
      body_fat_pct: '15.5',
      skeletal_muscle_mass_lb: '50.25',
      metabolic_age_years: '28.5',
      weight_lb: null,
      fasted: false,
    });
    expect(back.healthScoreConfidencePct).toBe(42);
    expect(back.bodyFatPct).toBe(15.5);
    expect(back.skeletalMuscleMassLb).toBe(50.25);
    expect(back.metabolicAgeYears).toBe(28.5);
    expect(back.weightLb).toBeNull();
    expect(back.fasted).toBe(false);
    expect(back.userId).toBe('player-1');
    expect(back.measuredAt).toBe('2026-01-15T15:00:00.000Z');
    expect(back.sleepGrade).toBe('A-');
  });
});
