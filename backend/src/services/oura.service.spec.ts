import { OuraService } from './oura.service';

describe('OuraService parsers', () => {
  const svc = new OuraService();

  it('parseSleep maps daily_sleep row to WearableSleepData', () => {
    const payload = {
      data: [{
        day: '2026-07-13',
        score: 82,
        total_sleep_duration: 25200, // 7h
        deep_sleep_duration: 4800,
        rem_sleep_duration: 5400,
        light_sleep_duration: 15000,
        awake_time: 1200,
        efficiency: 91,
        bedtime_start: '2026-07-12T23:15:00-05:00',
        bedtime_end: '2026-07-13T06:15:00-05:00',
      }],
    };
    const sleep = svc.parseSleep(payload, '2026-07-13');
    expect(sleep.score).toBe(82);
    expect(sleep.hours).toBe(7);
    expect(sleep.vitality).toBe(8.2);
    expect(sleep.efficiency).toBe(91);
    expect(sleep.deep_min).toBe(80);
    expect(sleep.rem_min).toBe(90);
    expect(sleep.light_min).toBe(250);
    expect(sleep.awake_min).toBe(20);
    expect(sleep.startTime).toMatch(/^\d{2}:\d{2}$/);
    expect(sleep.endTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it('parseSleep returns zeros when no rows', () => {
    const sleep = svc.parseSleep({ data: [] }, '2026-07-13');
    expect(sleep.score).toBe(0);
    expect(sleep.hours).toBe(0);
  });

  it('parseReadiness maps readiness score', () => {
    const readiness = svc.parseReadiness({
      data: [{
        day: '2026-07-13',
        score: 74,
        temperature_deviation: -0.1,
        contributors: { hrv_balance: 68 },
      }],
    }, '2026-07-13');
    expect(readiness).toEqual({
      score: 74,
      temperatureDeviation: -0.1,
      hrvBalance: 68,
      date: '2026-07-13',
    });
  });

  it('isConfigured is false without env', () => {
    const prevId = process.env.OURA_CLIENT_ID;
    const prevSecret = process.env.OURA_CLIENT_SECRET;
    delete process.env.OURA_CLIENT_ID;
    delete process.env.OURA_CLIENT_SECRET;
    const fresh = new OuraService();
    expect(fresh.isConfigured()).toBe(false);
    if (prevId) process.env.OURA_CLIENT_ID = prevId;
    if (prevSecret) process.env.OURA_CLIENT_SECRET = prevSecret;
  });
});
