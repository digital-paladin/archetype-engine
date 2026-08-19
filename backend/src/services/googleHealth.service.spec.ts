import { GoogleHealthService } from './googleHealth.service';

describe('GoogleHealthService parsers', () => {
  const svc = new GoogleHealthService();

  const payload = {
    dataPoints: [{
      sleep: {
        interval: {
          startTime: '2026-08-12T22:30:00Z',
          endTime:   '2026-08-13T06:30:00Z',
        },
        type: 'STAGES',
        stages: [
          { startTime: '2026-08-12T22:30:00Z', endTime: '2026-08-12T23:50:00Z', type: 'LIGHT' }, // 80
          { startTime: '2026-08-12T23:50:00Z', endTime: '2026-08-13T01:10:00Z', type: 'DEEP' },  // 80
          { startTime: '2026-08-13T01:10:00Z', endTime: '2026-08-13T02:40:00Z', type: 'REM' },   // 90
          { startTime: '2026-08-13T02:40:00Z', endTime: '2026-08-13T06:10:00Z', type: 'LIGHT' }, // 210
          { startTime: '2026-08-13T06:10:00Z', endTime: '2026-08-13T06:30:00Z', type: 'AWAKE' }, // 20
        ],
      },
    }],
  };

  it('parseSleep maps reconcile stages to WearableSleepData', () => {
    const sleep = svc.parseSleep(payload, '2026-08-13');
    expect(sleep.deep_min).toBe(80);
    expect(sleep.rem_min).toBe(90);
    expect(sleep.light_min).toBe(290);
    expect(sleep.awake_min).toBe(20);
    expect(sleep.hours).toBe(7.7); // 80+90+290 = 460 min
    expect(sleep.efficiency).toBe(96); // 460 / 480
    expect(sleep.score).toBeGreaterThan(50);
    expect(sleep.vitality).toBeCloseTo(sleep.score / 10, 0);
    expect(sleep.startTime).toMatch(/^\d{2}:\d{2}$/);
    expect(sleep.endTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it('parseSleep returns zeros when no dataPoints', () => {
    const sleep = svc.parseSleep({ dataPoints: [] }, '2026-08-13');
    expect(sleep.score).toBe(0);
    expect(sleep.hours).toBe(0);
    expect(sleep.deep_min).toBe(0);
  });

  it('parseSleep accepts sleepStages alias', () => {
    const sleep = svc.parseSleep({
      dataPoints: [{
        sleep: {
          startTime: '2026-08-12T23:00:00Z',
          endTime:   '2026-08-13T07:00:00Z',
          sleepStages: [
            { startTime: '2026-08-12T23:00:00Z', endTime: '2026-08-13T07:00:00Z', type: 'LIGHT' },
          ],
        },
      }],
    }, '2026-08-13');
    expect(sleep.light_min).toBe(480);
    expect(sleep.hours).toBe(8);
    expect(sleep.score).toBe(100);
  });

  it('getAuthUrl includes offline access and sleep.readonly without include_granted_scopes', () => {
    process.env.GOOGLE_HEALTH_CLIENT_ID = 'test-client';
    const url = new GoogleHealthService().getAuthUrl('user-uuid');
    expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('googlehealth.sleep.readonly');
    expect(url).not.toContain('include_granted_scopes');
    expect(url).toContain('state=user-uuid');
  });
});
