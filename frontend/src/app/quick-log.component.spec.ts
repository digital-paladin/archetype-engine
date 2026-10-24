import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { QuickLogComponent } from './quick-log.component';
import { environment } from '../environments/environment';
import { toBackendActivityType } from './activity-type-map';

const CALC_URL = `${environment.apiUrl}/api/activities/calculate-xp`;
const LOG_URL = `${environment.apiUrl}/api/activities`;

describe('QuickLogComponent', () => {
  let fixture: ComponentFixture<QuickLogComponent>;
  let component: QuickLogComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuickLogComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(QuickLogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  function optionValues(): string[] {
    const options = fixture.nativeElement.querySelectorAll('option');
    return Array.from(options, (option) => (option as HTMLOptionElement).value);
  }

  it('lists the Recovery & Consistency quests', () => {
    const groups = fixture.nativeElement.querySelectorAll('optgroup');
    const labels = Array.from(groups, (group) => (group as HTMLOptGroupElement).label);
    expect(labels).toContain('Recovery & Consistency (Warrior)');
    expect(optionValues()).toEqual(expect.arrayContaining([
      'recovery-session-as-planned',
      'recovery-rest-day',
      'recovery-consistency-bonus',
      'recovery-xray-order',
      'recovery-xray-book',
      'recovery-xray-done',
      'recovery-xray-review',
    ]));
  });

  it('shows a claim date for recovery quests and keeps the preview flat', () => {
    fixture.componentRef.setInput('xpMultiplier', 1.5);
    component.activityType = 'recovery-xray-order';
    component.onActivityTypeChange();
    httpMock.expectOne(req => req.url.startsWith(CALC_URL)).flush({ xp: 40 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#claimDate')).toBeTruthy();
    expect(component.displayXp()).toBe(40);
    expect(fixture.nativeElement.textContent).not.toContain('Rested Bonus');
  });

  it('sends the claim date and not client XP, and shows a 409 reason', () => {
    component.activityType = 'recovery-rest-day';
    component.onActivityTypeChange();
    httpMock.expectOne(req => req.url.startsWith(CALC_URL)).flush({ xp: 20 });
    component.claimDate = '2026-10-22';

    component.logActivity();
    const post = httpMock.expectOne(LOG_URL);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({
      activityType: 'recovery-rest-day',
      duration: undefined,
      notes: undefined,
      clientDate: '2026-10-22',
    });
    post.flush(
      { error: 'Rest Day Kept only counts on Thursday' },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Rest Day Kept only counts on Thursday');
  });

  it('offers backend developer types and still accepts the old aliases', () => {
    expect(optionValues()).toEqual(expect.arrayContaining(['iq2-story', 'iq2-bug-fix']));
    expect(optionValues()).not.toContain('dev-story');
    expect(optionValues()).not.toContain('dev-bug-fix');

    for (const value of optionValues()) {
      if (!value) continue;
      expect(toBackendActivityType(value)).toBe(value);
    }

    component.activityType = 'dev-story';
    component.logActivity();
    const story = httpMock.expectOne(LOG_URL);
    expect(story.request.body.activityType).toBe('iq2-story');
    story.flush({ success: true, xp: 20, message: 'Activity logged successfully! +20 XP' });

    component.activityType = 'dev-bug-fix';
    component.logActivity();
    const bug = httpMock.expectOne(LOG_URL);
    expect(bug.request.body.activityType).toBe('iq2-bug-fix');
    bug.flush({ success: true, xp: 15, message: 'Activity logged successfully! +15 XP' });
  });

  it('still sends multiplied XP for an ordinary activity', () => {
    fixture.componentRef.setInput('xpMultiplier', 1.5);
    component.activityType = 'workout-strength';
    component.onActivityTypeChange();
    httpMock.expectOne(req => req.url.startsWith(CALC_URL)).flush({ xp: 20 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#claimDate')).toBeNull();
    expect(component.displayXp()).toBe(30);

    component.logActivity();
    const post = httpMock.expectOne(LOG_URL);
    expect(post.request.body.xp).toBe(30);
    expect(post.request.body.clientDate).toBeUndefined();
    post.flush({ success: true, xp: 30, message: 'Activity logged successfully! +30 XP' });
  });
});
