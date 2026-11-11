import type { Note } from '@api/notes-shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NotesRequestError, PinnedNotesLimitError, createNote, listNotes, pinNote, unpinNote } from './notes-api';

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

// Plan of SMP-23, "Lớp gọi API của web" and decision 6: PUT and DELETE on /api/notes/{id}/pin answer the sorted list.
const PINNED: Note = { ...NOTE, pinnedAt: '2026-11-11T03:00:00.000Z' };
const LIMIT_REACHED = { error: { code: 'PINNED_NOTES_LIMIT_REACHED', message: 'The limit of pinned notes is reached.' } };

describe.each([
  { name: 'pinNote', call: pinNote, method: 'PUT' },
  { name: 'unpinNote', call: unpinNote, method: 'DELETE' },
])('$name', ({ call, method }) => {
  test(`sends one ${method} with no body and no Content-Type, and answers the data list`, async () => {
    fetchMock.mockResolvedValue(json({ data: [PINNED] }));

    await expect(call(NOTE.id)).resolves.toEqual([PINNED]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/notes/${NOTE.id}/pin`);
    expect(init.method).toBe(method);
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).has('content-type')).toBe(false);
  });

  test('encodes the id as one segment of the path', async () => {
    fetchMock.mockResolvedValue(json({ data: [] }));

    await call('a/b?c#d e');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/notes/a%2Fb%3Fc%23d%20e/pin');
  });

  test.each([400, 404, 500, 503])('throws NotesRequestError on status %i', async (status) => {
    fetchMock.mockResolvedValue(json({ error: { code: 'NOT_FOUND', message: 'x' } }, status));
    const result = call(NOTE.id);
    await expect(result).rejects.toBeInstanceOf(NotesRequestError);
    await expect(result).rejects.not.toBeInstanceOf(PinnedNotesLimitError);
  });

  test('throws NotesRequestError, not PinnedNotesLimitError, on a 409 with another code', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'NOTES_LIMIT_REACHED', message: 'x' } }, 409));
    await expect(call(NOTE.id)).rejects.not.toBeInstanceOf(PinnedNotesLimitError);
  });

  test.each([
    ['not JSON', () => new Response('<html>oops</html>', { status: 409 })],
    ['JSON with no error', () => json({ data: [] }, 409)],
    ['JSON with error null', () => json({ error: null }, 409)],
  ])('throws NotesRequestError, not PinnedNotesLimitError, on a 409 whose body is %s', async (_name, response) => {
    fetchMock.mockResolvedValue(response());
    const result = call(NOTE.id);
    await expect(result).rejects.toBeInstanceOf(NotesRequestError);
    await expect(result).rejects.not.toBeInstanceOf(PinnedNotesLimitError);
  });

  test('throws NotesRequestError when the network fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(call(NOTE.id)).rejects.toBeInstanceOf(NotesRequestError);
  });

  test('throws NotesRequestError when the body has no data list', async () => {
    fetchMock.mockResolvedValue(json({ notes: [] }));
    await expect(call(NOTE.id)).rejects.toBeInstanceOf(NotesRequestError);
  });

  test('throws NotesRequestError once 10 s pass without an answer, not before', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    let settled = false;
    const result = call(NOTE.id);
    const failed = expect(result).rejects.toBeInstanceOf(NotesRequestError);
    result.catch(() => undefined).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await failed;
  });
});

describe('pinNote on the limit of pinned notes', () => {
  test('throws PinnedNotesLimitError, a NotesRequestError, on 409 PINNED_NOTES_LIMIT_REACHED', async () => {
    fetchMock.mockResolvedValue(json(LIMIT_REACHED, 409));
    const result = pinNote(NOTE.id);
    await expect(result).rejects.toBeInstanceOf(PinnedNotesLimitError);
    await expect(result).rejects.toBeInstanceOf(NotesRequestError);
  });

  test('throws NotesRequestError, not PinnedNotesLimitError, when that code comes with another status', async () => {
    fetchMock.mockResolvedValue(json(LIMIT_REACHED, 400));
    await expect(pinNote(NOTE.id)).rejects.not.toBeInstanceOf(PinnedNotesLimitError);
  });
});

describe('createNote on a 409', () => {
  test('still throws a plain NotesRequestError, even with the code of the pin limit', async () => {
    fetchMock.mockResolvedValue(json(LIMIT_REACHED, 409));
    const result = createNote({ title: 'Mua sữa' });
    await expect(result).rejects.toBeInstanceOf(NotesRequestError);
    await expect(result).rejects.not.toBeInstanceOf(PinnedNotesLimitError);
  });
});
