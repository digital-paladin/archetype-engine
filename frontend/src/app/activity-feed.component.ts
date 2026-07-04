import { Component, signal, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { environment } from '../environments/environment';
import { SocketService } from './socket.service';

interface LogEntry {
  id: number;
  activityType: string;
  xp: number;
  duration?: number;
  notes?: string;
  category?: string;
  source: 'skill' | 'combo' | 'consume' | 'water';
  timestamp: string;
}

@Component({
  selector: 'app-activity-feed',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="eso-panel feed-panel">

      <div class="feed-header">
        <h3 class="eso-panel-title">Activity Log</h3>
        <span class="feed-count" *ngIf="entries().length > 0">{{ entries().length }} entries</span>
      </div>

      <!-- Empty state -->
      <div class="feed-empty" *ngIf="!loading() && !error() && entries().length === 0">
        <span class="feed-empty-icon">◆</span>
        <p class="feed-empty-text">No activity logged yet today.</p>
        <p class="feed-empty-sub">Use <strong>Skills</strong>, <strong>Consumables</strong>, or the <strong>Quick Log</strong> on the Quests tab to record activity here.</p>
      </div>

      <!-- Loading state -->
      <div class="feed-empty" *ngIf="loading()">
        <span class="feed-empty-icon feed-spinner">◈</span>
        <p class="feed-empty-text">Loading activity log…</p>
      </div>

      <!-- Error state -->
      <div class="feed-empty feed-error" *ngIf="!loading() && error()">
        <span class="feed-empty-icon">⚠</span>
        <p class="feed-empty-text">Could not load activity log.</p>
        <p class="feed-empty-sub">{{ error() }}</p>
        <button class="feed-retry-btn" (click)="loadEntries()">Retry</button>
      </div>

      <!-- Log entries (most recent first) -->
      <div class="feed-list" *ngIf="entries().length > 0">
        <div
          *ngFor="let entry of entries(); trackBy: trackById"
          class="feed-entry"
          [class]="'source-' + entry.source">

          <span class="feed-icon">{{ sourceIcon(entry.source) }}</span>

          <div class="feed-body">
            <span class="feed-activity">{{ entry.activityType }}</span>
            <div class="feed-meta">
              <span class="feed-xp"    *ngIf="entry.xp > 0">+{{ entry.xp }} XP</span>
              <span class="feed-dur"   *ngIf="entry.duration">{{ entry.duration }} min</span>
              <span class="feed-notes" *ngIf="entry.notes">· {{ entry.notes }}</span>
            </div>
          </div>

          <span class="feed-time">{{ relativeTime(entry.timestamp) }}</span>
        </div>
      </div>

    </section>
  `,
  styles: [`
    .feed-panel {
      display: flex;
      flex-direction: column;
      max-height: 640px;
    }
    .feed-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .feed-count {
      font-size: 11px;
      color: var(--eso-muted, #777);
      letter-spacing: 0.06em;
    }
    /* ── Empty state ── */
    .feed-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 48px 0;
      gap: 8px;
    }
    .feed-empty-icon {
      font-size: 28px;
      color: var(--eso-muted, #555);
    }
    .feed-empty-text {
      font-size: 13px;
      color: var(--eso-muted, #888);
      margin: 0;
    }
    .feed-empty-sub {
      font-size: 11px;
      color: var(--eso-muted, #555);
      margin: 0;
      text-align: center;
      max-width: 340px;
    }
    .feed-empty-sub strong {
      color: #c87941;
      font-weight: 600;
    }
    .feed-error .feed-empty-icon,
    .feed-error .feed-empty-text { color: #d4684a; }
    .feed-error .feed-empty-sub  { color: #a05040; font-family: monospace; font-size: 10px; }
    .feed-retry-btn {
      margin-top: 8px;
      padding: 5px 14px;
      font-size: 11px;
      background: rgba(200, 121, 65, 0.15);
      color: #c87941;
      border: 1px solid rgba(200, 121, 65, 0.4);
      border-radius: 4px;
      cursor: pointer;
      letter-spacing: 0.05em;
    }
    .feed-retry-btn:hover { background: rgba(200, 121, 65, 0.25); }
    @keyframes spin { to { transform: rotate(360deg); } }
    .feed-spinner { display: inline-block; animation: spin 1.4s linear infinite; }
    /* ── List ── */
    .feed-list {
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 3px;
      max-height: 580px;
      scrollbar-width: thin;
      scrollbar-color: #3a3a3a #1a1a1a;
    }
    .feed-list::-webkit-scrollbar       { width: 6px; }
    .feed-list::-webkit-scrollbar-track  { background: #1a1a1a; }
    .feed-list::-webkit-scrollbar-thumb  { background: #3a3a3a; border-radius: 3px; }
    /* ── Entry row ── */
    .feed-entry {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.03);
      border-left: 3px solid transparent;
      transition: background 0.15s;
    }
    .feed-entry:hover { background: rgba(255, 255, 255, 0.06); }

    /* Source accent colours */
    .source-skill   { border-color: #c87941; }
    .source-combo   { border-color: #9b5de5; }
    .source-consume { border-color: #4caf6e; }
    .source-water   { border-color: #4a9fd4; }

    .feed-icon {
      font-size: 15px;
      min-width: 22px;
      padding-top: 1px;
      text-align: center;
    }
    /* ── Body ── */
    .feed-body {
      flex: 1;
      min-width: 0;
    }
    .feed-activity {
      display: block;
      font-size: 13px;
      color: var(--eso-text, #e0d5c0);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .feed-meta {
      display: flex;
      gap: 6px;
      margin-top: 3px;
      flex-wrap: wrap;
    }
    .feed-xp    { font-size: 11px; color: #f5c842; font-weight: 600; }
    .feed-dur   { font-size: 11px; color: #999; }
    .feed-notes { font-size: 11px; color: #777; }
    /* ── Timestamp ── */
    .feed-time {
      font-size: 10px;
      color: #555;
      white-space: nowrap;
      padding-top: 2px;
      min-width: 52px;
      text-align: right;
    }
  `]
})
export class ActivityFeedComponent implements OnInit, OnDestroy {
  entries = signal<LogEntry[]>([]);
  loading = signal(true);
  error   = signal<string | null>(null);

  private sub?: Subscription;

  private readonly http          = inject(HttpClient);
  private readonly socketService = inject(SocketService);

  ngOnInit(): void {
    this.loadEntries();

    // Prepend new entries in real-time
    this.sub = this.socketService.onActivityLogged().subscribe((entry: LogEntry) => {
      this.entries.update(current => [entry, ...current]);
    });
  }

  loadEntries(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<LogEntry[]>(`${environment.apiUrl}/api/activities`).subscribe({
      next: (data) => {
        this.entries.set(Array.isArray(data) ? data : []);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        const msg = err.status ? `${err.status} ${err.statusText}` : 'Network error — backend unreachable';
        console.error('[ActivityFeed] Failed to load log:', err);
        this.error.set(msg);
        this.loading.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  trackById(_: number, entry: LogEntry): number {
    return entry.id;
  }

  sourceIcon(source: string): string {
    switch (source) {
      case 'skill':   return '⚔';
      case 'combo':   return '🔥';
      case 'consume': return '⚗';
      case 'water':   return '💧';
      default:        return '◆';
    }
  }

  relativeTime(timestamp: string): string {
    const diffMs  = Date.now() - new Date(timestamp).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1)  return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24)  return `${diffHr}h ago`;
    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
