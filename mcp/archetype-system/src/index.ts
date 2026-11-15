#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SystemClient } from './client.js';
import { loadConfig } from './config.js';
import { createMcpServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createMcpServer(new SystemClient(config));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'Failed to start the Archetype System MCP server';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
