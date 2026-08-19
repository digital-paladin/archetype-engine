import request from 'supertest';
import express, { Express } from 'express';

const mockGetXPHistory = jest.fn();
const mockGetCharacterStats = jest.fn();

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    getXPHistory: (...args: unknown[]) => mockGetXPHistory(...args),
    getCharacterStats: (...args: unknown[]) => mockGetCharacterStats(...args),
  }),
}));

jest.mock('../services/archiveReader.service', () => ({
  ArchiveReaderService: {
    getFullCharacterHistory: () => { throw new Error('sheet missing'); },
  },
}));

import { characterRouter } from './character.routes';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.userId = 'test-user-id'; next(); });
  app.use('/api/character', characterRouter);
  return app;
}

describe('GET /api/character/analytics (authed DB-first)', () => {
  beforeEach(() => {
    mockGetXPHistory.mockReset().mockResolvedValue([]);
    mockGetCharacterStats.mockReset().mockResolvedValue([
      { user_id: 'test-user-id', class_name: 'Sage', level: 26, current_xp: 88, total_xp: 1000 },
    ]);
  });

  it('returns timeToLevel from character_stats when xp_history is empty', async () => {
    const res = await request(makeApp()).get('/api/character/analytics');
    expect(res.status).toBe(200);
    expect(res.body.recentEntries).toEqual([]);
    expect(res.body.timeToLevel).toHaveLength(1);
    expect(res.body.timeToLevel[0].className).toBe('Sage');
    expect(res.body._error).toBeUndefined();
    expect(mockGetXPHistory).toHaveBeenCalledWith('test-user-id', 90);
  });
});
