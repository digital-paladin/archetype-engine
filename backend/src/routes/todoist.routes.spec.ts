import express from 'express';
import request from 'supertest';

const mockStatus = jest.fn();
const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockService = jest.fn();

jest.mock('../services/todoistToken.service', () => {
  const actual = jest.requireActual('../services/todoistToken.service');
  return {
    ...actual,
    getTodoistConnectionStatus: (...args: unknown[]) => mockStatus(...args),
    saveTodoistApiKey: (...args: unknown[]) => mockSave(...args),
    deleteTodoistApiKey: (...args: unknown[]) => mockDelete(...args),
    getTodoistServiceForUser: (...args: unknown[]) => mockService(...args),
  };
});

import todoistRouter from './todoist.routes';
import { resetTodoistConnectRateLimitForTests } from '../services/todoistToken.service';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (!req.headers.authorization) {
      return res.status(401).json({ success: false, error: 'Authorization header missing' });
    }
    (req as any).userId = 'test-user';
    next();
  });
  app.use('/api/todoist', todoistRouter);
  return app;
}

const KEY = 'abcdefghijklmnopqrstuvwxyz1234567890abcd';

describe('todoist connect routes', () => {
  const app = buildApp();

  beforeEach(() => {
    resetTodoistConnectRateLimitForTests();
    mockStatus.mockReset();
    mockSave.mockReset();
    mockDelete.mockReset();
    mockService.mockReset();
    mockSave.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
  });

  it('POST /connect returns 401 without JWT', async () => {
    const res = await request(app).post('/api/todoist/connect').send({ apiKey: KEY });
    expect(res.status).toBe(401);
  });

  it('POST /connect returns 400 on missing apiKey', async () => {
    const res = await request(app)
      .post('/api/todoist/connect')
      .set('Authorization', 'Bearer t')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/apiKey/i);
  });

  it('POST /connect stores the key and never echoes it', async () => {
    const res = await request(app)
      .post('/api/todoist/connect')
      .set('Authorization', 'Bearer t')
      .send({ apiKey: KEY });
    expect(res.status).toBe(200);
    expect(mockSave).toHaveBeenCalledWith('test-user', KEY);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(res.body.masked).toBe(`****${KEY.slice(-4)}`);
    expect(res.body.connected).toBe(true);
  });

  it('GET /connect returns masked status without the raw token', async () => {
    mockStatus.mockResolvedValue({
      connected: true,
      source: 'user',
      masked: '****abcd',
    });
    const res = await request(app).get('/api/todoist/connect').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.masked).toBe('****abcd');
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  it('DELETE /connect then GET reports disconnected', async () => {
    const del = await request(app).delete('/api/todoist/connect').set('Authorization', 'Bearer t');
    expect(del.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith('test-user');
    mockStatus.mockResolvedValue({ connected: false, source: null, masked: null });
    const res = await request(app).get('/api/todoist/connect').set('Authorization', 'Bearer t');
    expect(res.body.connected).toBe(false);
  });

  it('GET /tasks returns 503 when no token is resolved', async () => {
    mockService.mockResolvedValue(null);
    const res = await request(app).get('/api/todoist/tasks').set('Authorization', 'Bearer t');
    expect(res.status).toBe(503);
  });
});
