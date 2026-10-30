import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { SystemNoticeComponent } from './system-notice.component';
import { SystemWindowComponent } from './system-window.component';
import { SocketService } from './socket.service';
import { formatCountdown, SystemQuestService } from './system-quest.service';

const TWO_HOURS = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

const QUESTS = [
  {
    id: 'q1',
    kind: 'daily',
    status: 'active',
    hidden: false,
    revealed: true,
    source: 'grokbot',
    createdAt: new Date().toISOString(),
    deadline: TWO_HOURS,
    title: 'Mobility walk',
    description: 'Twenty easy minutes.',
    objectives: [{ id: 'walk', label: 'Walk 20 minutes', target: 20, progress: 5, done: false }],
    xpReward: { Warrior: 40 },
    rewardNote: 'New running shoes — suggestion only',
    rewardCostsMoney: true,
    rewardApproval: 'pending',
    penalty: { recoveryType: 'earlier_lights_out', xpPenalty: { Warrior: 15 } },
    training: false,
    thursdayTrainingFlag: false,
    recoveryType: null,
    resolution: null,
    resolvedAt: null,
    editedAt: '2026-10-20T18:00:00.000Z',
    editCount: 1,
    lastEditReason: 'Tuesday schedule changed: parkour 7:30-8:30 PM',
  },
  {
    id: 'q2',
    kind: 'hidden',
    status: 'active',
    hidden: true,
    revealed: false,
    source: 'grokbot',
    createdAt: new Date().toISOString(),
    deadline: TWO_HOURS,
    title: null,
    description: null,
    objectives: [],
    xpReward: {},
    rewardNote: null,
    rewardCostsMoney: false,
    rewardApproval: 'not_required',
    penalty: null,
    training: false,
    thursdayTrainingFlag: false,
    recoveryType: null,
    resolution: null,
    resolvedAt: null,
  },
  {
    id: 'q3',
    kind: 'daily',
    status: 'cleared',
    hidden: false,
    revealed: true,
    source: 'grokbot',
    createdAt: new Date().toISOString(),
    deadline: null,
    title: 'Read one chapter',
    description: '',
    objectives: [],
    xpReward: { Sage: 25 },
    rewardNote: null,
    rewardCostsMoney: false,
    rewardApproval: 'not_required',
    penalty: null,
    training: false,
    thursdayTrainingFlag: false,
    recoveryType: null,
    resolution: { outcome: 'cleared', xpPlanned: [{ className: 'Sage', xp: 25 }] },
    resolvedAt: new Date().toISOString(),
  },
  {
    id: 'q4',
    kind: 'acquisition',
    status: 'active',
    hidden: false,
    revealed: true,
    source: 'user',
    createdAt: new Date().toISOString(),
    deadline: null,
    title: 'RTX 3090 PC rig',
    description: 'Local AI build.',
    objectives: [
      { id: 'purchase-gpu', label: 'Purchase the RTX 3090', target: 1, progress: 0, done: false, xpReward: { Developer: 40 } },
    ],
    xpReward: {},
    rewardNote: null,
    rewardCostsMoney: false,
    rewardApproval: 'not_required',
    penalty: null,
    training: false,
    thursdayTrainingFlag: false,
    recoveryType: null,
    resolution: null,
    resolvedAt: null,
    targetCostCents: 180000,
    amountSavedCents: 45000,
    inventoryItemId: 'row-1',
    budgetGrantsXp: false,
    linkedItem: {
      id: 'row-1',
      slug: 'rtx-3090-rig',
      name: 'RTX 3090 PC rig',
      category: 'tech-hardware',
      stockStatus: 'needed',
    },
  },
];

describe('formatCountdown', () => {
  it('renders a clock and a zero clock after the deadline', () => {
    const now = Date.parse('2026-10-20T12:00:00.000Z');
    expect(formatCountdown('2026-10-20T14:00:00.000Z', now)).toBe('02:00:00');
    expect(formatCountdown('2026-10-20T11:00:00.000Z', now)).toBe('00:00:00');
    expect(formatCountdown(null, now)).toBe('No deadline');
  });
});

