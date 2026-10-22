import {
  chicagoDayBounds,
  fetchTogglEntriesForChicagoDay,
  resetTogglDisabledLog,
} from './togglTrack.service';

const TOKEN = 'super-secret-toggl-token';

describe('fetchTogglEntriesForChicagoDay', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  let info: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  const originalToken = process.env.TOGGL_API_TOKEN;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    resetTogglDisabledLog();
    delete process.env.TOGGL_API_TOKEN;
  });

  afterEach(() => {
    global.fetch = realFetch;
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    if (originalToken === undefined) delete process.env.TOGGL_API_TOKEN;
    else process.env.TOGGL_API_TOKEN = originalToken;
  });

  function loggedText(): string {
    return [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]
      .flat()
      .map(part => String(part))
      .join('\n');
  }

  it('queries the Chicago day with basic auth and never puts the token in the URL or the logs', async () => {
    process.env.TOGGL_API_TOKEN = TOKEN;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 10,
        description: 'class',
        project_name: 'Sambo',
        tags: ['gi'],
        start: '2026-10-13T23:00:00Z',
        stop: '2026-10-14T00:00:00Z',
        duration: 3600,
      }],
    });

    const entries = await fetchTogglEntriesForChicagoDay('2026-10-13', new Date('2026-10-14T12:00:00Z'));

    expect(entries).toEqual([{
      id: '10',
      description: 'class',
      projectName: 'Sambo',
      tags: ['gi'],
      start: '2026-10-13T23:00:00Z',
      stop: '2026-10-14T00:00:00Z',
      duration: 3600,
    }]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://api.track.toggl.com/api/v9/me/time_entries');
    expect(url.searchParams.get('meta')).toBe('true');
    expect(url.searchParams.get('start_date')).toBe(chicagoDayBounds('2026-10-13').startIso);
    expect(url.searchParams.get('end_date')).toBe(chicagoDayBounds('2026-10-13').endIso);
    expect(url.searchParams.get('start_date')).toBe('2026-10-13T00:00:00-05:00');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain(TOKEN);
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`${TOKEN}:api_token`).toString('base64')}`);
    expect(loggedText()).not.toContain(TOKEN);
  });

  it('accepts an items envelope and a nested project name, and drops entries outside the Chicago day', async () => {
    process.env.TOGGL_API_TOKEN = TOKEN;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 1,
            project: { name: 'Judo' },
            tags: null,
            start: '2026-10-13T15:00:00Z',
            stop: '2026-10-13T16:00:00Z',
            duration: 3600,
          },
          {
            id: 2,
            project_name: 'Yesterday',
            start: '2026-10-12T18:00:00Z',
            stop: '2026-10-12T19:00:00Z',
            duration: 3600,
          },
          {
            id: 3,
            project_name: 'Next day',
            start: '2026-10-14T05:00:00Z',
            duration: 1800,
          },
        ],
      }),
    });

    const entries = await fetchTogglEntriesForChicagoDay('2026-10-13', new Date('2026-10-14T12:00:00Z'));
    expect(entries.map(entry => entry.id)).toEqual(['1']);
    expect(entries[0].projectName).toBe('Judo');
    expect(entries[0].tags).toEqual([]);
  });

  it('uses the CST offset after the fall-back', async () => {
    process.env.TOGGL_API_TOKEN = TOKEN;
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    await fetchTogglEntriesForChicagoDay('2026-11-02');
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('start_date')).toBe('2026-11-02T00:00:00-06:00');
    expect(url.searchParams.get('end_date')).toBe('2026-11-03T00:00:00-06:00');
  });

  it('is disabled when the token is unset, logs once, and does not call the network', async () => {
    const first = await fetchTogglEntriesForChicagoDay('2026-10-13');
    const second = await fetchTogglEntriesForChicagoDay('2026-10-13');
    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    expect(loggedText()).toMatch(/TOGGL_API_TOKEN is unset/);
    expect(loggedText()).not.toContain(TOKEN);
  });

  it('throws a status error that does not include the token or the response body', async () => {
    process.env.TOGGL_API_TOKEN = TOKEN;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: TOKEN }),
    });
    await expect(fetchTogglEntriesForChicagoDay('2026-10-13')).rejects.toThrow(
      'Toggl time entries request failed (401)',
    );
    expect(loggedText()).not.toContain(TOKEN);
  });

  it('redacts the token when the transport error message includes it', async () => {
    process.env.TOGGL_API_TOKEN = TOKEN;
    fetchMock.mockRejectedValue(new Error(`connect failed for user ${TOKEN}`));
    await expect(fetchTogglEntriesForChicagoDay('2026-10-13')).rejects.toThrow(
      'Toggl time entries request failed: connect failed for user [redacted]',
    );
    expect(loggedText()).not.toContain(TOKEN);
  });
});
