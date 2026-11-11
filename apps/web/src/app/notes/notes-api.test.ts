import type { Note } from '@api/notes-shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NotesRequestError, createNote, listNotes } from './notes-api';

const NOTE: Note = {
  id: '6f1c2b8e-0000-4000-8000-000000000001',
  title: 'Mua sữa',
  content: '2 hộp',
  createdAt: '2026-11-02T07:40:00.000Z',
  pinnedAt: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// A fetch that never answers on its own and fails the way the browser does once its signal aborts.
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      }),
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('listNotes', () => {
  test('sends GET to the relative path /api/notes and answers the data list', async () => {
    fetchMock.mockResolvedValue(json({ data: [NOTE] }));

    await expect(listNotes()).resolves.toEqual([NOTE]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/notes');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.cache).toBe('no-store');
  });

  // The body is a valid list, so only the status can make the call fail.
  test.each([400, 404, 500, 503])('throws NotesRequestError on status %i', async (status) => {
    fetchMock.mockResolvedValue(json({ data: [NOTE] }, status));
    await expect(listNotes()).rejects.toBeInstanceOf(NotesRequestError);
  });

  test('throws NotesRequestError when the network fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(listNotes()).rejects.toBeInstanceOf(NotesRequestError);
  });

  test('throws NotesRequestError when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
    await expect(listNotes()).rejects.toBeInstanceOf(NotesRequestError);
  });

  test('throws NotesRequestError when the body has no data list', async () => {
    fetchMock.mockResolvedValue(json({ notes: [] }));
    await expect(listNotes()).rejects.toBeInstanceOf(NotesRequestError);
  });

  test('throws NotesRequestError once 10 s pass without an answer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const result = listNotes();
    const settled = expect(result).rejects.toBeInstanceOf(NotesRequestError);
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });

  test('is still waiting just before 10 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    let settled = false;
    listNotes().catch(() => undefined).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  test('throws an AbortError, not NotesRequestError, when the caller aborts', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const caller = new AbortController();

    const result = listNotes(caller.signal);
    caller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await expect(result).rejects.not.toBeInstanceOf(NotesRequestError);
  });

  test('throws an AbortError without sending anything when the signal is already aborted', async () => {
    const caller = new AbortController();
    caller.abort();

    await expect(listNotes(caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createNote', () => {
  test('sends one POST of JSON to the relative path /api/notes and answers the stored note', async () => {
    fetchMock.mockResolvedValue(json(NOTE, 201));

    await expect(createNote({ title: 'Mua sữa', content: '2 hộp' })).resolves.toEqual(NOTE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/notes');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Mua sữa', content: '2 hộp' });
  });

  // The body is a valid note, so only the status can make the call fail.
  test.each([400, 413, 415, 500])('throws NotesRequestError on status %i', async (status) => {
    fetchMock.mockResolvedValue(json(NOTE, status));
    await expect(createNote({ title: 'Mua sữa' })).rejects.toBeInstanceOf(NotesRequestError);
  });

  test('throws NotesRequestError when the network fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(createNote({ title: 'Mua sữa' })).rejects.toBeInstanceOf(NotesRequestError);
  });

  test('throws NotesRequestError when the body is not a note', async () => {
    fetchMock.mockResolvedValue(json(null, 201));
    await expect(createNote({ title: 'Mua sữa' })).rejects.toBeInstanceOf(NotesRequestError);
  });

  test('throws NotesRequestError once 10 s pass without an answer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const result = createNote({ title: 'Mua sữa' });
    const settled = expect(result).rejects.toBeInstanceOf(NotesRequestError);
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });
});
