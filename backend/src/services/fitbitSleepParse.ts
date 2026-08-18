export interface ParsedSleepNight {
  score: number;
  hours: number;
  vitality: number;
  efficiency: number;
  deep_min: number;
  rem_min: number;
  light_min: number;
  awake_min: number;
  startTime?: string;
  endTime?: string;
}

function stageMinutes(summary: any, key: string): number {
  const raw = summary?.[key];
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw.minutes === 'number') return raw.minutes;
  return 0;
}

/** Single-day Fitbit sleep payload (`/sleep/date/{date}.json`). */
export function parseFitbitSleepDay(data: any): ParsedSleepNight {
  const summary    = data.summary || {};
  const stages     = summary.stages || {};
  const totalMin   = summary.totalMinutesAsleep || 0;
  const totalBed   = summary.totalTimeInBed    || totalMin || 1;
  const efficiency = Math.min(Math.round((totalMin / totalBed) * 100), 100);
  const hours      = Math.round((totalMin / 60) * 10) / 10;
  const vitality   = Math.min(Math.round(((totalMin / 480) * (efficiency / 100)) * 100) / 10, 10);
  const score      = Math.min(Math.round((totalMin / 480) * 60 + (efficiency / 100) * 40), 100);

  const mainSleep = (data.sleep as any[] | undefined)
    ?.find((s: any) => s.isMainSleep) ?? (data.sleep as any[])?.[0];
  const toHHMM = (iso: string | undefined): string | undefined => {
    if (!iso) return undefined;
    const m = iso.match(/(\d{2}:\d{2})/);
    return m ? m[1] : undefined;
  };

  return {
    score, hours, vitality, efficiency,
    deep_min:  stages.deep  || 0,
    rem_min:   stages.rem   || 0,
    light_min: stages.light || 0,
    awake_min: stages.wake  || 0,
    startTime: toHHMM(mainSleep?.startTime),
    endTime:   toHHMM(mainSleep?.endTime),
  };
}

function logsToDayPayload(dayLogs: any[]): any {
  const totalMinutesAsleep = dayLogs.reduce((s, l) => s + (l.minutesAsleep || 0), 0);
  const totalTimeInBed = dayLogs.reduce((s, l) => s + (l.timeInBed || 0), 0);
  const main = dayLogs.find((l: any) => l.isMainSleep) ?? dayLogs[0];
  const lvl = main?.levels?.summary || {};
  return {
    summary: {
      totalMinutesAsleep,
      totalTimeInBed: totalTimeInBed || totalMinutesAsleep,
      stages: {
        deep:  stageMinutes(lvl, 'deep'),
        rem:   stageMinutes(lvl, 'rem'),
        light: stageMinutes(lvl, 'light'),
        wake:  stageMinutes(lvl, 'wake'),
      },
    },
    sleep: dayLogs,
  };
}

/** Date-range Fitbit payload (`/sleep/date/{start}/{end}.json`). */
export function parseFitbitSleepRange(data: any): Array<{ date: string } & ParsedSleepNight> {
  const logs: any[] = data?.sleep ?? [];
  const byDate = new Map<string, any[]>();
  for (const log of logs) {
    const date = typeof log.dateOfSleep === 'string' ? log.dateOfSleep.slice(0, 10) : '';
    if (!date) continue;
    const list = byDate.get(date) ?? [];
    list.push(log);
    byDate.set(date, list);
  }
  return Array.from(byDate.entries()).map(([date, dayLogs]) => ({
    date,
    ...parseFitbitSleepDay(logsToDayPayload(dayLogs)),
  }));
}
