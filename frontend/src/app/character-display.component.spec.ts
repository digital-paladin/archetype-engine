// character-display.component.spec.ts
// Unit tests for the body-status marker overlay wiring (recomputeBodyStatusMarkers,
// onMarkerClick, subscription/frame-callback lifecycle). ngAfterViewInit needs a real
// canvas + WebGL context (not exercised here) — these tests instantiate the class
// directly with mocked dependencies and drive the private marker-recompute logic.

import { Subject } from 'rxjs';
import { CharacterDisplayComponent } from './character-display.component';
import { BodyStatus } from './body-status.interface';

function makeStatus(overrides: Partial<BodyStatus> = {}): BodyStatus {
  return {
    id: 'status-1',
    bodyPart: 'left-knee',
    type: 'injury',
    severity: 'moderate',
    name: 'Knee sprain',
    description: 'desc',
    startDate: new Date(),
    color: '#ff6666',
    ...overrides,
  };
}

function makeComponent() {
  const statuses$ = new Subject<BodyStatus[]>();
  let activeStatuses: BodyStatus[] = [];

  const threeServiceMock = {
    getBodyPartScreenPosition: vi.fn().mockReturnValue({ xPct: 40, yPct: 60 }),
    onFrame: vi.fn(),
    offFrame: vi.fn(),
  };
  const actionTrackerMock = {};
  const bodyStatusServiceMock = {
    getStatuses: () => statuses$.asObservable(),
    getActiveStatuses: () => activeStatuses,
  };

  const component = new CharacterDisplayComponent(
    threeServiceMock as any,
    actionTrackerMock as any,
    bodyStatusServiceMock as any,
  );

  return { component, threeServiceMock, statuses$, setActive: (s: BodyStatus[]) => { activeStatuses = s; } };
}

describe('CharacterDisplayComponent — body-status marker overlay', () => {
  it('emits bodyStatusMarkerClicked with the status id on marker click', () => {
    const { component } = makeComponent();
    const emitted: string[] = [];
    component.bodyStatusMarkerClicked.subscribe((id: string) => emitted.push(id));

    component.onMarkerClick({ id: 'abc-123' });

    expect(emitted).toEqual(['abc-123']);
  });

  it('subscribes to BodyStatusService on ngOnInit and populates activeBodyStatuses', () => {
    const { component, statuses$, setActive } = makeComponent();
    component.ngOnInit();

    setActive([makeStatus()]);
    statuses$.next([makeStatus()]);

    expect((component as any).activeBodyStatuses).toHaveLength(1);
  });

  it('recomputeBodyStatusMarkers() clears markers when there are no active statuses', () => {
    const { component } = makeComponent();
    (component as any).activeBodyStatuses = [];
    component.bodyStatusMarkers = [{ id: 'stale', xPct: 1, yPct: 1, color: '#fff', name: 'x', severity: 'minor' }];

    (component as any).recomputeBodyStatusMarkers();

    expect(component.bodyStatusMarkers).toEqual([]);
  });

  it('recomputeBodyStatusMarkers() projects each active status via ThreeCharacterService', () => {
    const { component, threeServiceMock } = makeComponent();
    (component as any).activeBodyStatuses = [
      makeStatus({ id: 'a', bodyPart: 'left-knee', color: '#ff6666', name: 'Knee sprain', severity: 'moderate' }),
    ];

    (component as any).recomputeBodyStatusMarkers();

    expect(threeServiceMock.getBodyPartScreenPosition).toHaveBeenCalledWith('left-knee');
    expect(component.bodyStatusMarkers).toEqual([
      { id: 'a', xPct: 40, yPct: 60, color: '#ff6666', name: 'Knee sprain', severity: 'moderate' },
    ]);
  });

  it('recomputeBodyStatusMarkers() skips a status whose bone cannot be projected', () => {
    const { component, threeServiceMock } = makeComponent();
    threeServiceMock.getBodyPartScreenPosition.mockReturnValueOnce(null);
    (component as any).activeBodyStatuses = [makeStatus()];

    (component as any).recomputeBodyStatusMarkers();

    expect(component.bodyStatusMarkers).toEqual([]);
  });

  it('ngOnDestroy unregisters the frame callback and unsubscribes', () => {
    const { component, threeServiceMock } = makeComponent();
    (component as any).threeService.dispose = vi.fn();
    (component as any).boundRecomputeMarkers = () => {};
    component.ngOnInit();

    const sub = (component as any).bodyStatusSubscription;
    const unsubSpy = vi.spyOn(sub, 'unsubscribe');

    component.ngOnDestroy();

    expect(threeServiceMock.offFrame).toHaveBeenCalled();
    expect(unsubSpy).toHaveBeenCalled();
  });
});
