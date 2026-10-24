import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HotbarSessionService } from './hotbar-session.service';
import { Skill, SkillCategory } from './skill-tree.data';
import { environment } from '../environments/environment';

const LOG_URL = `${environment.apiUrl}/api/activities`;

function skill(category: SkillCategory, name: string): Skill {
  return {
    id: name,
    name,
    icon: '',
    category,
    description: '',
    tier: 'basic',
    activityKey: 'ignored-by-hotbar',
    type: 'workout',
    animation: 'Push Up',
    intensity: 'routine',
    willpowerCost: 0,
    willpowerRegen: 0,
  };
}

describe('HotbarSessionService', () => {
  let service: HotbarSessionService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [HotbarSessionService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HotbarSessionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    service.ngOnDestroy();
    http.verify();
  });

  it('posts each hotbar category once to /api/activities with the backend type', () => {
    const cases: Array<[SkillCategory, string]> = [
      ['mma', 'workout-mma'],
      ['strength', 'workout-strength'],
      ['swimming', 'workout-cardio'],
      ['coding', 'personal-project'],
      ['redteam', 'redteam-lab'],
      ['guitar', 'art-music'],
      ['sage', 'prayer-routine'],
    ];

    for (const [category, activityType] of cases) {
      service.recordActivation(skill(category, category));
      service.commitAll();

      const posts = http.match(LOG_URL);
      expect(posts, category).toHaveLength(1);
      expect(posts[0].request.url).toBe(LOG_URL);
      expect(posts[0].request.body.activityType).toBe(activityType);
      expect(posts[0].request.body.notes).toContain(category);
      posts[0].flush({ success: true });

      service.commitAll();
      expect(http.match(LOG_URL)).toHaveLength(0);
    }
  });

  it('does not journal utility skills such as hydration', () => {
    service.recordActivation(skill('utility', 'Hydrate'));
    service.commitAll();
    http.expectNone(LOG_URL);
  });
});
