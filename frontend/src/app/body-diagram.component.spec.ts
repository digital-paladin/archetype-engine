// body-diagram.component.spec.ts
// Unit tests for BodyDiagramComponent — filter tabs, getFilteredStatuses(),
// getZoneFill(), getZoneStroke(), hasStatus(), trackByBodyPart().

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, BehaviorSubject } from 'rxjs';
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

const MOCK_SEVERE_INJURY: BodyStatus = {
  id: 'inj-sev', bodyPart: 'left-knee', type: 'injury', severity: 'severe',
  name: 'Torn Ligament', description: 'ACL tear', startDate: new Date(), color: '#ff3333',
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('BodyDiagramComponent', () => {
  let fixture: ComponentFixture<BodyDiagramComponent>;
  let component: BodyDiagramComponent;
  let svcMock: ReturnType<typeof buildMockService>;

  async function setup(active: BodyStatus[] = [MOCK_INJURY, MOCK_ILLNESS]) {
    TestBed.resetTestingModule();
    svcMock = buildMockService(active);

    await TestBed.configureTestingModule({
      imports: [BodyDiagramComponent],
      providers: [{ provide: BodyStatusService, useValue: svcMock }],
    }).compileComponents();

    fixture   = TestBed.createComponent(BodyDiagramComponent);
    component = fixture.componentInstance;
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

  // ── getZoneFill() ──────────────────────────────────────────────────────────

  describe('getZoneFill()', () => {
    beforeEach(async () => setup([MOCK_INJURY]));

    it('returns default transparent fill when bodyPart has no status', () => {
      expect(component.getZoneFill('head')).toBe('rgba(201,168,76,0.12)');
    });

    it('returns minor fill color for a minor status', async () => {
      await setup([{ ...MOCK_INJURY, bodyPart: 'head', severity: 'minor' }]);
      expect(component.getZoneFill('head')).toBe('rgba(230,168,51,0.55)');
    });

    it('returns moderate fill color', async () => {
      await setup([MOCK_INJURY]); // severity: 'moderate', bodyPart: 'left-knee'
      expect(component.getZoneFill('left-knee')).toBe('rgba(242,140,40,0.65)');
    });

    it('returns severe fill color', async () => {
      await setup([MOCK_SEVERE_INJURY]);
      expect(component.getZoneFill('left-knee')).toBe('rgba(224,92,68,0.70)');
    });

    it('returns critical fill color', async () => {
      await setup([MOCK_CRITICAL_INJURY]);
      expect(component.getZoneFill('head')).toBe('rgba(204,0,0,0.80)');
    });

    it('uses the worst (highest) severity when multiple statuses on same bodyPart', async () => {
      await setup([MOCK_INJURY, MOCK_SEVERE_INJURY]); // both on left-knee
      // Should show severe, not moderate
      expect(component.getZoneFill('left-knee')).toBe('rgba(224,92,68,0.70)');
    });
  });

  // ── getZoneStroke() ────────────────────────────────────────────────────────

  describe('getZoneStroke()', () => {
    it('returns default stroke when bodyPart has no status', async () => {
      await setup([]);
      expect(component.getZoneStroke('head')).toBe('rgba(201,168,76,0.35)');
    });

    it('returns minor stroke color', async () => {
      await setup([{ ...MOCK_INJURY, bodyPart: 'head', severity: 'minor' }]);
      expect(component.getZoneStroke('head')).toBe('#e6a833');
    });

    it('returns moderate stroke color', async () => {
      await setup([MOCK_INJURY]);
      expect(component.getZoneStroke('left-knee')).toBe('#f28c28');
    });

    it('returns severe stroke color', async () => {
      await setup([MOCK_SEVERE_INJURY]);
      expect(component.getZoneStroke('left-knee')).toBe('#e05c44');
    });

    it('returns critical stroke color', async () => {
      await setup([MOCK_CRITICAL_INJURY]);
      expect(component.getZoneStroke('head')).toBe('#cc0000');
    });
  });

  // ── hasStatus() ────────────────────────────────────────────────────────────

  describe('hasStatus()', () => {
    beforeEach(async () => setup([MOCK_INJURY]));

    it('returns true when bodyPart has at least one status', () => {
      expect(component.hasStatus('left-knee')).toBe(true);
    });

    it('returns false when bodyPart has no status', () => {
      expect(component.hasStatus('head')).toBe(false);
    });
  });

  // ── trackByBodyPart() ──────────────────────────────────────────────────────

  describe('trackByBodyPart()', () => {
    it('returns the bodyPart string from the location object', async () => {
      await setup();
      const loc = { bodyPart: 'left-knee' as const, x: 44, y: 74, label: 'Left Knee' };
      expect(component.trackByBodyPart(0, loc)).toBe('left-knee');
    });
  });

  // ── bodyPartLocations ──────────────────────────────────────────────────────

  describe('bodyPartLocations', () => {
    it('contains 26 body part locations', async () => {
      await setup();
      expect(component.bodyPartLocations).toHaveLength(26);
    });

    it('includes expected zones: head, chest, left-knee, right-foot', async () => {
      await setup();
      const parts = component.bodyPartLocations.map(l => l.bodyPart);
      expect(parts).toContain('head');
      expect(parts).toContain('chest');
      expect(parts).toContain('left-knee');
      expect(parts).toContain('right-foot');
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
