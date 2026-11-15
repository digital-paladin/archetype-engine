import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WearableConnectService } from './wearable-connect.service';
import { environment } from '../environments/environment';

const STATUS_URL = `${environment.apiUrl}/api/wearables/status`;

describe('WearableConnectService', () => {
  let service: WearableConnectService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WearableConnectService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('maps wearable status onto the provider registry', () => {
    let rows: { id: string; configured: boolean | null; connected: boolean | null; connectPath: string }[] = [];
    service.status().subscribe((value) => {
      rows = value;
    });
    const req = httpMock.expectOne(STATUS_URL);
    expect(req.request.method).toBe('GET');
    req.flush({
      success: true,
      providers: {
        oura: { configured: true, connected: false, connectPath: '/api/oura/connect-url' },
        google: { configured: true, connected: true, connectPath: '/api/google-health/connect-url' },
        fitbit: { configured: false, connected: false, connectPath: '/api/fitbit/auth', legacy: true },
        garmin: { configured: false, connected: false, stub: true },
      },
    });
    expect(rows.map((row) => row.id)).toEqual(['oura', 'google', 'fitbit']);
    expect(rows[1]).toEqual({
      id: 'google',
      configured: true,
      connected: true,
      connectPath: '/api/google-health/connect-url',
    });
    expect(rows[2].configured).toBe(false);
  });

  it('treats a missing provider as status unavailable', () => {
    let connected: boolean | null = true;
    let configured: boolean | null = true;
    service.status().subscribe((rows) => {
      const fitbit = rows.find((row) => row.id === 'fitbit');
      connected = fitbit?.connected ?? null;
      configured = fitbit?.configured ?? null;
    });
    httpMock.expectOne(STATUS_URL).flush({ success: true, providers: {} });
    expect(configured).toBeNull();
    expect(connected).toBeNull();
  });

  it('navigates to the authorize URL from a connect-url provider', () => {
    const nav = vi.spyOn(service, 'openAuthorizeUrl').mockImplementation(() => {});
    let completed = false;
    service.connect('google').subscribe({ complete: () => { completed = true; } });
    const req = httpMock.expectOne(`${environment.apiUrl}/api/google-health/connect-url`);
    expect(req.request.method).toBe('GET');
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=user';
    req.flush({ success: true, url });
    expect(nav).toHaveBeenCalledWith(url);
    expect(completed).toBe(true);
  });

  it('reports an Oura connect-url failure without navigating', () => {
    const nav = vi.spyOn(service, 'openAuthorizeUrl').mockImplementation(() => {});
    let message = '';
    service.connect('oura').subscribe({ error: (err: Error) => { message = err.message; } });
    httpMock.expectOne(`${environment.apiUrl}/api/oura/connect-url`).flush({
      success: false,
      error: 'Oura not configured. Set OURA_CLIENT_ID and OURA_CLIENT_SECRET.',
    });
    expect(message).toContain('OURA_CLIENT_ID');
    expect(nav).not.toHaveBeenCalled();
  });

  it('surfaces the server error when connect-url fails', () => {
    const nav = vi.spyOn(service, 'openAuthorizeUrl').mockImplementation(() => {});
    let message = '';
    service.connect('google').subscribe({ error: (err: Error) => { message = err.message; } });
    httpMock.expectOne(`${environment.apiUrl}/api/google-health/connect-url`).flush(
      { success: false, error: 'Google Health not configured. Set GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET.' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    expect(message).toContain('GOOGLE_HEALTH_CLIENT_ID');
    expect(nav).not.toHaveBeenCalled();
  });

  it('redirects legacy Fitbit to /api/fitbit/auth without a JSON connect call', () => {
    const nav = vi.spyOn(service, 'openAuthorizeUrl').mockImplementation(() => {});
    let completed = false;
    service.connect('fitbit').subscribe({ complete: () => { completed = true; } });
    httpMock.expectNone(`${environment.apiUrl}/api/fitbit/auth`);
    expect(nav).toHaveBeenCalledWith(`${environment.apiUrl}/api/fitbit/auth`);
    expect(completed).toBe(true);
  });
});
