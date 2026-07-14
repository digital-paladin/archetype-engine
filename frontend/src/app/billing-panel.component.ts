import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

interface BillingStatus {
  success: boolean;
  configured: boolean;
  tier: 'free' | 'paladin' | 'shadow_monarch';
  tierLabel: string;
  features: string[];
  subscription: {
    status: string;
    plan: string | null;
    currentPeriodEnd: string | null;
    hasCustomer: boolean;
  } | null;
}

@Component({
  selector: 'app-billing-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="billing-panel">
      <section class="eso-panel">
        <h3 class="eso-panel-title">⚔ Subscription</h3>

        @if (loading()) {
          <p class="muted">Loading billing status…</p>
        } @else if (error()) {
          <p class="err">{{ error() }}</p>
        } @else if (status(); as s) {
          <div class="tier-row">
            <span class="tier-badge" [attr.data-tier]="s.tier">{{ s.tierLabel }}</span>
            @if (s.subscription?.status) {
              <span class="sub-status">{{ s.subscription!.status }}</span>
            }
          </div>

          <ul class="feature-list">
            @for (f of s.features; track f) {
              <li>{{ f }}</li>
            }
          </ul>

          @if (!s.configured) {
            <p class="muted">
              Stripe is not configured on the server yet. Owner must add
              <code>STRIPE_*</code> keys on Railway.
            </p>
          } @else {
            <div class="actions">
              @if (s.tier === 'free') {
                <button type="button" class="btn primary" [disabled]="busy()" (click)="checkout('paladin')">
                  Upgrade to Paladin — $9/mo
                </button>
                <button type="button" class="btn" [disabled]="busy()" (click)="checkout('shadow_monarch')">
                  Shadow Monarch — $19/mo
                </button>
              } @else if (s.tier === 'paladin') {
                <button type="button" class="btn primary" [disabled]="busy()" (click)="checkout('shadow_monarch')">
                  Upgrade to Shadow Monarch — $19/mo
                </button>
                <button type="button" class="btn" [disabled]="busy()" (click)="openPortal()">
                  Manage billing
                </button>
              } @else {
                <button type="button" class="btn" [disabled]="busy()" (click)="openPortal()">
                  Manage billing
                </button>
              }
            </div>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    .billing-panel { padding: 0.5rem; }
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
    .tier-row { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0.75rem; }
    .tier-badge {
      padding: 0.2rem 0.6rem;
      border: 1px solid rgba(201,168,76,0.5);
      color: #c9a84c;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .tier-badge[data-tier="paladin"] { color: #6fcf97; border-color: #6fcf97; }
    .tier-badge[data-tier="shadow_monarch"] { color: #c084fc; border-color: #c084fc; }
    .sub-status { font-size: 0.75rem; opacity: 0.7; }
    .feature-list {
      margin: 0 0 1rem;
      padding-left: 1.1rem;
      color: #d4c4a8;
      font-size: 0.85rem;
    }
    .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
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
    .err { color: #eb5757; font-size: 0.85rem; }
    code { font-size: 0.8em; }
  `],
})
export class BillingPanelComponent implements OnInit {
  private readonly http = inject(HttpClient);

  status = signal<BillingStatus | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  busy = signal(false);

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<BillingStatus>(`${environment.apiUrl}/api/billing/status`).subscribe({
      next: (s) => {
        this.status.set(s);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error || 'Could not load billing status');
        this.loading.set(false);
      },
    });
  }

  checkout(plan: 'paladin' | 'shadow_monarch'): void {
    this.busy.set(true);
    this.http.post<{ success: boolean; url?: string; error?: string }>(
      `${environment.apiUrl}/api/billing/checkout`,
      { plan },
    ).subscribe({
      next: (res) => {
        this.busy.set(false);
        if (res.url) {
          window.location.href = res.url;
        } else {
          alert(res.error || 'Checkout unavailable');
        }
      },
      error: (err) => {
        this.busy.set(false);
        alert(err?.error?.error || 'Checkout failed');
      },
    });
  }

  openPortal(): void {
    this.busy.set(true);
    this.http.post<{ success: boolean; url?: string; error?: string }>(
      `${environment.apiUrl}/api/billing/portal`,
      {},
    ).subscribe({
      next: (res) => {
        this.busy.set(false);
        if (res.url) window.location.href = res.url;
        else alert(res.error || 'Portal unavailable');
      },
      error: (err) => {
        this.busy.set(false);
        alert(err?.error?.error || 'Portal failed');
      },
    });
  }
}
