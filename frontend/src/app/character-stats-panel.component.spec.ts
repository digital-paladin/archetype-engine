// character-stats-panel.component.spec.ts
// Empty rpgStats {} from /api/character/stats must not freeze "Loading character data..."

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CharacterStatsPanelComponent } from './character-stats-panel.component';
import { environment } from '../environments/environment';

const STATS_URL = `${environment.apiUrl}/api/character/stats`;

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
    fixture.detectChanges();
    httpMock.expectOne(STATS_URL).flush({
      sageStreak: 689,
      rpgStats: {},
      skillTrees: [{ id: 'sage', name: 'Sage', level: 26, currentXP: 1, xpToNextLevel: 2, percentToNext: 50, tier: 'Master' }],
    });
    expect(component.isLoading()).toBe(false);
    expect(component.lifts()).toEqual([]);
    expect(component.classes()).toHaveLength(1);
  });

  it('skips incomplete lifts instead of throwing', () => {
    fixture.detectChanges();
    httpMock.expectOne(STATS_URL).flush({
      sageStreak: 1,
      rpgStats: { squat: { value: '315 lbs' } },
      skillTrees: [],
    });
    expect(component.isLoading()).toBe(false);
    expect(component.lifts()).toEqual([{ name: 'Squat', value: '315 lbs', target: undefined }]);
  });

  it('populates all four lifts when present', () => {
    fixture.detectChanges();
    httpMock.expectOne(STATS_URL).flush({
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
    expect(component.isLoading()).toBe(false);
  });
});
