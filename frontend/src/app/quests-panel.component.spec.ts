// quests-panel.component.spec.ts
// Unit tests for QuestsPanelComponent — loading, dirty-field guard, sync, polling

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { EMPTY, Subject } from 'rxjs';
import { QuestsPanelComponent } from './quests-panel.component';
import { SocketService } from './socket.service';
import { chicagoDate } from './quest-progress';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface QuestField { label: string; value: string; }
interface QuestClass { name: string; fields: QuestField[]; }

const apiRes = (classes: QuestClass[] = []) => ({ success: true, classes });

const CLASSES: QuestClass[] = [
  {
    name: 'Web App Developer',
    fields: [
      { label: 'Job (Day Job)',         value: 'IQ-9000 done' },
      { label: 'Personal Projects', value: '[To be logged]' },
    ],
  },
  {
    name: 'Artist',
    fields: [{ label: 'Training', value: '' }],
  },
];

// ── Test suite ────────────────────────────────────────────────────────────────

describe('QuestsPanelComponent', () => {
  let fixture: ComponentFixture<QuestsPanelComponent>;
  let component: QuestsPanelComponent;
  let httpMock: HttpTestingController;
  let journalSubject: Subject<{ timestamp: string }>;

  function flushLoad(classes: QuestClass[] = CLASSES): void {
    const req = httpMock.expectOne(r => r.url.includes('/api/quests/today'));
    req.flush(apiRes(classes));
  }

  beforeEach(async () => {
    journalSubject = new Subject<{ timestamp: string }>();

    const socketMock = {
      onJournalUpdate: vi.fn().mockReturnValue(journalSubject.asObservable()),
      onSystemNotice: vi.fn().mockReturnValue(EMPTY),
    };

    await TestBed.configureTestingModule({
      imports: [QuestsPanelComponent, HttpClientTestingModule],
      providers: [{ provide: SocketService, useValue: socketMock }],
    }).compileComponents();

    httpMock  = TestBed.inject(HttpTestingController);
    fixture   = TestBed.createComponent(QuestsPanelComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpMock.match(r => r.url.includes('/api/system/quests')).forEach(req => {
      req.flush({ success: true, quests: [] });
    });
    httpMock.verify();
    vi.restoreAllMocks();
  });

  // ── Creation ───────────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('creates the component', () => {
      expect(component).toBeTruthy();
    });

    it('isLoading starts true before any HTTP response', () => {
      // ngOnInit not yet triggered (no detectChanges)
      expect(component.isLoading()).toBe(true);
    });

    it('lastSynced starts as empty string', () => {
      expect(component.lastSynced()).toBe('');
    });

    it('questClasses starts as empty array', () => {
      expect(component.questClasses()).toEqual([]);
    });
  });

  // ── loadQuests ─────────────────────────────────────────────────────────────

  describe('loadQuests()', () => {
    beforeEach(() => {
      fixture.detectChanges(); // triggers ngOnInit → loadQuests()
    });

    it('populates questClasses after a successful fetch', () => {
      flushLoad();
      expect(component.questClasses()).toHaveLength(2);
      expect(component.questClasses()[0].name).toBe('Web App Developer');
    });

    it('sets isLoading to false after response', () => {
      flushLoad();
      expect(component.isLoading()).toBe(false);
    });

    it('sets lastSynced to a non-empty time string after response', () => {
      flushLoad();
      expect(component.lastSynced()).toBeTruthy();
    });

    it('converts [To be logged] to empty string', () => {
      flushLoad();
      const devClass = component.questClasses().find(c => c.name === 'Web App Developer')!;
      const personal = devClass.fields.find(f => f.label === 'Personal Projects')!;
      expect(personal.value).toBe('');
    });

    it('preserves non-placeholder values as-is', () => {
      flushLoad();
      const devClass = component.questClasses().find(c => c.name === 'Web App Developer')!;
      expect(devClass.fields.find(f => f.label === 'Job (Day Job)')!.value).toBe('IQ-9000 done');
    });

    it('sets isLoading to false on error', () => {
      const req = httpMock.expectOne(r => r.url.includes('/api/quests/today'));
      req.flush('error', { status: 500, statusText: 'Server Error' });
      expect(component.isLoading()).toBe(false);
    });
  });

  // ── loadQuestsWithMerge: dirty field guard ─────────────────────────────────

  describe('loadQuestsWithMerge() — dirty field guard', () => {
    beforeEach(() => {
      fixture.detectChanges();
      flushLoad(); // complete initial load
    });

    it('preserves a dirty field value when fetched data differs', () => {
      // Simulate user editing the field — mark it dirty
      component.onFieldChange('Web App Developer', 'Job (Day Job)', 'my unsaved edit');

      // Trigger manual sync while dirty
      component.manualSync();

      const req = httpMock.expectOne(r => r.url.includes('/api/quests/today'));
      req.flush(apiRes([{
        name: 'Web App Developer',
        fields: [
          { label: 'Job (Day Job)',         value: 'server value' },
          { label: 'Personal Projects', value: '[To be logged]' },
        ],
      }]));

      const devClass = component.questClasses().find(c => c.name === 'Web App Developer')!;
      const jtiField = devClass.fields.find(f => f.label === 'Job (Day Job)')!;
      // dirty field preserved
      expect(jtiField.value).toBe('my unsaved edit');
    });

    it('overwrites a clean field with the fetched value', () => {
      // Do NOT mark Personal Projects dirty
      component.onFieldChange('Web App Developer', 'Job (Day Job)', 'only job dirty');

      component.manualSync();

      const req = httpMock.expectOne(r => r.url.includes('/api/quests/today'));
      req.flush(apiRes([{
        name: 'Web App Developer',
        fields: [
          { label: 'Job (Day Job)',         value: 'server1' },
          { label: 'Personal Projects', value: 'new server value' },
        ],
      }]));

      const devClass = component.questClasses().find(c => c.name === 'Web App Developer')!;
      const personal = devClass.fields.find(f => f.label === 'Personal Projects')!;
      // clean field updated from server
      expect(personal.value).toBe('new server value');
    });
  });

  // ── manualSync ─────────────────────────────────────────────────────────────

  describe('manualSync()', () => {
    beforeEach(() => {
      fixture.detectChanges();
      flushLoad();
    });

    it('calls loadQuests (full replace) when no dirty fields', () => {
      const spy = vi.spyOn(component, 'loadQuests');
      component.manualSync();
      expect(spy).toHaveBeenCalledTimes(1);
      httpMock.expectOne(r => r.url.includes('/api/quests/today')).flush(apiRes());
    });

    it('calls loadQuestsWithMerge when dirty fields exist', () => {
      component.onFieldChange('Artist', 'Training', 'unsaved');
      const mergeSpy = vi.spyOn<any, any>(component, 'loadQuestsWithMerge');
      component.manualSync();
      expect(mergeSpy).toHaveBeenCalledTimes(1);
      httpMock.expectOne(r => r.url.includes('/api/quests/today')).flush(apiRes());
    });
  });

  // ── isLogged / classLoggedCount ────────────────────────────────────────────

  describe('isLogged()', () => {
    it('returns true for a non-empty, non-whitespace value', () => {
      expect(component.isLogged({ label: 'x', value: 'done' })).toBe(true);
    });

    it('returns false for an empty string', () => {
      expect(component.isLogged({ label: 'x', value: '' })).toBe(false);
    });

    it('returns false for whitespace-only value', () => {
      expect(component.isLogged({ label: 'x', value: '   ' })).toBe(false);
    });
  });

  describe('progress cues', () => {
    const boss = {
      id: 'boss-cfc',
      kind: 'acquisition',
      status: 'active',
      hidden: false,
      revealed: true,
      source: 'user',
      createdAt: '2026-11-01T00:00:00.000Z',
      deadline: null,
      scheduledFor: null,
      title: 'BOSS: Code for Cash 2026',
      description: 'Three steps to ship the offer.',
      objectives: [
        { id: 'scope', label: 'Scope the offer', target: 1, progress: 1, done: true },
        { id: 'draft', label: 'Draft the page', target: 1, progress: 1, done: true },
        { id: 'ship', label: 'Ship the page', target: 1, progress: 0, done: false },
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
    };

    function daily(status: string, scheduledFor: string) {
      return {
        ...boss,
        id: `daily-${status}-${scheduledFor}`,
        kind: 'daily',
        status,
        scheduledFor,
        title: 'Morning stretch',
        objectives: [{ id: 'stretch', label: 'Stretch', target: 1, progress: status === 'cleared' ? 1 : 0, done: status === 'cleared' }],
      };
    }

    it('shows a bar, objective count, and a near-miss on a multi-objective quest', () => {
      fixture.detectChanges();
      httpMock.expectOne(r => r.url.includes('/api/quests/today')).flush(apiRes(CLASSES));
      const today = chicagoDate(new Date());
      httpMock.expectOne(r => r.url.includes('/api/system/quests')).flush({
        success: true,
        quests: [boss, daily('cleared', today)],
      });
      fixture.detectChanges();

      const root: HTMLElement = fixture.nativeElement;
      const text = root.textContent ?? '';
      expect(text).toContain('BOSS: Code for Cash 2026');
      expect(text).toContain('2 of 3 objectives');
      expect(text).toContain('Scope the offer');
      expect(text).toContain('Ship the page');
      expect(root.querySelector('[data-testid="quest-progress"] [role="progressbar"]')).toBeTruthy();
      expect(root.querySelector('[data-testid="quest-progress"] [data-testid="near-miss"]')?.textContent)
        .toContain('1 step to clear');
      expect(text).toContain('Done for today');
      expect(text).toContain('1 of 2 objectives');
      const zone = root.querySelector('[data-testid="zone-progress"]');
      expect(zone?.querySelector('[role="progressbar"]')).toBeTruthy();
      expect(zone?.textContent).toContain('1 step to clear');
    });

    it('does not show Done for today when a daily quest for today is still active', () => {
      fixture.detectChanges();
      httpMock.expectOne(r => r.url.includes('/api/quests/today')).flush(apiRes([]));
      const today = chicagoDate(new Date());
      httpMock.expectOne(r => r.url.includes('/api/system/quests')).flush({
        success: true,
        quests: [daily('active', today)],
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('Done for today');
      expect(fixture.nativeElement.textContent).toContain('0 of 1 objective');
    });
  });

  describe('classLoggedCount()', () => {
    beforeEach(() => {
      fixture.detectChanges();
      flushLoad();
    });

    it('counts only logged (non-empty) fields', () => {
      const devClass = component.questClasses().find(c => c.name === 'Web App Developer')!;
      // Job (Day Job) = 'IQ-9000 done' → logged; Personal Projects = '' → not logged
      expect(component.classLoggedCount(devClass)).toBe(1);
    });
  });

  // ── Polling setup / teardown ───────────────────────────────────────────────

  describe('polling', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('registers setInterval on ngOnInit', () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      fixture.detectChanges();
      flushLoad();
      expect(spy).toHaveBeenCalled();
      component.ngOnDestroy();
    });

    it('clears the poll timer on ngOnDestroy', () => {
      const clearSpy = vi.spyOn(globalThis, 'clearInterval');
      fixture.detectChanges();
      flushLoad();
      component.ngOnDestroy();
      expect(clearSpy).toHaveBeenCalled();
    });
  });

  // ── visibilitychange ───────────────────────────────────────────────────────

  describe('visibilitychange listener', () => {
    beforeEach(() => {
      fixture.detectChanges();
      flushLoad();
    });

    it('does NOT trigger a reload when document is hidden', () => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      // No additional HTTP request should be queued
      httpMock.expectNone(r => r.url.includes('/api/quests/today'));
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    });

    it('triggers loadQuestsWithMerge when tab becomes visible and no dirty fields', () => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      // Expect a merge reload request
      httpMock.expectOne(r => r.url.includes('/api/quests/today')).flush(apiRes());
    });

    it('removes the visibilitychange listener on ngOnDestroy', () => {
      component.ngOnDestroy();
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      httpMock.expectNone(r => r.url.includes('/api/quests/today'));
    });
  });
});
