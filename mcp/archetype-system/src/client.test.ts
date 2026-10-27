import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertSystemPath, SystemApiError, SystemClient } from './client.js';
import { TEST_BASE_URL, TEST_SYSTEM_KEY } from './testing.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function install(handler: (captured: Captured) => Response | Promise<Response>): {
  client: SystemClient;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const client = new SystemClient(
    { baseUrl: TEST_BASE_URL, apiKey: TEST_SYSTEM_KEY },
    async (url, init) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const captured: Captured = {
        url,
        method: init?.method ?? 'GET',
        headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
      };
      calls.push(captured);
      return handler(captured);
    },
  );
  return { client, calls };
}

const QUEST_ID = '11111111-1111-4111-8111-111111111111';

describe('SystemClient', () => {
  it('reads status with the bearer credential and no request body', async () => {
    const { client, calls } = install(() => jsonResponse(200, {
      success: true,
      trees: [{ className: 'Warrior', level: 2, currentXp: 10, totalXp: 40 }],
    }));
    const body = await client.getStatus();
    assert.deepEqual(body, {
      success: true,
      trees: [{ className: 'Warrior', level: 2, currentXp: 10, totalXp: 40 }],
    });
    assert.equal(calls[0]?.url, `${TEST_BASE_URL}/api/system/status`);
    assert.equal(calls[0]?.method, 'GET');
    assert.equal(calls[0]?.headers.authorization, `Bearer ${TEST_SYSTEM_KEY}`);
    assert.equal(calls[0]?.body, undefined);
  });

  it('lists and fetches quests with the documented query parameters', async () => {
    const { client, calls } = install(() => jsonResponse(200, { success: true }));
    await client.listQuests({ status: 'active', includeHidden: true });
    await client.getQuest(QUEST_ID, true);
    assert.equal(
      calls[0]?.url,
      `${TEST_BASE_URL}/api/system/quests?status=active&includeHidden=true`,
    );
    assert.equal(
      calls[1]?.url,
      `${TEST_BASE_URL}/api/system/quests/${QUEST_ID}?includeHidden=true`,
    );
  });

  it('clears a quest with POST and an empty body so the server decides XP', async () => {
    const { client, calls } = install(() => jsonResponse(200, {
      success: true,
      xpApplied: [{ className: 'Warrior', xp: 40 }],
    }));
    await client.clearQuest(QUEST_ID);
    assert.equal(calls[0]?.method, 'POST');
    assert.equal(calls[0]?.url, `${TEST_BASE_URL}/api/system/quests/${QUEST_ID}/clear`);
    assert.equal(calls[0]?.body, undefined);
    assert.equal(calls[0]?.headers['content-type'], undefined);
  });

  it('passes a message limit and omits it when unset', async () => {
    const { client, calls } = install(() => jsonResponse(200, { success: true, messages: [] }));
    await client.listMessages(10);
    await client.listMessages();
    assert.equal(calls[0]?.url, `${TEST_BASE_URL}/api/system/messages?limit=10`);
    assert.equal(calls[1]?.url, `${TEST_BASE_URL}/api/system/messages`);
  });

  it('returns the backend error code and redacts the credential if the body echoes it', async () => {
    const { client } = install(() => jsonResponse(401, {
      success: false,
      error: 'unauthorized',
      message: `bad token ${TEST_SYSTEM_KEY}`,
    }));
    await assert.rejects(client.getStatus(), (err: unknown) => {
      assert.ok(err instanceof SystemApiError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'unauthorized');
      assert.match(err.message, /bad token \[redacted\]/);
      assert.doesNotMatch(err.message, /sys_0/);
      assert.equal(JSON.stringify(err.body).includes(TEST_SYSTEM_KEY), false);
      return true;
    });
  });

  it('redacts the credential from a transport error', async () => {
    const { client } = install(() => {
      throw new Error(`connect failed for Bearer ${TEST_SYSTEM_KEY}`);
    });
    await assert.rejects(client.listMessages(), (err: unknown) => {
      assert.ok(err instanceof SystemApiError);
      assert.equal(err.status, 0);
      assert.match(err.message, /\[redacted\]/);
      assert.doesNotMatch(err.message, new RegExp(TEST_SYSTEM_KEY));
      return true;
    });
  });

  it('refuses paths outside /api/system', () => {
    assert.throws(() => assertSystemPath('/api/activities'), /only calls \/api\/system/);
    assert.throws(() => assertSystemPath('/api/system/../activities'), /leaves \/api\/system/);
    assert.doesNotThrow(() => assertSystemPath('/api/system/quests?status=active'));
  });
});
