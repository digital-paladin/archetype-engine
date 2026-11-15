import type { ServerConfig } from './config.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 30_000;

export class SystemApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message);
    this.name = 'SystemApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export function redactSecret(value: string, secret: string): string {
  if (!secret || secret.length < 16) return value;
  return value.split(secret).join('[redacted]');
}

export function redactValue(value: unknown, secret: string): unknown {
  if (typeof value === 'string') return redactSecret(value, secret);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secret));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactValue(item, secret);
    }
    return out;
  }
  return value;
}

/** The System credential may only call /api/system. */
export function assertSystemPath(path: string): void {
  const pathname = path.split('?')[0] ?? path;
  if (!pathname.startsWith('/api/system/') && pathname !== '/api/system') {
    throw new Error('The System client only calls /api/system.');
  }
  if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('//')) {
    throw new Error('Refusing a System path that leaves /api/system.');
  }
}

export interface QuestListQuery {
  status?: 'active' | 'cleared' | 'failed' | 'expired';
  includeHidden?: boolean;
}

/**
 * HTTP client for the live System API.
 * Sends the service credential as a bearer token and does not log it.
 * It does not call POST /api/activities and it does not set an XP amount.
 */
export class SystemClient {
  constructor(
    private readonly config: ServerConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  getStatus(): Promise<unknown> {
    return this.request('GET', '/api/system/status');
  }

  listQuests(query: QuestListQuery = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.includeHidden) params.set('includeHidden', 'true');
    return this.request('GET', withQuery('/api/system/quests', params));
  }

  getQuest(id: string, includeHidden = false): Promise<unknown> {
    const params = new URLSearchParams();
    if (includeHidden) params.set('includeHidden', 'true');
    return this.request('GET', withQuery(`/api/system/quests/${encodeURIComponent(id)}`, params));
  }

  /**
   * POST /api/system/quests/:id/clear.
   * The backend pays the stored xpReward. This method sends no body.
   */
  clearQuest(id: string): Promise<unknown> {
    return this.request('POST', `/api/system/quests/${encodeURIComponent(id)}/clear`);
  }

  listMessages(limit?: number): Promise<unknown> {
    const params = new URLSearchParams();
    if (limit != null) params.set('limit', String(limit));
    return this.request('GET', withQuery('/api/system/messages', params));
  }

  private async request(method: string, path: string): Promise<unknown> {
    assertSystemPath(path);
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'System API request failed';
      throw new SystemApiError(redactSecret(message, this.config.apiKey), 0);
    }

    const text = await response.text();
    const parsed = parseBody(redactSecret(text, this.config.apiKey));
    if (!response.ok) {
      const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      const code = typeof record?.error === 'string' ? record.error : undefined;
      const message = typeof record?.message === 'string'
        ? record.message
        : `System API returned HTTP ${response.status}`;
      throw new SystemApiError(message, response.status, code, parsed);
    }
    return parsed;
  }
}

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}
