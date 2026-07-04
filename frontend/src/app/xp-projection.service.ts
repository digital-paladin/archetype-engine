
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';


export interface QuestLog {
  quests: Array<{
    className: string;
    activities: string[];
  }>;
}


export interface VitalityStatus {
  current: number | null;
  status: string;
  sleepDebt: number | null;
  trend: string;
  flag: string;
}
// xp-projection.service.ts
// Angular service to fetch XP projection analytics from backend


export interface XPProjection {
  [className: string]: {
    totalXP: number;
    daysTracked: number;
    avgDailyXP: number;
    avgWeeklyXP: number;
    projected6mo: number;
    projected12mo: number;
  };
}

export interface XPGain {
  className: string;
  amount: number;
  date: string;
}

@Injectable({ providedIn: 'root' })
export class XpProjectionService {
  private readonly apiUrl = `${environment.apiUrl}/api/xp-projection`;

  constructor(private http: HttpClient) {}

  getVitalityStatus(): Observable<VitalityStatus> {
    return this.http.get<VitalityStatus>(`${environment.apiUrl}/api/vitality-status`);
  }

  getProjections(): Observable<XPProjection> {
    return this.http.get<XPProjection>(this.apiUrl);
  }

  getRecentGains(): Observable<XPGain[]> {
    return this.http.get<XPGain[]>(`${environment.apiUrl}/api/xp-gains`);
  }

  getQuestLog(): Observable<QuestLog> {
    return this.http.get<QuestLog>(`${environment.apiUrl}/api/quest-log`);
  }
}
