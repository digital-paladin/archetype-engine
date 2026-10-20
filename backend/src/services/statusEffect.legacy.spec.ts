import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileStatusEffectStore } from './statusEffect.store';

describe('FileStatusEffectStore legacy json', () => {
  it('assigns an unscoped file to the first user and leaves a second user alone', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-json-'));
    const file = path.join(dir, 'status-effects.json');
    fs.writeFileSync(file, JSON.stringify([
      {
        id: 'legacy-1',
        name: 'Old Buff',
        type: 'buff',
        category: 'other',
        source: 'disk',
        icon: '✦',
        effects: [],
        appliedAt: '2026-10-20T12:00:00.000Z',
        duration: -1,
        expiresAt: null,
      },
    ]));

    const store = new FileStatusEffectStore(file);
    const mine = await store.listActive('paul', '2026-10-20T18:00:00.000Z');
    expect(mine.map(e => e.name)).toEqual(['Old Buff']);

    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ userId: string }>;
    expect(saved[0].userId).toBe('paul');

    const other = new FileStatusEffectStore(file);
    const theirs = await other.listActive('someone-else', '2026-10-20T18:00:00.000Z');
    expect(theirs).toEqual([]);
    const still = await other.listActive('paul', '2026-10-20T18:00:00.000Z');
    expect(still).toHaveLength(1);
  });

  it('ignores a corrupt file instead of throwing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-bad-'));
    const file = path.join(dir, 'status-effects.json');
    fs.writeFileSync(file, '{not json');
    const store = new FileStatusEffectStore(file);
    await expect(store.listActive('paul', new Date().toISOString())).resolves.toEqual([]);
  });
});
