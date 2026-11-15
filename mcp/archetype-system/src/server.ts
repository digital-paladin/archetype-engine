import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SystemClient } from './client.js';
import { callTool, tools } from './tools.js';

export const SERVER_NAME = 'archetype-system';
export const SERVER_VERSION = '0.1.0';

export function createMcpServer(client: SystemClient): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args) => callTool(tool.name, args, client),
    );
  }
  return server;
}
