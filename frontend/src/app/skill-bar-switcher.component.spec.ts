import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { SkillBarSwitcherComponent } from './skill-bar-switcher.component';
import { HotbarSessionService } from './hotbar-session.service';
import { SkillUnlockService } from './skill-unlock.service';
import { WillpowerService } from './willpower.service';
import { SKILL_BARS, SKILL_MAP } from './skill-tree.data';

describe('SkillBarSwitcherComponent session count badge', () => {
  const skillId = SKILL_BARS[0].skills[0];
  const skill = SKILL_MAP.get(skillId)!;

  async function setup(count: number): Promise<{
    fixture: ComponentFixture<SkillBarSwitcherComponent>;
    getCount: ReturnType<typeof vi.fn>;
  }> {
    const getCount = vi.fn().mockReturnValue(count);
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [SkillBarSwitcherComponent],
      providers: [
        { provide: HotbarSessionService, useValue: { getCount } },
        { provide: SkillUnlockService, useValue: { isUnlocked: () => true } },
        { provide: WillpowerService, useValue: { willpower: () => 100 } },
        { provide: HttpClient, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SkillBarSwitcherComponent);
    fixture.detectChanges();
    return { fixture, getCount };
  }

  it('returns 0 and renders no badge when the session count is 0', async () => {
    const { fixture, getCount } = await setup(0);
    const view = fixture.componentInstance as unknown as {
      sessionCount(id: string): number;
    };
    expect(view.sessionCount(skillId)).toBe(0);
    expect(view.sessionCount('missing-skill')).toBe(0);
    expect(getCount).toHaveBeenCalledWith(skillId, skill.category);
    expect(fixture.nativeElement.querySelector('.slot-count-badge')).toBeNull();
  });

  it('renders a times badge when the session count is 8', async () => {
    const { fixture } = await setup(8);
    const badge = fixture.nativeElement.querySelector('.slot-count-badge') as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('\u00d7');
    expect(badge.textContent).toContain('8');
  });
});
