import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivitySessionPanelComponent } from './activity-session-panel.component';
import { ActionTrackerService } from './action-tracker.service';
import { environment } from '../environments/environment';

const LOG_URL = `${environment.apiUrl}/api/activities`;

describe('ActivitySessionPanelComponent journal post', () => {
  let http: HttpTestingController;
  let tracker: ActionTrackerService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [ActivitySessionPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    tracker = TestBed.inject(ActionTrackerService);
  });

  afterEach(() => {
    tracker.cancelAction();
    vi.useRealTimers();
    http.verify();
  });

  function panel(): ActivitySessionPanelComponent {
    const fixture = TestBed.createComponent(ActivitySessionPanelComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('posts a coding session once, and completeAction does not post the free-text label', () => {
    tracker.startAction('coding', 'coding-routine', 'Typing', 'Fix the login bug', 'routine', 'IQ-1');
    const component = panel();

    component.onComplete();
    component.onComplete();

    const posts = http.match(LOG_URL);
    expect(posts).toHaveLength(1);
    expect(posts[0].request.body.activityType).toBe('personal-project');
    expect(posts[0].request.body.activityType).not.toBe('Fix the login bug');
    posts[0].flush({ xp: 12, message: 'Activity logged successfully! +12 XP' });

    vi.advanceTimersByTime(1400);
    expect(http.match(LOG_URL)).toHaveLength(0);
    expect(component.currentAction()).toBeNull();
  });

  it('posts prayer-routine once instead of personal-project', () => {
    tracker.startAction('prayer', 'prayer-routine', 'Praying', 'Morning prayer');
    const component = panel();

    component.onComplete();
    const post = http.expectOne(LOG_URL);
    expect(post.request.body.activityType).toBe('prayer-routine');
    post.flush({ xp: 10, message: 'ok' });

    vi.advanceTimersByTime(1400);
    expect(http.match(LOG_URL)).toHaveLength(0);
  });

  it('does not post again when the journal write fails', () => {
    tracker.startAction('lab', 'htb-medium', 'Victory', 'Hack the box');
    const component = panel();

    component.onComplete();
    const post = http.expectOne(LOG_URL);
    expect(post.request.body.activityType).toBe('redteam-lab');
    post.flush({ message: 'Journal write failed' }, { status: 500, statusText: 'Server Error' });

    vi.advanceTimersByTime(2500);
    expect(http.match(LOG_URL)).toHaveLength(0);
    expect(component.currentAction()).toBeNull();
  });

  it('does not journal hydration', () => {
    tracker.startAction('water', 'hydration', 'Happy Idle', 'Drink water');
    const component = panel();

    component.onComplete();
    http.expectNone(LOG_URL);
    expect(component.currentAction()).toBeNull();
  });
});
