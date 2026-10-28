import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SleepPanelComponent } from './sleep-panel.component';
import { WearableConnectService } from './wearable-connect.service';
import { environment } from '../environments/environment';

describe('SleepPanelComponent wearable links', () => {
  let fixture: ComponentFixture<SleepPanelComponent>;
  const connect = vi.fn(() => of(undefined));

  beforeEach(async () => {
    connect.mockClear();
    await TestBed.configureTestingModule({
      imports: [SleepPanelComponent],
      providers: [
        { provide: WearableConnectService, useValue: { connect } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SleepPanelComponent);
  });

  it('empty state starts the shared OAuth flow for Oura and Google Health', () => {
    fixture.detectChanges();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    const oura = buttons.find((el) => el.textContent?.includes('Authorize Oura'));
    const google = buttons.find((el) => el.textContent?.includes('Google Health'));

    expect(oura).toBeTruthy();
    expect(google).toBeTruthy();
    oura?.click();
    google?.click();
    expect(connect).toHaveBeenNthCalledWith(1, 'oura');
    expect(connect).toHaveBeenNthCalledWith(2, 'google');
  });

  it('keeps the legacy Fitbit link pointed at the Fitbit auth route', () => {
    fixture.detectChanges();
    const link = [...fixture.nativeElement.querySelectorAll('a')].find((el) =>
      (el as HTMLAnchorElement).textContent?.includes('Fitbit Web API'),
    ) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`${environment.apiUrl}/api/fitbit/auth`);
  });
});