describe('System window', () => {
  let fixture: ComponentFixture<SystemWindowComponent>;
  let httpMock: HttpTestingController;
  let notices: Subject<{ type: string; title: string; detail: string }>;
  let noticeFixture: ComponentFixture<SystemNoticeComponent>;

  beforeEach(async () => {
    notices = new Subject();
    await TestBed.configureTestingModule({
      imports: [SystemWindowComponent, SystemNoticeComponent, HttpClientTestingModule],
      providers: [{
        provide: SocketService,
        useValue: { onSystemNotice: () => notices.asObservable(), refreshAuth: () => undefined },
      }],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SystemWindowComponent);
    noticeFixture = TestBed.createComponent(SystemNoticeComponent);
    fixture.detectChanges();
    noticeFixture.detectChanges();

    const quests = httpMock.expectOne(req => req.url.includes('/api/system/quests'));
    quests.flush({ success: true, quests: QUESTS });
    const credentials = httpMock.expectOne(req => req.url.includes('/api/system/credentials'));
    credentials.flush({ success: true, credentials: [] });
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    noticeFixture.destroy();
    httpMock.verify();
  });

  it('shows active quests, a countdown, rewards, and masks hidden quests', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Mobility walk');
    expect(text).toContain('Walk 20 minutes');
    expect(text).toContain('EDITED');
    expect(text).toContain('Tuesday schedule changed: parkour 7:30-8:30 PM');
    expect(fixture.nativeElement.querySelector('[data-testid="system-quest-edited"]').getAttribute('title'))
      .toContain('parkour');
    expect(text).toContain('+40 Warrior');
    expect(text).toContain('earlier lights out');
    expect(text).toContain('???');
    expect(text).not.toContain('Secret Door Protocol');
    const clocks = fixture.nativeElement.querySelectorAll('[data-testid="system-countdown"]');
    expect(clocks.length).toBeGreaterThan(0);
    expect(clocks[0].textContent).toMatch(/\d\d:\d\d:\d\d/);
    expect(fixture.nativeElement.querySelector('[data-testid="system-active-count"]').textContent).toContain('3 active');
    const budget = fixture.nativeElement.querySelector('[data-testid="acquisition-budget"]');
    expect(budget.textContent).toContain('$450.00 saved of $1,800.00');
    expect(budget.textContent).toContain('does not grant XP');
    expect(budget.textContent.toLowerCase()).not.toContain('developer');
    expect(fixture.nativeElement.querySelector('[data-testid="acquisition-item"]').textContent).toContain('RTX 3090 PC rig');
    expect(fixture.nativeElement.querySelector('[data-kind="acquisition"] [data-testid="system-countdown"]').textContent)
      .toContain('Open-ended');
    expect(fixture.nativeElement.textContent).toContain('+40 Developer');
    expect(fixture.nativeElement.textContent).toContain('Read one chapter');
    expect(fixture.nativeElement.textContent).toContain('+25 Sage');
    expect(TestBed.inject(SystemQuestService).activeCount()).toBe(3);
  });

  it('asks the player to approve a money reward and does not send XP', () => {
    const button = fixture.nativeElement.querySelector('[data-testid="approve-reward"]') as HTMLButtonElement;
    button.click();
    const req = httpMock.expectOne(r => r.url.includes('/reward-approval'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ decision: 'approved' });
    expect(JSON.stringify(req.request.body)).not.toContain('xp');
    req.flush({ success: true, quest: { ...QUESTS[0], rewardApproval: 'approved' } });
    httpMock.expectOne(r => r.url.endsWith('/api/system/quests')).flush({ success: true, quests: [] });
  });

  it('opens a notice when the System issues a quest', () => {
    notices.next({ type: 'issued', title: 'Emergency: lights out', detail: 'In bed in 30 minutes.' });
    noticeFixture.detectChanges();
    const notice = noticeFixture.nativeElement.querySelector('[data-testid="system-notice"]');
    expect(notice.textContent).toContain('[SYSTEM]');
    expect(notice.textContent).toContain('QUEST ISSUED');
    expect(notice.textContent).toContain('Emergency: lights out');
    httpMock.expectOne(r => r.url.includes('/api/system/quests')).flush({ success: true, quests: QUESTS });
  });

  it('shows corrected objectives after an edited notice', () => {
    notices.next({ type: 'edited', title: 'Mobility walk', detail: 'Parkour technique only' });
    noticeFixture.detectChanges();
    expect(noticeFixture.nativeElement.textContent).toContain('QUEST EDITED');
    const refreshed = httpMock.expectOne(r => r.url.includes('/api/system/quests') && r.method === 'GET');
    refreshed.flush({
      success: true,
      quests: [{
        ...QUESTS[0],
        objectives: [
          ...QUESTS[0].objectives,
          { id: 'parkour', label: 'Parkour technique only', target: 1, progress: 0, done: false },
        ],
      }],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Parkour technique only');
    expect(fixture.nativeElement.querySelector('[data-testid="system-quest-edited"]').textContent).toContain('EDITED');
  });

  it('shows a generated service token once', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'Grok Bot';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="mint-credential"]') as HTMLButtonElement).click();
    const req = httpMock.expectOne(r => r.url.includes('/api/system/credentials') && r.method === 'POST');
    expect(req.request.body.scopes).toEqual(['system']);
    req.flush({ token: 'sys_example_token', credential: { id: 'c1', name: 'Grok Bot', tokenPrefix: 'sys_example', scopes: ['system'], createdAt: '', revokedAt: null, lastUsedAt: null } });
    httpMock.expectOne(r => r.url.includes('/api/system/credentials') && r.method === 'GET')
      .flush({ success: true, credentials: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="minted-token"]').textContent).toContain('sys_example_token');
  });
});
