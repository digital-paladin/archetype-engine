import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { IntegrationsPanelComponent } from './integrations-panel.component';
import { environment } from '../environments/environment';

const CONNECT_URL = `${environment.apiUrl}/api/todoist/connect`;
const FULL_KEY = 'abcdefghijklmnopqrstuvwxyz1234567890abcd';

describe('IntegrationsPanelComponent', () => {
  let fixture: ComponentFixture<IntegrationsPanelComponent>;
  let component: IntegrationsPanelComponent;
  let httpMock: HttpTestingController;

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
    httpMock.expectOne(CONNECT_URL).flush({
      success: true,
      connected: false,
      source: null,
      masked: null,
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Connect');
    expect(el.querySelector('#todoist-api-key')).toBeTruthy();
  });

  it('shows a masked key and never the full token when connected', () => {
    fixture.detectChanges();
    httpMock.expectOne(CONNECT_URL).flush({
      success: true,
      connected: true,
      source: 'user',
      masked: '****abcd',
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('****abcd');
    expect(el.textContent).not.toContain(FULL_KEY);
    expect(el.textContent).toContain('Disconnect');
  });

  it('Disconnect issues DELETE and returns to disconnected', () => {
    fixture.detectChanges();
    httpMock.expectOne(CONNECT_URL).flush({
      success: true,
      connected: true,
      source: 'user',
      masked: '****abcd',
    });
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button')?.click();
    const del = httpMock.expectOne(CONNECT_URL);
    expect(del.request.method).toBe('DELETE');
    del.flush({ success: true, connected: false, source: null, masked: null });
    fixture.detectChanges();
    expect(component.connected()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Connect');
  });

  it('failed connect shows an error and stays disconnected', () => {
    fixture.detectChanges();
    httpMock.expectOne(CONNECT_URL).flush({
      success: true,
      connected: false,
      source: null,
      masked: null,
    });
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
});
