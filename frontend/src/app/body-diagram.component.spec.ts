// body-diagram.component.spec.ts
// Unit tests for the Health body-status list (filters, summary, heal/edit/delete).
// The flat SVG zone map has been retired; logging opens the shared modal instead.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SimpleChange } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { BodyDiagramComponent } from './body-diagram.component';
import { BodyStatusService } from './body-status.service';
import { BodyStatus } from './body-status.interface';

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_INJURY: BodyStatus = {
  id: 'inj-1', bodyPart: 'left-knee', type: 'injury', severity: 'moderate',
  name: 'Sprain', description: 'Knee sprain', startDate: new Date(), color: '#ff6666',
};

const MOCK_ILLNESS: BodyStatus = {
  id: 'ill-1', bodyPart: 'chest', type: 'illness', severity: 'minor',
  name: 'Cold', description: 'Common cold', startDate: new Date(), color: '#ffff99',
};

const MOCK_CRITICAL_INJURY: BodyStatus = {
  id: 'inj-crit', bodyPart: 'head', type: 'injury', severity: 'critical',
  name: 'TBI', description: 'Head trauma', startDate: new Date(), color: '#cc0000',
};

// ── Build a typed BodyStatusService mock ─────────────────────────────────────

function buildMockService(active: BodyStatus[] = []) {
  const statuses$ = new BehaviorSubject<BodyStatus[]>(active);

  return {
    getStatuses:           vi.fn().mockReturnValue(statuses$.asObservable()),
    getActiveStatuses:     vi.fn().mockReturnValue(active),
    getStatusesByBodyPart: vi.fn().mockImplementation((bodyPart: string) =>
      active.filter(s => s.bodyPart === bodyPart)
    ),
    getSummary: vi.fn().mockReturnValue({
      totalActive: active.length,
      injuries:    active.filter(s => s.type === 'injury').length,
      illnesses:   active.filter(s => s.type === 'illness').length,
      diseases:    active.filter(s => s.type === 'disease').length,
      critical:    active.filter(s => s.severity === 'critical').length,
    }),
    getDaysSince:           vi.fn().mockReturnValue(0),
    getRemainingDays:       vi.fn().mockReturnValue(0),
    getRecoveryPercentage:  vi.fn().mockReturnValue(0),
    addStatus:              vi.fn(),
    updateStatus:           vi.fn(),
    markHealed:             vi.fn(),
    removeStatus:           vi.fn(),
    syncFromJournal:        vi.fn(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyDiagramComponent', () => {
  let fixture: ComponentFixture<BodyDiagramComponent>;
  let component: BodyDiagramComponent;
  let svcMock: ReturnType<typeof buildMockService>;

  async function setup(active: BodyStatus[] = [MOCK_INJURY, MOCK_ILLNESS], preSelectedStatusId: string | null = null) {
    TestBed.resetTestingModule();
    svcMock = buildMockService(active);

    await TestBed.configureTestingModule({
      imports: [BodyDiagramComponent],
      providers: [{ provide: BodyStatusService, useValue: svcMock }],
    }).compileComponents();

    fixture   = TestBed.createComponent(BodyDiagramComponent);
    component = fixture.componentInstance;
    if (preSelectedStatusId) component.preSelectedStatusId = preSelectedStatusId;
    fixture.detectChanges(); // triggers ngOnInit
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Component creation ─────────────────────────────────────────────────────

  describe('creation', () => {
    it('creates successfully', async () => {
      await setup();
      expect(component).toBeTruthy();
    });

    it('loads activeStatuses from service on init', async () => {
      await setup();
      expect(component.activeStatuses).toHaveLength(2);
    });
  });

  // ── Filter tabs ────────────────────────────────────────────────────────────

  describe('filter tabs', () => {
    beforeEach(async () => setup());

    it('"all" is the default activeFilter', () => {
      expect(component.activeFilter).toBe('all');
    });

    it('changing activeFilter to "injury" is reflected in the property', () => {
      component.activeFilter = 'injury';
      expect(component.activeFilter).toBe('injury');
    });

    it('changing activeFilter to "illness" is reflected in the property', () => {
      component.activeFilter = 'illness';
      expect(component.activeFilter).toBe('illness');
    });

    it('changing activeFilter to "disease" is reflected in the property', () => {
      component.activeFilter = 'disease';
      expect(component.activeFilter).toBe('disease');
    });
  });

  // ── getFilteredStatuses() ──────────────────────────────────────────────────

  describe('getFilteredStatuses()', () => {
    beforeEach(async () => setup([MOCK_INJURY, MOCK_ILLNESS]));

    it('returns all active statuses when filter is "all"', () => {
      component.activeFilter = 'all';
      expect(component.getFilteredStatuses()).toHaveLength(2);
    });

    it('returns only injuries when filter is "injury"', () => {
      component.activeFilter = 'injury';
      const result = component.getFilteredStatuses();
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('injury');
    });

    it('returns only illnesses when filter is "illness"', () => {
      component.activeFilter = 'illness';
      const result = component.getFilteredStatuses();
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('illness');
    });

    it('returns empty array when filter is "disease" and no diseases present', () => {
      component.activeFilter = 'disease';
      expect(component.getFilteredStatuses()).toHaveLength(0);
    });

    it('returns all when filter reverts back to "all"', () => {
      component.activeFilter = 'injury';
      component.activeFilter = 'all';
      expect(component.getFilteredStatuses()).toHaveLength(2);
    });
  });

  // ── Retired SVG map ────────────────────────────────────────────────────────

  describe('retired SVG map', () => {
    beforeEach(async () => setup());

    it('does not render the flat body silhouette', () => {
      const host: HTMLElement = fixture.nativeElement;
      expect(host.querySelector('svg')).toBeNull();
      expect(host.textContent).not.toContain('TAP ZONE TO LOG');
    });

    it('keeps the Active Conditions list and points logging at the 3D character', () => {
      const host: HTMLElement = fixture.nativeElement;
      expect(host.textContent).toContain('ACTIVE CONDITIONS');
      expect(host.textContent).toContain('Tap a region on the 3D character');
    });
  });

  // ── Shared editor (replaces SVG zone taps) ─────────────────────────────────

  describe('condition management', () => {
    beforeEach(async () => setup([MOCK_INJURY]));

    it('+ ADD opens the shared modal without a pre-selected zone', () => {
      fixture.debugElement.query(By.css('.bs-add-btn')).triggerEventHandler('click', null);
      fixture.detectChanges();
      expect(component.statusModal?.visible).toBe(true);
      expect(component.statusModal?.editingStatus).toBeNull();
      expect(component.statusModal?.modalData.bodyPart).toBe('chest');
      expect(fixture.nativeElement.querySelector('.bs-modal-title').textContent).toContain('LOG CONDITION');
    });

    it('Edit opens the same modal populated from the condition', () => {
      fixture.debugElement.query(By.css('.bs-act-edit')).triggerEventHandler('click', null);
      fixture.detectChanges();
      expect(component.statusModal?.editingStatus?.id).toBe('inj-1');
      expect(component.statusModal?.modalData.bodyPart).toBe('left-knee');
      expect(component.statusModal?.modalData.name).toBe('Sprain');
      expect(fixture.nativeElement.querySelector('.bs-modal-title').textContent).toContain('EDIT CONDITION');
    });

    it('Healed asks for confirmation and marks the status healed', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      fixture.debugElement.query(By.css('.bs-act-heal')).triggerEventHandler('click', null);
      expect(svcMock.markHealed).toHaveBeenCalledWith('inj-1');
    });

    it('Healed does nothing when confirmation is declined', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      fixture.debugElement.query(By.css('.bs-act-heal')).triggerEventHandler('click', null);
      expect(svcMock.markHealed).not.toHaveBeenCalled();
    });

    it('Remove asks for confirmation and deletes the status', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      fixture.debugElement.query(By.css('.bs-act-remove')).triggerEventHandler('click', null);
      expect(svcMock.removeStatus).toHaveBeenCalledWith('inj-1');
    });
  });

  // ── Marker pre-selection ───────────────────────────────────────────────────

  describe('preSelectedStatusId', () => {
    it('highlights the status passed in on init', async () => {
      await setup([MOCK_INJURY, MOCK_ILLNESS], 'ill-1');
      expect(component.selectedStatus?.id).toBe('ill-1');
    });

    it('re-selects and clears a hiding filter when a later marker click arrives', async () => {
      await setup([MOCK_INJURY, MOCK_ILLNESS]);
      component.activeFilter = 'injury';
      component.preSelectedStatusId = 'ill-1';
      component.ngOnChanges({
        preSelectedStatusId: new SimpleChange(null, 'ill-1', false),
      });
      expect(component.activeFilter).toBe('all');
      expect(component.selectedStatus?.id).toBe('ill-1');
    });
  });

  // ── Summary ────────────────────────────────────────────────────────────────

  describe('summary', () => {
    it('reflects the type counts from the service getSummary()', async () => {
      await setup([MOCK_INJURY, MOCK_ILLNESS]);
      expect(component.summary.injuries).toBe(1);
      expect(component.summary.illnesses).toBe(1);
      expect(component.summary.diseases).toBe(0);
    });

    it('reports critical count correctly', async () => {
      await setup([MOCK_CRITICAL_INJURY]);
      expect(component.summary.critical).toBe(1);
    });
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────

  describe('ngOnDestroy()', () => {
    it('unsubscribes from the service observable without error', async () => {
      await setup();
      expect(() => component.ngOnDestroy()).not.toThrow();
    });
  });
});
