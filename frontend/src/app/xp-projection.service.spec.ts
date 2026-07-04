// xp-projection.service.spec.ts
// Angular unit tests for XpProjectionService

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { XpProjectionService, XPProjection } from './xp-projection.service';

describe('XpProjectionService', () => {
  let service: XpProjectionService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [XpProjectionService]
    });
    service = TestBed.inject(XpProjectionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should fetch XP projections from backend', () => {
    const mockResponse: XPProjection = {
      Sage: { totalXP: 100, daysTracked: 10, avgDailyXP: 10, avgWeeklyXP: 70, projected6mo: 1825, projected12mo: 3650 },
      Warrior: { totalXP: 50, daysTracked: 10, avgDailyXP: 5, avgWeeklyXP: 35, projected6mo: 912, projected12mo: 1825 }
    };
    service.getProjections().subscribe((data) => {
      expect(data).toEqual(mockResponse);
    });
    const req = httpMock.expectOne('http://localhost:3000/api/xp-projection');
    expect(req.request.method).toBe('GET');
    req.flush(mockResponse);
  });

  it('should handle error response', () => {
    service.getProjections().subscribe({
      next: () => { throw new Error('Should not succeed'); },
      error: (err) => {
        expect(err.status).toBe(500);
      }
    });
    const req = httpMock.expectOne('http://localhost:3000/api/xp-projection');
    req.flush({ error: 'Failed to compute XP projections' }, { status: 500, statusText: 'Server Error' });
  });
});
