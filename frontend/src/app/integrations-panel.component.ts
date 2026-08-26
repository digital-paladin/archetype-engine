import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

interface TodoistConnectStatus {
  success: boolean;
  connected: boolean;
  source: 'user' | 'env' | null;
  masked: string | null;
  error?: string;
}

@Component({
  selector: 'app-integrations-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="integrations-panel">
      <section class="eso-panel">
        <h3 class="eso-panel-title">Integrations</h3>
        <p class="muted">Connect third-party accounts. Keys are stored encrypted and never shown in full.</p>
      </section>

      <section class="eso-panel">
        <h3 class="eso-panel-title">Todoist</h3>

        @if (loading()) {
          <p class="muted">Loading connection status…</p>
        } @else if (connected()) {
          <p class="status-row">
            Connected
            <span class="mask">{{ masked() }}</span>
            @if (source() === 'env') {
              <span class="muted">(owner env fallback)</span>
            }
          </p>
          <button type="button" class="btn" [disabled]="busy()" (click)="disconnect()">Disconnect</button>
        } @else {
          <label class="key-label" for="todoist-api-key">API token</label>
          <input
            id="todoist-api-key"
            class="key-input"
            type="password"
            autocomplete="off"
            [(ngModel)]="apiKey"
            placeholder="Todoist developer API token"
          />
          <button type="button" class="btn primary" [disabled]="busy() || !apiKey.trim()" (click)="connect()">
            Connect
          </button>
        }

        @if (error()) {
          <p class="err">{{ error() }}</p>
        }
      </section>
    </div>
  `,
  styles: [`
    .integrations-panel { padding: 0.5rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .eso-panel {
      background: rgba(20, 16, 28, 0.85);
      border: 1px solid rgba(201, 168, 76, 0.35);
      padding: 1rem 1.25rem;
    }
    .eso-panel-title {
      margin: 0 0 0.75rem;
      color: var(--eso-gold, #c9a84c);
      font-size: 0.95rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .status-row { color: #d4c4a8; font-size: 0.9rem; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .mask { font-family: ui-monospace, monospace; color: #c9a84c; }
    .key-label { display: block; color: #8a7a5a; font-size: 0.75rem; margin-bottom: 0.35rem; }
    .key-input {
      display: block;
      width: min(28rem, 100%);
      margin-bottom: 0.6rem;
      background: rgba(0,0,0,0.35);
      border: 1px solid rgba(201,168,76,0.35);
      color: #d4c4a8;
      padding: 0.45rem 0.6rem;
      font: inherit;
    }
    .btn {
      background: transparent;
      border: 1px solid rgba(201,168,76,0.45);
      color: #c9a84c;
      padding: 0.45rem 0.8rem;
      cursor: pointer;
      font: inherit;
      font-size: 0.8rem;
    }
    .btn.primary { background: rgba(201,168,76,0.15); }
    .btn:disabled { opacity: 0.5; cursor: wait; }
    .muted { color: #8a7a5a; font-size: 0.85rem; }
    .err { color: #eb5757; font-size: 0.85rem; margin-top: 0.6rem; }
  `],
})
export class IntegrationsPanelComponent implements OnInit {
  private readonly http = inject(HttpClient);

  loading = signal(true);
  busy = signal(false);
  error = signal<string | null>(null);
  connected = signal(false);
  masked = signal<string | null>(null);
  source = signal<'user' | 'env' | null>(null);
  apiKey = '';

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<TodoistConnectStatus>(`${environment.apiUrl}/api/todoist/connect`).subscribe({
      next: (s) => {
        this.connected.set(!!s.connected);
        this.masked.set(s.masked ?? null);
        this.source.set(s.source ?? null);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error || 'Could not load Todoist status');
        this.connected.set(false);
        this.loading.set(false);
      },
    });
  }

  connect(): void {
    const key = this.apiKey.trim();
    if (!key) return;
    this.busy.set(true);
    this.error.set(null);
    this.http.post<TodoistConnectStatus>(`${environment.apiUrl}/api/todoist/connect`, { apiKey: key }).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.apiKey = '';
        this.connected.set(!!s.connected);
        this.masked.set(s.masked ?? null);
        this.source.set(s.source ?? 'user');
      },
      error: (err) => {
        this.busy.set(false);
        this.connected.set(false);
        this.error.set(err?.error?.error || 'Connect failed');
      },
    });
  }

  disconnect(): void {
    this.busy.set(true);
    this.error.set(null);
    this.http.delete<TodoistConnectStatus>(`${environment.apiUrl}/api/todoist/connect`).subscribe({
      next: () => {
        this.busy.set(false);
        this.connected.set(false);
        this.masked.set(null);
        this.source.set(null);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err?.error?.error || 'Disconnect failed');
      },
    });
  }
}
