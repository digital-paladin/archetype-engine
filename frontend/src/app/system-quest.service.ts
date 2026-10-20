import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../environments/environment';
import { SocketService } from './socket.service';

export interface SystemObjective {
  id: string;
  label: string;
  target: number;
  progress: number;
  done: boolean;
}

export interface SystemQuest {
  id: string;
  kind: 'daily' | 'emergency' | 'hidden' | 'penalty' | string;
  status: 'active' | 'cleared' | 'failed' | 'expired' | string;
  hidden: boolean;
  revealed: boolean;
  source: string;
  createdAt: string;
  deadline: string | null;
  title: string | null;
  description: string | null;
  objectives: SystemObjective[];
  xpReward: Record<string, number>;
  rewardNote: string | null;
  rewardCostsMoney: boolean;
  rewardApproval: 'not_required' | 'pending' | 'approved' | 'declined' | string;
  penalty: { recoveryType?: string; xpPenalty?: Record<string, number> } | null;
  training: boolean;
  thursdayTrainingFlag: boolean;
  recoveryType: string | null;
  resolution: { outcome: string; xpPlanned?: { className: string; xp: number }[] } | null;
  resolvedAt: string | null;
}

export interface ServiceCredentialView {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface SystemNotice {
  type: string;
  title: string;
  detail: string;
}

export function formatCountdown(deadline: string | null, nowMs: number): string {
  if (!deadline) return 'No deadline';
  const ms = new Date(deadline).getTime() - nowMs;
  if (!Number.isFinite(ms)) return 'No deadline';
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map(n => String(n).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${clock}` : clock;
}

@Injectable({ providedIn: 'root' })
export class SystemQuestService {
  private readonly http = inject(HttpClient);
  private readonly socket = inject(SocketService);
  private readonly api = environment.apiUrl;

  readonly quests = signal<SystemQuest[]>([]);
  readonly credentials = signal<ServiceCredentialView[]>([]);
  readonly mintedToken = signal<string | null>(null);
  readonly notice = signal<SystemNotice | null>(null);
  readonly error = signal<string | null>(null);
  readonly activeCount = computed(() => this.quests().filter(q => q.status === 'active').length);

  private queue: SystemNotice[] = [];

  constructor() {
    this.socket.onSystemNotice().subscribe(event => {
      if (event.type !== 'progress') {
        this.pushNotice({ type: event.type, title: event.title, detail: event.detail });
      }
      this.refresh();
    });
  }

  refresh(): void {
    this.http.get<{ success: boolean; quests: SystemQuest[] }>(`${this.api}/api/system/quests`).subscribe({
      next: res => {
        this.quests.set(res.quests ?? []);
        this.error.set(null);
      },
      error: err => this.error.set(err?.error?.message || 'The System could not be reached.'),
    });
  }

  loadCredentials(): void {
    this.http.get<{ success: boolean; credentials: ServiceCredentialView[] }>(`${this.api}/api/system/credentials`).subscribe({
      next: res => this.credentials.set(res.credentials ?? []),
      error: () => { /* The quest window still works if credential listing fails. */ },
    });
  }

  createCredential(name: string): Observable<{ token: string; credential: ServiceCredentialView }> {
    return this.http.post<{ token: string; credential: ServiceCredentialView }>(`${this.api}/api/system/credentials`, { name, scopes: ['system'] }).pipe(
      tap(res => {
        this.mintedToken.set(res.token);
        this.loadCredentials();
      }),
    );
  }

  revokeCredential(id: string): void {
    this.http.delete(`${this.api}/api/system/credentials/${id}`).subscribe({
      next: () => {
        if (this.mintedToken()) this.mintedToken.set(null);
        this.loadCredentials();
      },
      error: err => this.error.set(err?.error?.message || 'Could not revoke the credential.'),
    });
  }

  decideReward(id: string, decision: 'approved' | 'declined'): void {
    this.http.post(`${this.api}/api/system/quests/${id}/reward-approval`, { decision }).subscribe({
      next: () => this.refresh(),
      error: err => this.error.set(err?.error?.message || 'Could not record that decision.'),
    });
  }

  dismissMintedToken(): void {
    this.mintedToken.set(null);
  }

  pushNotice(notice: SystemNotice): void {
    if (this.notice()) this.queue.push(notice);
    else this.notice.set(notice);
  }

  dismissNotice(): void {
    this.notice.set(this.queue.shift() ?? null);
  }
}
