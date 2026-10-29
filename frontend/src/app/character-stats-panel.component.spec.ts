// character-stats-panel.component.spec.ts
// Empty rpgStats {} from /api/character/stats must not freeze "Loading character data..."

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CharacterStatsPanelComponent } from './character-stats-panel.component';
import { environment } from '../environments/environment';

const STATS_URL = `${environment.apiUrl}/api/character/stats`;
const SCALE_URL = `${environment.apiUrl}/api/body-composition?limit=1`;

function flushSheet(
  fixture: ComponentFixture<CharacterStatsPanelComponent>,
  httpMock: HttpTestingController,
  stats: object,
  readings: object[] = [],
): void {
  fixture.detectChanges();
  httpMock.expectOne(STATS_URL).flush(stats);
  httpMock.expectOne(SCALE_URL).flush({ success: true, readings });
  fixture.detectChanges();
}

describe('CharacterStatsPanelComponent', () => {
  let fixture: ComponentFixture<CharacterStatsPanelComponent>;
  let component: CharacterStatsPanelComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CharacterStatsPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CharacterStatsPanelComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('isLoading starts true before any HTTP response', () => {
    expect(component.isLoading()).toBe(true);
  });

  it('clears the loader when rpgStats is an empty object', () => {
    flushSheet(fixture, httpMock, {
      sageStreak: 689,
      rpgStats: {},
      skillTrees: [{ id: 'sage', name: 'Sage', level: 26, currentXP: 1, xpToNextLevel: 2, percentToNext: 50, tier: 'Master' }],
    });
    expect(component.isLoading()).toBe(false);
    expect(component.lifts()).toEqual([]);
    expect(component.classes()).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[data-testid="body-composition"]')).toBeNull();
  });

  it('skips incomplete lifts instead of throwing', () => {
    flushSheet(fixture, httpMock, {
      sageStreak: 1,
      rpgStats: { squat: { value: '315 lbs' } },
      skillTrees: [],
    });
    expect(component.isLoading()).toBe(false);
    expect(component.lifts()).toEqual([{ name: 'Squat', value: '315 lbs', target: undefined }]);
  });

  it('populates all four lifts when present', () => {
    flushSheet(fixture, httpMock, {
      sageStreak: 1,
      rpgStats: {
        squat: { value: '315', target: '365' },
        deadlift: { value: '405' },
        benchPress: { value: '225' },
        overheadPress: { value: '135' },
      },
    });
    expect(component.lifts().map(l => l.name)).toEqual(['Squat', 'Deadlift', 'Bench Press', 'OH Press']);
  });

  it('sets isLoading to false on HTTP error', () => {
    fixture.detectChanges();
    httpMock.expectOne(STATS_URL).flush('error', { status: 500, statusText: 'Server Error' });
    httpMock.expectOne(SCALE_URL).flush({ success: true, readings: [] });
    expect(component.isLoading()).toBe(false);
  });

  it('shows the latest scale reading as stored and omits a missing weight', () => {
    flushSheet(fixture, httpMock, { sageStreak: 1, rpgStats: {}, skillTrees: [] }, [{
      source: 'hume',
      measuredAt: '2026-01-15T15:00:00.000Z',
      fasted: true,
      context: 'morning',
      notes: 'synthetic fixture',
      healthScore: 111,
      healthScoreLabel: 'Example Band',
      healthScoreConfidencePct: 42,
      biologicalAgeYears: 30,
      metabolicAgeYears: 28.5,
      bodyFatPct: 15.5,
      bodyWaterPct: 60,
      skeletalMuscleMassLb: 50.25,
      weightLb: null,
      bodyCompositionGrade: 'B',
      activityGrade: 'C',
      sleepGrade: 'A-',
      bodyFatLabel: 'Example High',
      bodyWaterLabel: 'Example Standard',
      skeletalMuscleMassLabel: 'Example Low',
      weightLabel: null,
      biologicalAgeLabel: null,
      metabolicAgeLabel: null,
    }]);

    const root: HTMLElement = fixture.nativeElement;
    const section = root.querySelector('[data-testid="body-composition"]');
    expect(section).toBeTruthy();
    expect(section!.querySelector('[data-testid="composition-when"]')?.getAttribute('data-measured-at'))
      .toBe('2026-01-15T15:00:00.000Z');
    expect(section!.textContent).toContain('hume');
    expect(section!.querySelector('[data-testid="composition-health-score"]')?.textContent)
      .toContain('111 · Example Band · 42%');
    expect(section!.querySelector('[data-testid="composition-body-fat"]')?.textContent)
      .toContain('15.5% · Example High');
    expect(section!.querySelector('[data-testid="composition-muscle"]')?.textContent)
      .toContain('50.25 lb');
    expect(section!.querySelector('[data-testid="composition-grades"]')?.textContent)
      .toContain('Body B · Activity C · Sleep A-');
    expect(section!.querySelector('[data-testid="composition-fasted"]')?.textContent).toContain('Yes');
    expect(section!.querySelector('[data-testid="composition-context"]')?.textContent).toContain('morning');
    expect(section!.querySelector('[data-testid="composition-weight"]')).toBeNull();
  });

  it('hides composition when the scale request fails', () => {
    fixture.detectChanges();
    httpMock.expectOne(STATS_URL).flush({ sageStreak: 1, rpgStats: {}, skillTrees: [] });
    httpMock.expectOne(SCALE_URL).flush('nope', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(component.isLoading()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="body-composition"]')).toBeNull();
  });
});
