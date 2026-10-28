import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { IntegrationsPanelComponent } from './integrations-panel.component';
import { WearableConnectService } from './wearable-connect.service';
import { environment } from '../environments/environment';

const CONNECT_URL = `${environment.apiUrl}/api/todoist/connect`;
const WEARABLES_STATUS_URL = `${environment.apiUrl}/api/wearables/status`;
const FULL_KEY = 'abcdefghijklmnopqrstuvwxyz1234567890abcd';

function wearablesStatus(overrides: Record<string, Record<string, unknown>> = {}) {
  return {
    success: true,
    providers: {
      oura: { configured: true, connected: false, connectPath: '/api/oura/connect-url' },
      google: { configured: true, connected: false, connectPath: '/api/google-health/connect-url' },
      fitbit: { configured: true, connected: false, connectPath: '/api/fitbit/auth', legacy: true },
      ...overrides,
    },
  };
}

describe('IntegrationsPanelComponent', () => {
  let fixture: ComponentFixture<IntegrationsPanelComponent>;
  let component: IntegrationsPanelComponent;
  let httpMock: HttpTestingController;

  function flushLoads(opts?: {
    todoist?: Record<string, unknown>;
    providers?: Record<string, Record<string, unknown>>;
  }): void {
    httpMock.expectOne(CONNECT_URL).flush(opts?.todoist ?? {
      success: true,
      connected: false,
      source: null,
      masked: null,
    });
    httpMock.expectOne(WEARABLES_STATUS_URL).flush(wearablesStatus(opts?.providers));
  }

  function section(id: string): HTMLElement {
    const el = fixture.nativeElement.querySelector(`#wearable-${id}`);
    expect(el).toBeTruthy();
    return el as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IntegrationsPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(IntegrationsPanelComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('shows Connect when disconnected', () => {
    fixture.detectChanges();
    flushLoads();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Connect');
    expect(el.querySelector('#todoist-api-key')).toBeTruthy();
  });

  it('shows a masked key and never the full token when connected', () => {
    fixture.detectChanges();
    flushLoads({
      todoist: {
        success: true,
        connected: true,
        source: 'user',
        masked: '****abcd',
      },
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('****abcd');
    expect(el.textContent).not.toContain(FULL_KEY);
    expect(el.textContent).toContain('Disconnect');
  });

  it('Disconnect issues DELETE and returns to disconnected', () => {
    fixture.detectChanges();
    flushLoads({
      todoist: {
        success: true,
        connected: true,
        source: 'user',
        masked: '****abcd',
      },
    });
    fixture.detectChanges();
    const disconnect = [...fixture.nativeElement.querySelectorAll('button')].find((btn) =>
      (btn as HTMLButtonElement).textContent?.includes('Disconnect'),
    ) as HTMLButtonElement;
    disconnect.click();
    const del = httpMock.expectOne(CONNECT_URL);
    expect(del.request.method).toBe('DELETE');
    del.flush({ success: true, connected: false, source: null, masked: null });
    fixture.detectChanges();
    expect(component.connected()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Connect');
  });

  it('failed connect shows an error and stays disconnected', () => {
    fixture.detectChanges();
    flushLoads();
    fixture.detectChanges();
    component.apiKey = FULL_KEY;
    component.connect();
    const post = httpMock.expectOne(CONNECT_URL);
    expect(post.request.method).toBe('POST');
    post.flush({ success: false, error: 'apiKey is required (20–128 characters)' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(component.connected()).toBe(false);
    expect(component.error()).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain(FULL_KEY);
  });

  it('lists Oura, Fitbit / Pixel Watch, and legacy Fitbit with connection status', () => {
    fixture.detectChanges();
    flushLoads({
      providers: {
        oura: { configured: true, connected: false, connectPath: '/api/oura/connect-url' },
        google: { configured: true, connected: true, connectPath: '/api/google-health/connect-url' },
        fitbit: { configured: false, connected: false, connectPath: '/api/fitbit/auth', legacy: true },
      },
    });
    fixture.detectChanges();

    const oura = section('oura');
    const google = section('google');
    const fitbit = section('fitbit');

    expect(oura.textContent).toContain('Oura');
    expect(oura.querySelector('.status-row')?.textContent).toContain('Not connected');
    expect(oura.querySelector('#wearable-oura-connect')?.textContent).toContain('Connect');

    expect(google.textContent).toContain('Fitbit / Pixel Watch');
    expect(google.querySelector('.status-row')?.textContent).toContain('Connected');
    expect(google.querySelector('#wearable-google-connect')?.textContent).toContain('Reconnect');

    expect(fitbit.textContent).toContain('Fitbit Web API (legacy)');
    expect(fitbit.querySelector('.status-row')?.textContent).toContain('Not configured');
    expect(fitbit.querySelector('#wearable-fitbit-connect')?.textContent).toContain('Connect');
  });

  it('Connect starts the shared Oura and Google Health OAuth flows', () => {
    fixture.detectChanges();
    flushLoads({
      providers: {
        google: { configured: true, connected: true, connectPath: '/api/google-health/connect-url' },
      },
    });
    fixture.detectChanges();
    const service = TestBed.inject(WearableConnectService);
    const nav = vi.spyOn(service, 'openAuthorizeUrl').mockImplementation(() => {});

    fixture.nativeElement.querySelector('#wearable-oura-connect').click();
    const oura = httpMock.expectOne(`${environment.apiUrl}/api/oura/connect-url`);
    expect(oura.request.method).toBe('GET');
    oura.flush({ success: true, url: 'https://cloud.ouraring.com/oauth/authorize?state=user' });

    fixture.nativeElement.querySelector('#wearable-google-connect').click();
    const google = httpMock.expectOne(`${environment.apiUrl}/api/google-health/connect-url`);
    expect(google.request.method).toBe('GET');
    google.flush({ success: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?state=user' });

    expect(nav).toHaveBeenNthCalledWith(1, 'https://cloud.ouraring.com/oauth/authorize?state=user');
    expect(nav).toHaveBeenNthCalledWith(2, 'https://accounts.google.com/o/oauth2/v2/auth?state=user');
  });

  it('legacy Fitbit Connect navigates to the existing auth route', () => {
    fixture.detectChanges();
    flushLoads();
    fixture.detectChanges();
    const service = TestBed.inject(WearableConnectService);
    const nav = vi.spyOn(service, 'openAuthorizeUrl').mockImplementation(() => {});

    fixture.nativeElement.querySelector('#wearable-fitbit-connect').click();
    httpMock.expectNone(`${environment.apiUrl}/api/fitbit/auth`);
    expect(nav).toHaveBeenCalledWith(`${environment.apiUrl}/api/fitbit/auth`);
  });

  it('shows the connect error and does not navigate when OAuth cannot start', () => {
    fixture.detectChanges();
    flushLoads();
    fixture.detectChanges();
    const service = TestBed.inject(WearableConnectService);
    const nav = vi.spyOn(service, 'openAuthorizeUrl').mockImplementation(() => {});

    fixture.nativeElement.querySelector('#wearable-google-connect').click();
    httpMock.expectOne(`${environment.apiUrl}/api/google-health/connect-url`).flush(
      { success: false, error: 'Google Health not configured. Set GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET.' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    fixture.detectChanges();

    expect(nav).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#wearable-google-error')?.textContent).toContain('not configured');
    expect(component.wearableRows().find((row) => row.id === 'google')?.connected).toBe(false);
  });

  it('keeps Connect available when wearable status cannot be loaded', () => {
    fixture.detectChanges();
    httpMock.expectOne(CONNECT_URL).flush({
      success: true,
      connected: false,
      source: null,
      masked: null,
    });
    httpMock.expectOne(WEARABLES_STATUS_URL).flush(
      { success: false, error: 'Requires Paladin tier or higher' },
      { status: 403, statusText: 'Forbidden' },
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Requires Paladin tier or higher');
    expect(section('oura').querySelector('.status-row')?.textContent).toContain('Status unavailable');
    expect(section('google').querySelector('#wearable-google-connect')?.textContent).toContain('Connect');
    expect(section('fitbit').querySelector('#wearable-fitbit-connect')).toBeTruthy();
  });
});
