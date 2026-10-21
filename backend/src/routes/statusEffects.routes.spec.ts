import request from 'supertest';
import express from 'express';
import statusEffectsRouter from './statusEffects.routes';
import { MemoryStatusEffectStore, setStatusEffectStore } from '../services/statusEffect.store';

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    (req as express.Request & { userId?: string }).userId = 'paul';
    next();
  });
  server.use('/api/status-effects', statusEffectsRouter);
  return server;
}

beforeEach(() => {
  setStatusEffectStore(new MemoryStatusEffectStore());
});

describe('status effect API shape', () => {
  it('keeps the existing routes and returns dose on an auto-shaped effect', async () => {
    const created = await request(app()).post('/api/status-effects').send({
      name: 'Caffeine Clarity',
      type: 'buff',
      category: 'substance',
      source: 'Black Coffee (8 oz)',
      icon: '☕',
      effects: [{ stat: 'Focus', modifier: '+12%', direction: 'positive' }],
      duration: 300,
      dose: '95 mg caffeine',
    });
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    expect(created.body.effect.dose).toBe('95 mg caffeine');
    expect(created.body.effect.autoApplied).toBe(false);

    const listed = await request(app()).get('/api/status-effects');
    expect(listed.body.success).toBe(true);
    expect(listed.body.effects).toHaveLength(1);
    expect(listed.body.effects[0].source).toBe('Black Coffee (8 oz)');

    const templates = await request(app()).get('/api/status-effects/templates');
    expect(templates.body.success).toBe(true);
    expect(templates.body.templates.some((t: { name: string }) => t.name === 'Alcohol Effect')).toBe(true);

    const removed = await request(app()).delete(`/api/status-effects/${created.body.effect.id}`);
    expect(removed.body.success).toBe(true);
    const empty = await request(app()).get('/api/status-effects');
    expect(empty.body.effects).toEqual([]);
  });
});
