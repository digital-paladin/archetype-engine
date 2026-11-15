import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SystemQuest, SystemQuestService, formatCountdown } from './system-quest.service';

@Component({
  selector: 'app-system-window',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="sys-window" data-testid="system-window">
      <header class="sys-head">
        <div>
          <p class="sys-kicker">[SYSTEM]</p>
          <h2>Quest Window</h2>
        </div>
        <div class="sys-head-meta">
          <span class="sys-count" data-testid="system-active-count">{{ system.activeCount() }} active</span>
          <button type="button" class="sys-text-btn" (click)="reload()">Refresh</button>
        </div>
      </header>

      <p class="sys-error" *ngIf="system.error()">{{ system.error() }}</p>

      <div class="sys-empty" *ngIf="activeQuests.length === 0">
        <p class="sys-kicker">[SYSTEM]</p>
        <p>No active quests. The System is quiet.</p>
      </div>

      <article class="sys-card" data-testid="system-quest" *ngFor="let quest of activeQuests" [attr.data-kind]="quest.hidden ? 'hidden' : quest.kind">
        <div class="sys-card-top">
          <div class="sys-card-tags">
            <span class="sys-kind">{{ quest.hidden ? 'HIDDEN' : (quest.kind | uppercase) }}</span>
            <span class="sys-edited" *ngIf="quest.editedAt" data-testid="system-quest-edited" [attr.title]="quest.lastEditReason || 'The System corrected this quest'">EDITED</span>
          </div>
          <span class="sys-clock" data-testid="system-countdown">{{ countdown(quest) }}</span>
        </div>

        <ng-container *ngIf="quest.hidden; else openQuest">
          <h3>???</h3>
          <p class="sys-sealed">A hidden quest has been issued. Details remain sealed.</p>
        </ng-container>
        <ng-template #openQuest>
          <h3>{{ quest.title }}</h3>
          <p class="sys-edited-reason" *ngIf="quest.lastEditReason" data-testid="system-edit-reason">{{ quest.lastEditReason }}</p>
          <p class="sys-desc" *ngIf="quest.description">{{ quest.description }}</p>
          <p class="sys-flag" *ngIf="quest.thursdayTrainingFlag">Thursday rest day — this quest is flagged as training.</p>

          <ul class="sys-objectives">
            <li *ngFor="let objective of quest.objectives" [class.done]="objective.done">
              <span class="sys-obj-label">{{ objective.label }}</span>
              <span class="sys-obj-xp" *ngIf="objectiveXp(objective)">{{ objectiveXp(objective) }}</span>
              <span class="sys-obj-count">{{ objective.progress }}/{{ objective.target }}</span>
              <span class="sys-bar"><span [style.width.%]="objectivePct(objective)"></span></span>
            </li>
          </ul>

          <div class="sys-budget" *ngIf="quest.kind === 'acquisition'" data-testid="acquisition-budget">
            <div class="sys-rewards">
              <span class="sys-label">Budget</span>
              <span>{{ formatUsd(quest.amountSavedCents) }} saved of {{ formatUsd(quest.targetCostCents) }}</span>
            </div>
            <span class="sys-bar" *ngIf="quest.targetCostCents"><span [style.width.%]="budgetPct(quest)"></span></span>
            <p class="sys-budget-note" data-testid="acquisition-budget-note">Saving or spending does not grant XP.</p>
            <p class="sys-linked" *ngIf="quest.linkedItem" data-testid="acquisition-item">
              Item: {{ quest.linkedItem.name }} · {{ quest.linkedItem.stockStatus || 'untracked' }}
            </p>
          </div>

          <div class="sys-rewards" *ngIf="rewardLines(quest).length">
            <span class="sys-label">Reward</span>
            <span *ngFor="let line of rewardLines(quest)">+{{ line.xp }} {{ line.className }}</span>
          </div>

          <div class="sys-money" *ngIf="quest.rewardCostsMoney" data-testid="system-money-reward">
            <p>Suggested reward (costs money): {{ quest.rewardNote }}</p>
            <p class="sys-approval">Approval: {{ quest.rewardApproval }}</p>
            <div *ngIf="quest.rewardApproval === 'pending'">
              <button type="button" data-testid="approve-reward" (click)="system.decideReward(quest.id, 'approved')">Approve</button>
              <button type="button" (click)="system.decideReward(quest.id, 'declined')">Decline</button>
            </div>
          </div>

          <p class="sys-note" *ngIf="quest.rewardNote && !quest.rewardCostsMoney">{{ quest.rewardNote }}</p>
          <p class="sys-penalty" *ngIf="quest.penalty">
            Penalty: {{ labelize(quest.penalty.recoveryType) }}
            <span *ngIf="penaltyLines(quest).length"> · {{ penaltyLines(quest).join(', ') }}</span>
          </p>
        </ng-template>
      </article>

      <section class="sys-history" *ngIf="resolvedQuests.length" data-testid="system-results">
        <h3>Clear / Fail</h3>
        <article class="sys-result" *ngFor="let quest of resolvedQuests" [attr.data-status]="quest.status">
          <span class="sys-kind">{{ quest.status | uppercase }}</span>
          <strong>{{ quest.hidden ? '???' : quest.title }}</strong>
          <span *ngIf="quest.resolution?.xpPlanned?.length">
            {{ xpLine(quest) }}
          </span>
        </article>
      </section>

      <section class="sys-cred" data-testid="system-credentials">
        <h3>Grok Bot credential</h3>
        <p>This key can only call System endpoints. It is shown once. Revoke it here if it leaks.</p>
        <div class="sys-cred-row">
          <input [(ngModel)]="credentialName" maxlength="80" aria-label="Credential name" />
          <button type="button" data-testid="mint-credential" (click)="mint()">Generate</button>
        </div>
        <p class="sys-token" data-testid="minted-token" *ngIf="system.mintedToken() as token">
          Copy now. It will not be shown again.
          <code>{{ token }}</code>
          <button type="button" (click)="system.dismissMintedToken()">Hide</button>
        </p>
        <ul>
          <li *ngFor="let cred of system.credentials()">
            <span>{{ cred.name }} · {{ cred.tokenPrefix }}… · {{ cred.scopes.join(', ') }}</span>
            <span *ngIf="cred.revokedAt">revoked</span>
            <button type="button" *ngIf="!cred.revokedAt" (click)="system.revokeCredential(cred.id)">Revoke</button>
          </li>
        </ul>
      </section>
    </section>
  `,
  styles: [`
    .sys-window {
      margin: 12px;
      padding: 22px 22px 28px;
      color: #d7e7ff;
      background:
        linear-gradient(180deg, rgba(10, 22, 48, 0.96), rgba(5, 10, 24, 0.98));
      border: 1px solid rgba(126, 182, 255, 0.55);
      box-shadow: 0 0 0 1px rgba(8, 16, 40, 0.8), 0 0 32px rgba(70, 130, 255, 0.18), inset 0 0 40px rgba(40, 80, 160, 0.12);
      font-family: 'Cinzel', serif;
    }
    .sys-head, .sys-card-top, .sys-cred-row, .sys-rewards, .sys-result, .sys-card-tags {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }
    .sys-card-tags { justify-content: flex-start; gap: 8px; }
    .sys-edited {
      letter-spacing: 0.16em;
      font-size: 10px;
      color: #1a1408;
      background: #ffd27a;
      padding: 2px 6px;
    }
    .sys-edited-reason { color: #ffd27a; font-size: 13px; font-family: 'Open Sans', sans-serif; }
    .sys-kicker, .sys-kind, .sys-label {
      letter-spacing: 0.18em;
      color: #8eb7ff;
      font-size: 11px;
    }
    h2, h3 { margin: 0; font-weight: 600; color: #f4f8ff; }
    h2 { font-size: 22px; }
    .sys-count {
      min-width: 64px;
      text-align: center;
      padding: 4px 8px;
      border: 1px solid rgba(126, 182, 255, 0.7);
      color: #fff;
      background: rgba(40, 90, 180, 0.35);
    }
    .sys-card, .sys-result, .sys-cred, .sys-empty {
      margin-top: 14px;
      padding: 14px 16px;
      border: 1px solid rgba(126, 182, 255, 0.28);
      background: rgba(6, 14, 32, 0.65);
    }
    .sys-card[data-kind="emergency"] { border-color: rgba(255, 120, 120, 0.7); }
    .sys-card[data-kind="penalty"] { border-color: rgba(255, 176, 92, 0.7); }
    .sys-card[data-kind="hidden"] { border-color: rgba(176, 140, 255, 0.7); }
    .sys-card[data-kind="acquisition"] { border-color: rgba(242, 201, 106, 0.75); }
    .sys-obj-xp { margin-left: 8px; color: #9dffa8; font-size: 12px; }
    .sys-budget { margin-top: 10px; padding: 10px; border: 1px solid rgba(242, 201, 106, 0.45); }
    .sys-budget-note, .sys-linked { margin: 6px 0 0; color: #d7c59a; font-family: 'Open Sans', sans-serif; font-size: 13px; }
    .sys-desc, .sys-sealed, .sys-cred p, .sys-note { color: #b7c9e8; font-family: 'Open Sans', sans-serif; font-size: 14px; }
    .sys-flag { color: #ffd27a; font-size: 13px; }
    .sys-objectives { list-style: none; padding: 0; margin: 12px 0; }
    .sys-objectives li { margin: 8px 0; font-family: 'Open Sans', sans-serif; font-size: 14px; }
    .sys-obj-count { float: right; color: #8eb7ff; }
    .sys-bar { display: block; height: 4px; margin-top: 4px; background: rgba(255,255,255,0.08); }
    .sys-bar > span { display: block; height: 100%; background: #7eb6ff; }
    .sys-objectives li.done .sys-obj-label { color: #9dffa8; }
    .sys-clock { font-variant-numeric: tabular-nums; color: #fff; }
    .sys-money { margin-top: 10px; padding: 10px; border: 1px dashed rgba(255, 210, 122, 0.7); }
    .sys-money button, .sys-cred button, .sys-text-btn {
      margin-right: 8px;
      background: transparent;
      color: #d7e7ff;
      border: 1px solid rgba(126, 182, 255, 0.6);
      padding: 6px 10px;
      font-family: 'Cinzel', serif;
      cursor: pointer;
    }
    .sys-cred input {
      flex: 1;
      background: rgba(0,0,0,0.35);
      color: #fff;
      border: 1px solid rgba(126, 182, 255, 0.4);
      padding: 8px;
    }
    .sys-token code { display: block; margin: 8px 0; word-break: break-all; color: #fff; font-size: 12px; }
    .sys-cred ul { list-style: none; padding: 0; }
    .sys-cred li, .sys-result { font-family: 'Open Sans', sans-serif; font-size: 13px; margin-top: 8px; }
    .sys-result[data-status="cleared"] strong { color: #9dffa8; }
    .sys-result[data-status="failed"], .sys-result[data-status="expired"] strong { color: #ffb4b4; }
    .sys-error { color: #ffb4b4; }
    .sys-penalty { color: #ffcf9a; font-size: 13px; }
  `],
})
export class SystemWindowComponent implements OnInit, OnDestroy {
  readonly system = inject(SystemQuestService);
  readonly now = signal(Date.now());
  credentialName = 'Grok Bot';
  private timer = 0;

  ngOnInit(): void {
    this.system.refresh();
    this.system.loadCredentials();
    this.timer = window.setInterval(() => this.now.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    window.clearInterval(this.timer);
  }

  get activeQuests(): SystemQuest[] {
    return this.system.quests().filter(q => q.status === 'active');
  }

  get resolvedQuests(): SystemQuest[] {
    return this.system.quests().filter(q => q.status !== 'active').slice(0, 8);
  }

  countdown(quest: SystemQuest): string {
    if (quest.kind === 'acquisition' && !quest.deadline) return 'Open-ended';
    return formatCountdown(quest.deadline, this.now());
  }

  formatUsd(cents: number | null | undefined): string {
    if (cents == null) return 'no target';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  }

  budgetPct(quest: SystemQuest): number {
    if (!quest.targetCostCents) return 0;
    return Math.min(100, Math.round(((quest.amountSavedCents ?? 0) / quest.targetCostCents) * 100));
  }

  objectiveXp(objective: SystemQuest['objectives'][number]): string {
    const parts = Object.entries(objective.xpReward ?? {})
      .filter(([, xp]) => xp > 0)
      .map(([className, xp]) => `+${xp} ${className}`);
    if (!parts.length) return '';
    return objective.xpAwardedAt ? `${parts.join(', ')} paid` : parts.join(', ');
  }

  rewardLines(quest: SystemQuest): { className: string; xp: number }[] {
    return Object.entries(quest.xpReward ?? {}).map(([className, xp]) => ({ className, xp }));
  }

  penaltyLines(quest: SystemQuest): string[] {
    return Object.entries(quest.penalty?.xpPenalty ?? {}).map(([className, xp]) => `-${xp} ${className}`);
  }

  objectivePct(objective: SystemQuest['objectives'][number]): number {
    if (!objective.target) return 0;
    return Math.min(100, Math.round((objective.progress / objective.target) * 100));
  }

  xpLine(quest: SystemQuest): string {
    return (quest.resolution?.xpPlanned ?? [])
      .map(row => `${row.xp > 0 ? '+' : ''}${row.xp} ${row.className}`)
      .join(', ');
  }

  labelize(value: string | undefined): string {
    return (value ?? 'recovery').replace(/_/g, ' ');
  }

  reload(): void {
    this.system.refresh();
  }

  mint(): void {
    this.system.createCredential(this.credentialName || 'Grok Bot').subscribe({
      error: err => this.system.error.set(err?.error?.message || 'Could not generate a credential.'),
    });
  }
}
