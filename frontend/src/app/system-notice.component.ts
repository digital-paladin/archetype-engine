import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SystemQuestService } from './system-quest.service';

@Component({
  selector: 'app-system-notice',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (system.notice(); as notice) {
      <div class="sys-notice-backdrop" data-testid="system-notice" (click)="system.dismissNotice()">
        <div class="sys-notice-card" [attr.data-type]="notice.type" (click)="$event.stopPropagation()">
          <p class="sys-notice-kicker">[SYSTEM]</p>
          <p class="sys-notice-type">{{ label(notice.type) }}</p>
          <h2>{{ notice.title }}</h2>
          <p class="sys-notice-detail">{{ notice.detail }}</p>
          <button type="button" (click)="system.dismissNotice()">Acknowledge</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .sys-notice-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2200;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(2, 6, 16, 0.78);
      backdrop-filter: blur(4px);
    }
    .sys-notice-card {
      width: min(420px, calc(100vw - 32px));
      padding: 28px 26px 22px;
      text-align: center;
      color: #e7f0ff;
      background: linear-gradient(180deg, rgba(12, 28, 58, 0.98), rgba(6, 12, 28, 0.98));
      border: 1px solid rgba(126, 182, 255, 0.75);
      box-shadow: 0 0 40px rgba(80, 140, 255, 0.28);
      font-family: 'Cinzel', serif;
      animation: sys-notice-in 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.2);
    }
    .sys-notice-card[data-type="failed"],
    .sys-notice-card[data-type="expired"] { border-color: rgba(255, 140, 140, 0.8); }
    .sys-notice-card[data-type="cleared"] { border-color: rgba(140, 230, 170, 0.8); }
    .sys-notice-kicker { letter-spacing: 0.28em; color: #8eb7ff; margin: 0 0 8px; }
    .sys-notice-type { margin: 0; letter-spacing: 0.14em; font-size: 12px; color: #d7e7ff; }
    h2 { margin: 12px 0; font-size: 22px; }
    .sys-notice-detail { font-family: 'Open Sans', sans-serif; color: #c5d6f2; }
    button {
      margin-top: 8px;
      background: transparent;
      color: #fff;
      border: 1px solid rgba(126, 182, 255, 0.8);
      padding: 8px 16px;
      letter-spacing: 0.12em;
      font-family: 'Cinzel', serif;
      cursor: pointer;
    }
    @keyframes sys-notice-in {
      from { opacity: 0; transform: scale(0.86); }
      to { opacity: 1; transform: scale(1); }
    }
  `],
})
export class SystemNoticeComponent {
  readonly system = inject(SystemQuestService);

  label(type: string): string {
    switch (type) {
      case 'issued': return 'QUEST ISSUED';
      case 'cleared': return 'QUEST CLEARED';
      case 'failed': return 'QUEST FAILED';
      case 'expired': return 'QUEST EXPIRED';
      case 'revealed': return 'QUEST REVEALED';
      default: return 'MESSAGE';
    }
  }
}
