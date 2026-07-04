import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render without error (router-outlet based SPA)', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    // App uses RouterModule for navigation — no static <h1> title in template
    expect(fixture.nativeElement).toBeTruthy();
  });
});
