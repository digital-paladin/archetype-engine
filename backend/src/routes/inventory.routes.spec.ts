/**
 * Inventory is stored per user. The catalog seed is copied on first list.
 * Creating an item does not award XP.
 */

import request from 'supertest';
import express, { Express } from 'express';
import { MemoryInventoryStore, setInventoryStore } from '../services/inventory.store';
import { MemorySystemQuestStore, setSystemQuestStore } from '../services/systemQuest.store';

const mockGetCharacterProfile = jest.fn();

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    getCharacterProfile: (...args: unknown[]) => mockGetCharacterProfile(...args),
    upsertCharacterProfile: jest.fn().mockResolvedValue(undefined),
  }),
}));

import inventoryRouter from './inventory.routes';

function app(): Express {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    (req as express.Request & { userId?: string }).userId = 'paul';
    next();
  });
  server.use('/api/inventory', inventoryRouter);
  return server;
}

beforeEach(() => {
  setInventoryStore(new MemoryInventoryStore());
  setSystemQuestStore(new MemorySystemQuestStore());
  mockGetCharacterProfile.mockReset().mockResolvedValue({ rpg_stats: { equipped_armor: ['belt-of-truth'] } });
});

describe('GET /api/inventory', () => {
  it('copies the seeded catalog, including Burp Suite, OSCP, and the camping kit', async () => {
    const res = await request(app()).get('/api/inventory');
    expect(res.status).toBe(200);
    const ids = res.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain('burpsuite-pro');
    expect(ids).toContain('oscp-cert');
    expect(ids).toContain('htb-vip');
    expect(ids).toContain('bs-tent');
    expect(ids).toContain('bs-sleep-bag');
    expect(ids).toContain('bs-pack');
    expect(ids.length).toBeGreaterThanOrEqual(43);

    const burp = res.body.items.find((item: { id: string }) => item.id === 'burpsuite-pro');
    expect(burp.category).toBe('tech-hardware');
    expect(burp.stockStatus).toBe('needed');
    expect(burp.rowId).toEqual(expect.any(String));

    const belt = res.body.items.find((item: { id: string }) => item.id === 'belt-of-truth');
    expect(belt.equipped).toBe(true);

    const again = await request(app()).get('/api/inventory');
    expect(again.body.items).toHaveLength(res.body.items.length);
  });
});

describe('POST /api/inventory', () => {
  it('creates a tech-hardware item at runtime and refuses an XP field', async () => {
    const created = await request(app()).post('/api/inventory').send({
      id: 'rtx-3090-rig',
      name: 'RTX 3090 PC rig',
      type: 'equipment',
      category: 'tech-hardware',
      icon: '🖥️',
      unit: 'rig',
      description: 'Local AI build.',
      stockStatus: 'needed',
      priority: 'HIGH',
    });
    expect(created.status).toBe(201);
    expect(created.body.item.id).toBe('rtx-3090-rig');
    expect(created.body.item.stockStatus).toBe('needed');
    expect(created.body.item.rowId).toEqual(expect.any(String));

    const dup = await request(app()).post('/api/inventory').send({
      id: 'rtx-3090-rig',
      name: 'RTX 3090 PC rig',
      type: 'equipment',
      category: 'tech-hardware',
      icon: '🖥️',
      unit: 'rig',
    });
    expect(dup.status).toBe(409);

    const xp = await request(app()).post('/api/inventory').send({
      id: 'paid-item',
      name: 'Paid',
      type: 'equipment',
      category: 'tech-hardware',
      icon: '💻',
      unit: 'piece',
      xpReward: { Developer: 10 },
    });
    expect(xp.status).toBe(400);

    const patched = await request(app()).patch('/api/inventory/rtx-3090-rig').send({ stockStatus: 'low' });
    expect(patched.status).toBe(200);
    expect(patched.body.item.stockStatus).toBe('low');
  });
});
