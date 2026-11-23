import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OBJECTIVES_COLLAPSED_KEY } from './objectives-tracker';
import { ObjectivesTrackerComponent } from './objectives-tracker.component';
import { chicagoDate } from './quest-progress';
import { SystemQuest, SystemQuestService } from './system-quest.service';

function quest(partial: Partial<SystemQuest> & Pick<SystemQuest, 'id' | 'title' | 'kind'>): SystemQuest {
  return {
    status: 'active',
    hidden: false,
    revealed: true,
    source: 'user',
    createdAt: '2026-11-23T00:00:00.000Z',
    deadline: null,
    scheduledFor: chicagoDate(),
    description: null,
    objectives: [{ id: 'step', label: 'Sample step', target: 1, progress: 0, done: false }],
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
    ...partial,
  };
}

describe('ObjectivesTrackerComponent', () => {
  let fixture: ComponentFixture<ObjectivesTrackerComponent>;
  const quests = signal<SystemQuest[]>([]);

  beforeEach(async () => {
    localStorage.removeItem(OBJECTIVES_COLLAPSED_KEY);
    quests.set([
      quest({ id: 'daily-ready', kind: 'daily', title: 'Sample stretch', objectives: [
        { id: 'hold', label: 'Hold the pose', target: 1, progress: 1, done: true },
      ] }),
      quest({ id: 'daily-open', kind: 'daily', title: 'Sample spiders', objectives: [
        { id: 'spiders', label: 'Sample spiders', target: 10, progress: 0, done: false },
      ] }),
      ...Array.from({ length: 4 }, (_, index) => quest({
        id: `daily-extra-${index}`,
        kind: 'daily',
        title: `Sample errand ${index}`,
      })),
      quest({
        id: 'weekly-1',
        kind: 'weekly',
        title: 'Sample week of walks',
        scheduledFor: null,
        objectives: [{ id: 'walks', label: 'Walks logged', target: 5, progress: 2, done: false }],
      }),
      quest({
        id: 'boss-1',
        kind: 'acquisition',
        title: 'BOSS: Sample Contract',
        scheduledFor: null,
        objectives: [
          { id: 'one', label: 'Draft the sample', target: 1, progress: 1, done: true },
          { id: 'two', label: 'Ship the sample', target: 1, progress: 0, done: false },
        ],
      }),
    ]);

    await TestBed.configureTestingModule({
      imports: [ObjectivesTrackerComponent],
      providers: [{ provide: SystemQuestService, useValue: { quests } }],
    }).compileComponents();

    fixture = TestBed.createComponent(ObjectivesTrackerComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem(OBJECTIVES_COLLAPSED_KEY);
  });

  it('lists grouped quests, a turn-in marker, and a five-quest cap', () => {
    const root: HTMLElement = fixture.nativeElement;
    const names = [...root.querySelectorAll('[data-testid="objective-quest"] .obj-name')].map(node => node.textContent?.trim());
    expect(names).toEqual([
      'Sample stretch',
      'Sample spiders',
      'Sample errand 0',
      'Sample errand 1',
      'Sample errand 2',
    ]);
    expect(root.textContent).toContain('0/10 Sample spiders');
    expect(root.textContent).toContain('1/1 Hold the pose');
    const marker = root.querySelector('[data-testid="objectives-turn-in"]');
    expect(marker?.textContent?.trim()).toBe('?');
    expect(marker?.getAttribute('aria-label')).toBe('awaiting confirmation');
    expect(marker?.getAttribute('title')).toBe('awaiting confirmation');
    const more = root.querySelector('[data-testid="objectives-more"]');
    expect(more?.textContent?.trim()).toBe('+3 more');
    expect(more?.getAttribute('aria-label')).toBe('Show 3 more objectives');

    const toggles = [...root.querySelectorAll('.obj-group-toggle')];
    expect(toggles.map(button => button.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '▾ Dailies',
      '▾ Weekly',
      '▾ Boss',
    ]);
    toggles.forEach(button => {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('aria-expanded')).toBe('true');
    });
  });

  it('expands the rest of the list from the keyboard control', () => {
    const more: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="objectives-more"]');
    more.click();
    fixture.detectChanges();
    const names = [...fixture.nativeElement.querySelectorAll('[data-testid="objective-quest"] .obj-name')]
      .map(node => node.textContent?.trim());
    expect(names).toContain('Sample week of walks');
    expect(names).toContain('BOSS: Sample Contract');
    expect(fixture.nativeElement.textContent).toContain('2/5 Walks logged');
    expect(fixture.nativeElement.querySelector('[data-testid="objectives-more"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="objectives-less"]')).toBeTruthy();
  });

  it('collapses a group from the keyboard and remembers it locally', () => {
    const weeklyButton = () => [...fixture.nativeElement.querySelectorAll('.obj-group-toggle')]
      .find(button => button.textContent?.includes('Weekly')) as HTMLButtonElement;
    weeklyButton().click();
    fixture.detectChanges();
    expect(weeklyButton().getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem(OBJECTIVES_COLLAPSED_KEY) ?? '[]')).toEqual(['weekly']);

    fixture.destroy();
    fixture = TestBed.createComponent(ObjectivesTrackerComponent);
    fixture.detectChanges();
    const restored: HTMLButtonElement = [...fixture.nativeElement.querySelectorAll('.obj-group-toggle')]
      .find(button => button.textContent?.includes('Weekly')) as HTMLButtonElement;
    expect(restored.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.textContent).not.toContain('Sample week of walks');
  });

  it('hides live counters until food and status readings exist', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="objectives-live"]')).toBeNull();

    fixture.componentRef.setInput('food', {
      entries: [],
      totals: { calories: 0, protein: 12, carbs: 0, fat: 0, fiber: 0, water: 0 },
      goalCalories: 0,
    });
    fixture.componentRef.setInput('vitals', { weight: 50 });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="objectives-live"]')?.textContent).toContain('Protein 12 / 32 g');
    expect(fixture.nativeElement.textContent).not.toContain('Water');

    fixture.componentRef.setInput('vitals', { weight: 50, waterOz: 7 });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="objectives-live"]')?.textContent).toContain('Water 7 / 100 oz');
  });
});
