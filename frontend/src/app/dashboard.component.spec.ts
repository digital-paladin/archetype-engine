/**
 * The default Character tab hosts Quick Log. Heavy children are stubbed so this
 * checks the mount without starting the 3D scene or a socket.
 */
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { DashboardComponent } from './dashboard.component';
import { QuickLogComponent } from './quick-log.component';
import { SocketService } from './socket.service';
import { XpProjectionService } from './xp-projection.service';

@Component({ selector: 'app-character-display', standalone: true, template: '' })
class CharacterDisplayStub {
  @Input() characterLevel = 0;
  @Input() characterName = '';
  @Input() currentXP = 0;
  @Input() maxXP = 0;
  @Input() xpPercentage = 0;
  @Output() bodyStatusMarkerClicked = new EventEmitter<string>();
}

@Component({ selector: 'app-status-effects-panel', standalone: true, template: '' })
class StatusEffectsStub {
  @Input() compact = false;
}

@Component({ selector: 'app-character-stats-panel', standalone: true, template: '' })
class CharacterStatsStub {}

@Component({ selector: 'app-collections-panel', standalone: true, template: '' })
class CollectionsStub {}

@Component({ selector: 'app-skills-panel', standalone: true, template: '' })
class SkillsStub {}

@Component({ selector: 'app-body-diagram', standalone: true, template: '' })
class BodyDiagramStub {
  @Input() preSelectedStatusId: string | null = null;
}

@Component({ selector: 'app-sleep-panel', standalone: true, template: '' })
class SleepPanelStub {
  @Input() activities: unknown;
  @Input() vitals: unknown;
  @Input() sleepDebt: unknown;
  @Input() extensionStreak: unknown;
  @Input() extensionBonusPct: unknown;
  @Input() today: unknown;
  @Input() week: unknown;
  @Input() month: unknown;
}

@Component({ selector: 'app-acm-panel', standalone: true, template: '' })
class AcmStub {
  @Input() selectedDate = '';
}

@Component({ selector: 'app-food-log-panel', standalone: true, template: '' })
class FoodLogStub {
  @Input() food: unknown;
  @Input() vitals: unknown;
}

@Component({ selector: 'app-quests-panel', standalone: true, template: '' })
class QuestsStub {
  @Output() dateChanged = new EventEmitter<string>();
}

@Component({ selector: 'app-progression-analytics', standalone: true, template: '' })
class AnalyticsStub {}

@Component({ selector: 'app-vault-panel', standalone: true, template: '' })
class VaultStub {}

@Component({ selector: 'app-courage-panel', standalone: true, template: '' })
class CourageStub {}

@Component({ selector: 'app-rewards-catalog-panel', standalone: true, template: '' })
class RewardsStub {}

@Component({ selector: 'app-treasury-panel', standalone: true, template: '' })
class TreasuryStub {}

@Component({ selector: 'app-billing-panel', standalone: true, template: '' })
class BillingStub {}

@Component({ selector: 'app-integrations-panel', standalone: true, template: '' })
class IntegrationsStub {}

@Component({ selector: 'app-quest-lines-panel', standalone: true, template: '' })
class QuestLinesStub {}

@Component({ selector: 'app-inventory', standalone: true, template: '' })
class InventoryStub {}

@Component({ selector: 'app-crafting-station', standalone: true, template: '' })
class CraftingStub {}

@Component({ selector: 'app-todoist-panel', standalone: true, template: '' })
class TodoistStub {}

@Component({ selector: 'app-activity-session-panel', standalone: true, template: '' })
class ActivitySessionStub {}

@Component({ selector: 'app-ability-hotbar', standalone: true, template: '' })
class HotbarStub {}

@Component({ selector: 'app-loot-drop-overlay', standalone: true, template: '' })
class LootStub {}

const PANEL_STUBS = [
  CharacterDisplayStub, StatusEffectsStub, CharacterStatsStub, CollectionsStub, SkillsStub,
  BodyDiagramStub, SleepPanelStub, AcmStub, FoodLogStub, QuestsStub, AnalyticsStub,
  VaultStub, CourageStub, RewardsStub, TreasuryStub, BillingStub, IntegrationsStub,
  QuestLinesStub, InventoryStub, CraftingStub, TodoistStub, ActivitySessionStub,
  HotbarStub, LootStub,
];

describe('DashboardComponent Quick Log', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: SocketService, useValue: { onXpProjectionUpdate: () => EMPTY } },
        {
          provide: XpProjectionService,
          useValue: {
            getVitalityStatus: () => of({ current: null, status: '', sleepDebt: null, trend: '', flag: '' }),
            getProjections: () => of(null),
            getRecentGains: () => of([]),
            getQuestLog: () => of({ quests: [] }),
          },
        },
      ],
    })
      .overrideComponent(DashboardComponent, {
        set: { imports: [CommonModule, QuickLogComponent, ...PANEL_STUBS] },
      })
      .compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    httpMock.match(() => true).forEach(req => {
      // /api/quests/today is consumed as an array. Everything else tolerates a failed object.
      if (req.request.url.includes('/api/quests/')) req.flush([]);
      else req.flush({ success: false });
    });
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
  });

  it('shows Quick Log, including recovery quests, on the default Character tab', () => {
    const panel: HTMLElement | null = fixture.nativeElement.querySelector('#quick-log-panel');
    expect(panel).toBeTruthy();
    expect(panel!.querySelector('app-quick-log')).toBeTruthy();
    expect(panel!.textContent).toContain('Quick Log');
    expect(panel!.textContent).toContain('Rest Day Kept');
    expect(panel!.textContent).toContain('Session As Planned');
    expect(panel!.textContent).toContain('Foot X-ray (Case 2) 1/4');
  });

  it('hides Quick Log on other tabs and brings it back with Character', () => {
    fixture.componentInstance.setPanel('skills');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-quick-log')).toBeNull();

    fixture.componentInstance.setPanel('character');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#quick-log-panel app-quick-log')).toBeTruthy();
  });
});
