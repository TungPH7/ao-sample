import type { CreateNoteInput, Note, NoteList } from '@api/notes-shared';

// The web side of the API contract in the plan of SMP-2 ("Lớp gọi API của web"). The browser calls /api/notes on the
// web origin and next.config.ts forwards it to the API (ADR-0002), so no environment variable is read here.
const NOTES_PATH = '/api/notes';

// Plan decision 8: wait at most 10 s for an answer. A plain AbortController with the global setTimeout, not
// AbortSignal.timeout, so that tests drive the clock with vi.useFakeTimers().
export const REQUEST_TIMEOUT_MS = 10_000;

// A timeout, a network failure, a status other than 2xx or a body that cannot be read. The body of an error answer
// is never read.
export class NotesRequestError extends Error {
  constructor(options?: ErrorOptions) {
    super('The notes request failed.', options);
    this.name = 'NotesRequestError';
  }
}

function abortError(): DOMException {
  return new DOMException('The notes request was aborted.', 'AbortError');
}

async function request(init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, REQUEST_TIMEOUT_MS);
  signal?.addEventListener('abort', stop);

  try {
    const response = await fetch(NOTES_PATH, { ...init, signal: controller.signal });
    if (!response.ok) throw new NotesRequestError();
    return await response.json();
  } catch (error) {
    // The caller gave up, say on unmount: let it tell this apart from a failure and ignore it.
    if (signal?.aborted) throw abortError();
    throw error instanceof NotesRequestError ? error : new NotesRequestError({ cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// GET /api/notes: every note, newest first.
export async function listNotes(signal?: AbortSignal): Promise<Note[]> {
  const body = await request({ method: 'GET', cache: 'no-store' }, signal);
  if (!isObject(body) || !Array.isArray(body.data)) throw new NotesRequestError();
  return (body as unknown as NoteList).data;
}

// POST /api/notes: the stored note, with the values the API normalized.
export async function createNote(input: CreateNoteInput): Promise<Note> {
  const body = await request({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!isObject(body) || typeof body.id !== 'string') throw new NotesRequestError();
  return body as unknown as Note;
}
