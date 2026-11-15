import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BodyStatusModalComponent } from './body-status-modal.component';
import { BodyStatusService } from './body-status.service';
import { BODY_PART_OPTIONS, BodyStatus } from './body-status.interface';

function buildStatus(overrides: Partial<BodyStatus> = {}): BodyStatus {
  return {
    id: 'status-1',
    bodyPart: 'left-knee',
    type: 'injury',
    severity: 'moderate',
    name: 'Sprain',
    description: 'Twisted on a run',
    startDate: new Date('2026-01-02'),
    estimatedRecoveryDays: 10,
    notes: 'Ice it',
    impactsActions: ['workout', 'coding'],
    xpPenalty: 15,
    color: '#ff6666',
    ...overrides,
  };
}

describe('BodyStatusModalComponent', () => {
  let fixture: ComponentFixture<BodyStatusModalComponent>;
  let component: BodyStatusModalComponent;
  let svc: { addStatus: ReturnType<typeof vi.fn>; updateStatus: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = { addStatus: vi.fn(), updateStatus: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [BodyStatusModalComponent],
      providers: [{ provide: BodyStatusService, useValue: svc }],
    }).compileComponents();
    fixture = TestBed.createComponent(BodyStatusModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('offers every body part, including the feet', () => {
    expect(component.availableBodyParts).toHaveLength(26);
    const values = component.availableBodyParts.map(part => part.value);
    expect(values).toEqual(BODY_PART_OPTIONS.map(part => part.value));
    expect(values).toContain('left-foot');
    expect(values).toContain('right-foot');
  });

  it('openCreate pre-fills the tapped body part and confirm logs it', () => {
    component.openCreate('right-foot');

    expect(component.visible).toBe(true);
    expect(component.modalData.bodyPart).toBe('right-foot');

    component.modalData.name = 'Blister';
    component.modalData.description = 'From the hike';
    component.modalData.impactsActionsStr = 'workout, hiking';
    component.modalData.xpPenalty = 10;
    component.confirm();

    expect(svc.addStatus).toHaveBeenCalledWith(
      'right-foot',
      'injury',
      'minor',
      'Blister',
      'From the hike',
      undefined,
      undefined,
      ['workout', 'hiking'],
      10,
    );
    expect(component.visible).toBe(false);
  });

  it('refuses to save when name or description is missing', () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    component.openCreate('left-foot');
    component.modalData.name = 'Blister';
    component.confirm();
    expect(svc.addStatus).not.toHaveBeenCalled();
    expect(component.visible).toBe(true);
  });

  it('openEdit round-trips the condition through updateStatus', () => {
    const status = buildStatus();
    component.openEdit(status);

    expect(component.editingStatus?.id).toBe('status-1');
    expect(component.modalData.bodyPart).toBe('left-knee');
    expect(component.modalData.impactsActionsStr).toBe('workout, coding');
    expect(component.modalData.notes).toBe('Ice it');

    component.modalData.severity = 'severe';
    component.confirm();

    expect(svc.updateStatus).toHaveBeenCalledWith('status-1', expect.objectContaining({
      bodyPart: 'left-knee',
      severity: 'severe',
      name: 'Sprain',
      estimatedRecoveryDays: 10,
      notes: 'Ice it',
      impactsActions: ['workout', 'coding'],
      xpPenalty: 15,
    }));
    expect(component.visible).toBe(false);
  });
});
