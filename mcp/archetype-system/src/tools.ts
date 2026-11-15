import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape } from 'zod';
import { SystemApiError, type SystemClient } from './client.js';

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations: ToolAnnotations;
  handle: (args: Record<string, unknown>, client: SystemClient) => Promise<unknown>;
}

const questStatus = z.enum(['active', 'cleared', 'failed', 'expired']);
const questId = z.string().uuid();

/**
 * Tools the System service credential can actually perform.
 *
 * log_activity, add_reflection, and get_recent_events are absent on purpose.
 * There is no POST /api/system/events, the System key cannot call POST /api/activities,
 * and there is no reflection or event-audit route. See the package README.
 */
export const tools: ToolDefinition[] = [
  {
    name: 'get_status',
    description:
      'Character status for the System credential\'s user: level, current XP, and total XP per class tree. Calls GET /api/system/status. Returns className, level, currentXp, and totalXp only. Does not return the profile, birth date, or API keys. An empty trees array means no character_stats rows yet.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handle: (_args, client) => client.getStatus(),
  },
  {
    name: 'list_quests',
    description:
      'List System quests (GET /api/system/quests). Optional status is active, cleared, failed, or expired. Hidden quests are masked unless includeHidden is true. Listing runs deadline expiry first. XP values on a quest are what the server stored at create time.',
    inputSchema: {
      status: questStatus.optional(),
      includeHidden: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handle: (args, client) => client.listQuests({
      status: args.status as 'active' | 'cleared' | 'failed' | 'expired' | undefined,
      includeHidden: args.includeHidden === true,
    }),
  },
  {
    name: 'get_quest',
    description:
      'Fetch one System quest by UUID (GET /api/system/quests/:id). Hidden quests are masked unless includeHidden is true. Reading a quest runs deadline expiry first.',
    inputSchema: {
      id: questId,
      includeHidden: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handle: (args, client) => client.getQuest(String(args.id), args.includeHidden === true),
  },
  {
    name: 'complete_quest',
    description:
      'Clear an active System quest (POST /api/system/quests/:id/clear). The backend status becomes cleared. The server pays the XP stored on the quest (xpReward) and ignores any XP amount in the request, so this tool does not accept one. Clearing the same quest again does not pay again. A hidden quest is revealed when it is cleared. id is the quest UUID.',
    inputSchema: {
      id: questId,
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    handle: (args, client) => client.clearQuest(String(args.id)),
  },
  {
    name: 'get_recent_messages',
    description:
      'Latest System-window messages (GET /api/system/messages), including notes stored when a quest is corrected. This is not an activity feed and it is not the event audit log from the Grok Bot bridge draft (accept, replay, and reject records). That audit store does not exist yet. limit is an integer from 1 to 100. Omit it to use the server default of 50.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handle: (args, client) => client.listMessages(
      typeof args.limit === 'number' ? args.limit : undefined,
    ),
  },
];

export const TOOL_NAMES = tools.map((tool) => tool.name);

export async function runTool(name: string, args: unknown, client: SystemClient): Promise<unknown> {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const parsed = z.object(tool.inputSchema).parse(args ?? {}) as Record<string, unknown>;
  return tool.handle(parsed, client);
}

export async function callTool(name: string, args: unknown, client: SystemClient): Promise<CallToolResult> {
  try {
    const data = await runTool(name, args, client);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(errorPayload(err), null, 2) }] };
  }
}

function errorPayload(err: unknown): Record<string, unknown> {
  if (err instanceof SystemApiError) {
    return {
      success: false,
      status: err.status,
      error: err.code ?? null,
      message: err.message,
      body: err.body ?? null,
    };
  }
  if (err instanceof z.ZodError) {
    return {
      success: false,
      error: 'invalid_arguments',
      message: err.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '),
    };
  }
  return {
    success: false,
    error: 'tool_failed',
    message: err instanceof Error ? err.message : 'Tool failed',
  };
}
