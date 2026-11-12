import type { CreateNoteInput, Note, NoteList } from '@api/notes-shared';

// The web side of the API contracts in the plans of SMP-2 and SMP-23 ("Lớp gọi API của web"). The browser calls
// /api/notes on the web origin and next.config.ts forwards it to the API (ADR-0002), so no environment variable is
// read here.
const NOTES_PATH = '/api/notes';

// Plan decision 8: wait at most 10 s for an answer. A plain AbortController with the global setTimeout, not
// AbortSignal.timeout, so that tests drive the clock with vi.useFakeTimers().
export const REQUEST_TIMEOUT_MS = 10_000;

// A timeout, a network failure, a status other than 2xx or a body that cannot be read. The body of an error answer
// is read in one case only: the 409 of a pin request (plan of SMP-23, decision 6).
export class NotesRequestError extends Error {
  constructor(options?: ErrorOptions) {
    super('The notes request failed.', options);
    this.name = 'NotesRequestError';
  }
}

// A pin request the API refused with 409 PINNED_NOTES_LIMIT_REACHED: MAX_PINNED_NOTES notes are pinned already.
export class PinnedNotesLimitError extends NotesRequestError {
  constructor() {
    super();
    this.name = 'PinnedNotesLimitError';
  }
}

const PINNED_NOTES_LIMIT_REACHED = 'PINNED_NOTES_LIMIT_REACHED';

function abortError(): DOMException {
  return new DOMException('The notes request was aborted.', 'AbortError');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// True when the answer is 409 with the code of the limit of pinned notes (ADR-0003). A body that cannot be read
// makes it any other failure.
async function isPinLimit(response: Response): Promise<boolean> {
  if (response.status !== 409) return false;
  try {
    const body: unknown = await response.json();
    return isObject(body) && isObject(body.error) && body.error.code === PINNED_NOTES_LIMIT_REACHED;
  } catch {
    return false;
  }
}

interface RequestOptions {
  path?: string;
  signal?: AbortSignal;
  // Only pinNote reads the body of an error answer, to tell the limit of pinned notes apart from other failures.
  pinLimit?: boolean;
}

async function request(init: RequestInit, { path = NOTES_PATH, signal, pinLimit = false }: RequestOptions = {}) {
  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, REQUEST_TIMEOUT_MS);
  signal?.addEventListener('abort', stop);

  try {
    const response = await fetch(path, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw pinLimit && (await isPinLimit(response)) ? new PinnedNotesLimitError() : new NotesRequestError();
    }
    return (await response.json()) as unknown;
  } catch (error) {
    // The caller gave up, say on unmount: let it tell this apart from a failure and ignore it.
    if (signal?.aborted) throw abortError();
    throw error instanceof NotesRequestError ? error : new NotesRequestError({ cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

function dataOf(body: unknown): Note[] {
  if (!isObject(body) || !Array.isArray(body.data)) throw new NotesRequestError();
  return (body as unknown as NoteList).data;
}

// GET /api/notes: every note, the pinned ones first, in the order the API sorts them.
export async function listNotes(signal?: AbortSignal): Promise<Note[]> {
  return dataOf(await request({ method: 'GET', cache: 'no-store' }, { signal }));
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

function pinPath(id: string): string {
  return `${NOTES_PATH}/${encodeURIComponent(id)}/pin`;
}

// PUT /api/notes/{id}/pin with no body (ADR-0004): every note, sorted as GET answers right after the pin. Throws
// PinnedNotesLimitError when MAX_PINNED_NOTES notes are pinned already.
export async function pinNote(id: string): Promise<Note[]> {
  return dataOf(await request({ method: 'PUT' }, { path: pinPath(id), pinLimit: true }));
}

// DELETE /api/notes/{id}/pin with no body (ADR-0004): every note, sorted as GET answers right after the unpin.
export async function unpinNote(id: string): Promise<Note[]> {
  return dataOf(await request({ method: 'DELETE' }, { path: pinPath(id) }));
}
