// The types and rules of a note, shared by the API and the web form (ADR-0001).
// The API imports this file as './notes.shared.js'; the web imports it as '@api/notes-shared'.
// Keep it a leaf: no imports, no decorators, and no API that only Node.js or only browsers have.

export const TITLE_MAX_CHARS = 100;
export const CONTENT_MAX_CHARS = 1000;
// The most notes pinned at a time (docs/specs/SMP-23/plan.md, decision 2).
export const MAX_PINNED_NOTES = 3;

export interface Note {
  id: string; // crypto.randomUUID()
  title: string; // normalized: NFC, line breaks as \n, no spaces at both ends; 1–100 characters
  content: string; // normalized: NFC, line breaks as \n; 0–1000 characters; "" when not sent
  createdAt: string; // ISO 8601 UTC with milliseconds, such as "2026-11-02T07:40:00.000Z"
  pinnedAt: string | null; // when the API received the pin request, ISO 8601 UTC with milliseconds; null when not pinned
}
export interface CreateNoteInput {
  title: string;
  content?: string;
}
export interface NoteList {
  data: Note[];
}

export type NoteField = 'title' | 'content';
export type NoteFieldErrorCode = 'REQUIRED' | 'TOO_LONG' | 'INVALID_TYPE';
export interface NoteFieldError {
  field: NoteField;
  code: NoteFieldErrorCode;
}

// True when pinnedAt is a string, so a note without the field, as in an older answer, is not pinned.
export function isPinned(note: Pick<Note, 'pinnedAt'>): boolean {
  return typeof note.pinnedAt === 'string';
}

const LINE_BREAK = /\r\n?/g;

// NFC, then every \r\n and every lone \r becomes \n, then the spaces at both ends go.
export function normalizeTitle(value: string): string {
  return normalizeContent(value).trim();
}

// NFC, then every \r\n and every lone \r becomes \n. Spaces are kept as typed.
export function normalizeContent(value: string): string {
  return value.normalize('NFC').replace(LINE_BREAK, '\n');
}

// Unicode code points, so every browser and Node.js count the same.
export function countChars(value: string): number {
  return Array.from(value.normalize('NFC')).length;
}

// Takes the raw value of the field and normalizes it first.
export function checkTitle(value: string): 'REQUIRED' | 'TOO_LONG' | null {
  const chars = countChars(normalizeTitle(value));
  if (chars === 0) return 'REQUIRED';
  return chars > TITLE_MAX_CHARS ? 'TOO_LONG' : null;
}

// Takes the raw value of the field and normalizes it first.
export function checkContent(value: string): 'TOO_LONG' | null {
  return countChars(normalizeContent(value)) > CONTENT_MAX_CHARS
    ? 'TOO_LONG'
    : null;
}

// Checks a request body as the API receives it. On success, answers the values
// the API stores; otherwise at most one error per field, title before content.
export function checkNote(input: {
  title?: unknown;
  content?: unknown;
}):
  | { ok: true; value: { title: string; content: string } }
  | { ok: false; errors: NoteFieldError[] } {
  const errors: NoteFieldError[] = [];
  let title = '';
  let content = '';

  if (input.title === undefined) {
    errors.push({ field: 'title', code: 'REQUIRED' });
  } else if (typeof input.title !== 'string') {
    errors.push({ field: 'title', code: 'INVALID_TYPE' });
  } else {
    title = normalizeTitle(input.title);
    const code = checkTitle(title);
    if (code) errors.push({ field: 'title', code });
  }

  if (input.content === undefined) {
    // Not sent: the note is stored with an empty content.
  } else if (typeof input.content !== 'string') {
    errors.push({ field: 'content', code: 'INVALID_TYPE' });
  } else {
    content = normalizeContent(input.content);
    const code = checkContent(content);
    if (code) errors.push({ field: 'content', code });
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { title, content } };
}
