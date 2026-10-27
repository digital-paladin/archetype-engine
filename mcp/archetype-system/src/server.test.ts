import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SystemClient } from './client.js';
import { createMcpServer } from './server.js';
import { TOOL_NAMES } from './tools.js';
import { TEST_BASE_URL, TEST_SYSTEM_KEY } from './testing.js';

describe('stdio MCP server', () => {
  it('lists the System tools and get_status calls only /api/system/status', async () => {
    const urls: string[] = [];
    const api = new SystemClient(
      { baseUrl: TEST_BASE_URL, apiKey: TEST_SYSTEM_KEY },
      async (url, init) => {
        urls.push(url);
        assert.equal(init?.method, 'GET');
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('authorization'), `Bearer ${TEST_SYSTEM_KEY}`);
        assert.equal(init?.body, undefined);
        return new Response(JSON.stringify({
          success: true,
          trees: [{ className: 'Sage', level: 3, currentXp: 12, totalXp: 80 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    );

    const server = createMcpServer(api);
    const mcp = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const listed = await mcp.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), [...TOOL_NAMES]);
      const statusTool = listed.tools.find((tool) => tool.name === 'get_status');
      assert.match(statusTool?.description ?? '', /GET \/api\/system\/status/);
      const complete = listed.tools.find((tool) => tool.name === 'complete_quest');
      assert.match(complete?.description ?? '', /does not accept/);
      const messages = listed.tools.find((tool) => tool.name === 'get_recent_messages');
      assert.match(messages?.description ?? '', /not an activity feed/);

      const result = await mcp.callTool({ name: 'get_status', arguments: {} });
      assert.equal(result.isError, undefined);
      const text = Array.isArray(result.content) ? (result.content[0] as { text?: string }).text : '';
      assert.match(text ?? '', /Sage/);
      assert.deepEqual(urls, [`${TEST_BASE_URL}/api/system/status`]);
      assert.equal(urls.some((url) => url.includes('/api/activities')), false);
    } finally {
      await mcp.close();
      await server.close();
    }
  });
});
