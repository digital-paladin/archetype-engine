import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QuestListQuery, SystemClient } from './client.js';
import { SystemApiError } from './client.js';
import { TOOL_NAMES, callTool, runTool } from './tools.js';

const QUEST_ID = '11111111-1111-4111-8111-111111111111';

class FakeClient {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  getStatus(): Promise<unknown> {
    this.calls.push({ method: 'getStatus', args: [] });
    return Promise.resolve({ success: true, trees: [] });
  }

  listQuests(query?: QuestListQuery): Promise<unknown> {
    this.calls.push({ method: 'listQuests', args: [query] });
    return Promise.resolve({ success: true, quests: [] });
  }

  getQuest(id: string, includeHidden?: boolean): Promise<unknown> {
    this.calls.push({ method: 'getQuest', args: [id, includeHidden] });
    return Promise.resolve({ success: true, quest: { id } });
  }

  clearQuest(id: string): Promise<unknown> {
    this.calls.push({ method: 'clearQuest', args: [id] });
    return Promise.resolve({ success: true, xpApplied: [{ className: 'Warrior', xp: 40 }] });
  }

  listMessages(limit?: number): Promise<unknown> {
    this.calls.push({ method: 'listMessages', args: [limit] });
    return Promise.resolve({ success: true, messages: [] });
  }
}

function asClient(fake: FakeClient): SystemClient {
  return fake as unknown as SystemClient;
}

describe('tools', () => {
  it('exposes only the System routes that exist for a service credential', () => {
    assert.deepEqual(TOOL_NAMES, [
      'get_status',
      'list_quests',
      'get_quest',
      'complete_quest',
      'get_recent_messages',
    ]);
    for (const absent of ['log_activity', 'add_reflection', 'get_recent_events', 'get_character']) {
      assert.equal(TOOL_NAMES.includes(absent), false);
    }
  });

  it('drops an XP amount passed to complete_quest and clears by id only', async () => {
    const fake = new FakeClient();
    const result = await runTool(
      'complete_quest',
      { id: QUEST_ID, xp: 99999, workTag: 'tti' },
      asClient(fake),
    );
    assert.deepEqual(result, { success: true, xpApplied: [{ className: 'Warrior', xp: 40 }] });
    assert.deepEqual(fake.calls, [{ method: 'clearQuest', args: [QUEST_ID] }]);
  });

  it('rejects a blank or non-UUID quest id before any HTTP call', async () => {
    const fake = new FakeClient();
    const result = await callTool('get_quest', { id: '   ' }, asClient(fake));
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? '', /invalid_arguments/);
    assert.deepEqual(fake.calls, []);
  });

  it('rejects a message limit outside 1–100', async () => {
    const fake = new FakeClient();
    const result = await callTool('get_recent_messages', { limit: 0 }, asClient(fake));
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? '', /limit/);
    assert.deepEqual(fake.calls, []);
  });

  it('surfaces a backend validation error without rewriting it', async () => {
    const fake = new FakeClient();
    fake.clearQuest = () => Promise.reject(new SystemApiError(
      'Training quests cannot be scheduled on Thursday',
      422,
      'thursday_rest_day',
      { success: false, error: 'thursday_rest_day', flagged: true },
    ));
    const result = await callTool('complete_quest', { id: QUEST_ID }, asClient(fake));
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { error: string; status: number };
    assert.equal(payload.status, 422);
    assert.equal(payload.error, 'thursday_rest_day');
  });

  it('forwards list filters and the hidden-quest flag', async () => {
    const fake = new FakeClient();
    await runTool('list_quests', { status: 'cleared', includeHidden: true }, asClient(fake));
    await runTool('get_recent_messages', {}, asClient(fake));
    assert.deepEqual(fake.calls[0], {
      method: 'listQuests',
      args: [{ status: 'cleared', includeHidden: true }],
    });
    assert.deepEqual(fake.calls[1], { method: 'listMessages', args: [undefined] });
  });
});
