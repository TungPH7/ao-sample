// The types and rules of a note, shared by the API and the web form (ADR-0001).
// The API imports this file as './notes.shared.js'; the web imports it as '@api/notes-shared'.
// Keep it a leaf: no imports, no decorators, and no API that only Node.js or only browsers have.

export const TITLE_MAX_CHARS = 100;
export const CONTENT_MAX_CHARS = 1000;

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
