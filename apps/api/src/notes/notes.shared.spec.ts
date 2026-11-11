import { readFileSync } from 'node:fs';
import type { FieldError } from '../common/api-error.js';
import {
  CONTENT_MAX_CHARS,
  MAX_PINNED_NOTES,
  TITLE_MAX_CHARS,
  checkContent,
  checkNote,
  checkTitle,
  countChars,
  isPinned,
  normalizeContent,
  normalizeTitle,
} from './notes.shared.js';
import type {
  CreateNoteInput,
  Note,
  NoteField,
  NoteFieldError,
  NoteFieldErrorCode,
  NoteList,
} from './notes.shared.js';

// Characters written as escapes, so an editor cannot change their Unicode form.
const E_NFD = 'e\u0301'; // "e" + combining acute accent, as some input methods type "é"
const E_NFC = '\u00e9'; // "é" as one code point
const NBSP = '\u00a0';
const ZERO_WIDTH_SPACE = '\u200b';
const THUMBS_UP_MEDIUM_SKIN = '\u{1F44D}\u{1F3FD}'; // 👍🏽
const FAMILY = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'; // 👨‍👩‍👧
const FLAG_VN = '\u{1F1FB}\u{1F1F3}'; // 🇻🇳

describe('limits', () => {
  it('allows 100 characters in a title', () => {
    expect(TITLE_MAX_CHARS).toBe(100);
  });

  it('allows 1000 characters in a content', () => {
    expect(CONTENT_MAX_CHARS).toBe(1000);
  });

  it('allows 3 pinned notes at a time', () => {
    expect(MAX_PINNED_NOTES).toBe(3);
  });
});

describe('isPinned', () => {
  it('is true when pinnedAt is a string', () => {
    expect(isPinned({ pinnedAt: '2026-11-11T03:00:00.000Z' })).toBe(true);
  });

  it('is false when pinnedAt is null', () => {
    expect(isPinned({ pinnedAt: null })).toBe(false);
  });

  it('is false when the note has no pinnedAt, as an older answer has', () => {
    const older = {} as { pinnedAt: string | null };

    expect(isPinned(older)).toBe(false);
  });
});

describe('countChars', () => {
  it('counts 0 for an empty string', () => {
    expect(countChars('')).toBe(0);
  });

  it('counts a letter typed in NFD as 1 character', () => {
    expect(countChars(E_NFD)).toBe(1);
  });

  it('counts a Vietnamese word the same in NFD and NFC', () => {
    const nfd = 'Vie\u0323\u0302t';
    expect(countChars(nfd)).toBe(countChars('Vi\u1ec7t'));
    expect(countChars(nfd)).toBe(4);
  });

  it('counts 👍🏽 as 2 characters', () => {
    expect(countChars(THUMBS_UP_MEDIUM_SKIN)).toBe(2);
  });

  it('counts 👨\u200d👩\u200d👧 as 5 characters', () => {
    expect(countChars(FAMILY)).toBe(5);
  });

  it('counts 🇻🇳 as 2 characters', () => {
    expect(countChars(FLAG_VN)).toBe(2);
  });

  it('counts a zero-width space as 1 character', () => {
    expect(countChars(ZERO_WIDTH_SPACE)).toBe(1);
  });
});

describe('normalizeTitle', () => {
  it('returns a letter typed in NFD in NFC', () => {
    expect(normalizeTitle(`Caf${E_NFD}`)).toBe(`Caf${E_NFC}`);
  });

  it('trims spaces, tabs and line breaks at both ends', () => {
    expect(normalizeTitle(' \t Mua sữa \r\n')).toBe('Mua sữa');
  });

  it('trims a no-break space at both ends', () => {
    expect(normalizeTitle(`${NBSP}Mua sữa${NBSP}`)).toBe('Mua sữa');
  });

  it('keeps a zero-width space', () => {
    expect(normalizeTitle(ZERO_WIDTH_SPACE)).toBe(ZERO_WIDTH_SPACE);
  });

  it('keeps spaces inside the title', () => {
    expect(normalizeTitle('Mua  sữa')).toBe('Mua  sữa');
  });

  it('turns \\r\\n and a lone \\r inside the title into \\n', () => {
    expect(normalizeTitle('a\r\nb\rc')).toBe('a\nb\nc');
  });
});

describe('normalizeContent', () => {
  it('returns a letter typed in NFD in NFC', () => {
    expect(normalizeContent(`Caf${E_NFD}`)).toBe(`Caf${E_NFC}`);
  });

  it('turns \\r\\n into \\n', () => {
    expect(normalizeContent('a\r\nb')).toBe('a\nb');
  });

  it('turns a lone \\r into \\n', () => {
    expect(normalizeContent('a\rb')).toBe('a\nb');
  });

  it('turns \\r\\r\\n into two line breaks', () => {
    expect(normalizeContent('a\r\r\nb')).toBe('a\n\nb');
  });

  it('keeps spaces and line breaks at both ends', () => {
    expect(normalizeContent(`  \n${NBSP}2 hộp\n  `)).toBe(
      `  \n${NBSP}2 hộp\n  `,
    );
  });

  it('counts \\r\\n as 1 character once normalized', () => {
    expect(countChars(normalizeContent('a\r\nb'))).toBe(3);
  });
});

describe('checkTitle', () => {
  it('answers REQUIRED for 0 characters', () => {
    expect(checkTitle('')).toBe('REQUIRED');
  });

  it('accepts 1 character', () => {
    expect(checkTitle('a')).toBeNull();
  });

  it('accepts 100 characters', () => {
    expect(checkTitle('a'.repeat(100))).toBeNull();
  });

  it('answers TOO_LONG for 101 characters', () => {
    expect(checkTitle('a'.repeat(101))).toBe('TOO_LONG');
  });

  it('answers REQUIRED for a title of only spaces, tabs and line breaks', () => {
    expect(checkTitle(' \t\r\n ')).toBe('REQUIRED');
  });

  it('answers REQUIRED for a title of only no-break spaces', () => {
    expect(checkTitle(`${NBSP}${NBSP}`)).toBe('REQUIRED');
  });

  it('accepts a title of only a zero-width space', () => {
    expect(checkTitle(ZERO_WIDTH_SPACE)).toBeNull();
  });

  it('accepts 100 characters with spaces around them', () => {
    expect(checkTitle(`  ${'a'.repeat(100)}  `)).toBeNull();
  });

  it('accepts 100 letters typed in NFD', () => {
    expect(checkTitle(E_NFD.repeat(100))).toBeNull();
  });

  it('answers TOO_LONG for 101 letters typed in NFD', () => {
    expect(checkTitle(E_NFD.repeat(101))).toBe('TOO_LONG');
  });

  it('accepts 50 × 👍🏽, which count 100 characters', () => {
    expect(checkTitle(THUMBS_UP_MEDIUM_SKIN.repeat(50))).toBeNull();
  });

  it('answers TOO_LONG for 50 × 👍🏽 and one more letter', () => {
    expect(checkTitle(`${THUMBS_UP_MEDIUM_SKIN.repeat(50)}a`)).toBe('TOO_LONG');
  });

  it('answers TOO_LONG for 20 × 👨\u200d👩\u200d👧 and one more letter', () => {
    expect(checkTitle(`${FAMILY.repeat(20)}a`)).toBe('TOO_LONG');
  });

  it('accepts 50 × 🇻🇳, which count 100 characters', () => {
    expect(checkTitle(FLAG_VN.repeat(50))).toBeNull();
  });
});

describe('checkContent', () => {
  it('accepts 0 characters', () => {
    expect(checkContent('')).toBeNull();
  });

  it('accepts 1 character', () => {
    expect(checkContent('a')).toBeNull();
  });

  it('accepts 1000 characters', () => {
    expect(checkContent('a'.repeat(1000))).toBeNull();
  });

  it('answers TOO_LONG for 1001 characters', () => {
    expect(checkContent('a'.repeat(1001))).toBe('TOO_LONG');
  });

  it('counts spaces at both ends, which it keeps', () => {
    expect(checkContent(` ${'a'.repeat(999)} `)).toBe('TOO_LONG');
  });

  it('accepts 1000 × \\r\\n, which count 1000 characters', () => {
    expect(checkContent('\r\n'.repeat(1000))).toBeNull();
  });

  it('answers TOO_LONG for 1001 × \\r\\n', () => {
    expect(checkContent('\r\n'.repeat(1001))).toBe('TOO_LONG');
  });

  it('answers TOO_LONG for 1001 × a lone \\r', () => {
    expect(checkContent('\r'.repeat(1001))).toBe('TOO_LONG');
  });

  it('accepts 1000 letters typed in NFD', () => {
    expect(checkContent(E_NFD.repeat(1000))).toBeNull();
  });

  it('accepts 500 × 👍🏽, which count 1000 characters', () => {
    expect(checkContent(THUMBS_UP_MEDIUM_SKIN.repeat(500))).toBeNull();
  });

  it('answers TOO_LONG for 200 × 👨\u200d👩\u200d👧 and one more letter', () => {
    expect(checkContent(`${FAMILY.repeat(200)}a`)).toBe('TOO_LONG');
  });
});

describe('checkNote', () => {
  it('answers the normalized title and content, as the API stores them', () => {
    const result = checkNote({
      title: `  Caf${E_NFD}\r\n`,
      content: `  Caf${E_NFD}\r\n2 hộp\r`,
    });

    expect(result).toStrictEqual({
      ok: true,
      value: { title: `Caf${E_NFC}`, content: `  Caf${E_NFC}\n2 hộp\n` },
    });
  });

  it('stores "" when the content is not sent', () => {
    expect(checkNote({ title: 'Mua sữa' })).toStrictEqual({
      ok: true,
      value: { title: 'Mua sữa', content: '' },
    });
  });

  it('answers only title and content, whatever else the input holds', () => {
    const input = { title: 'a', content: 'b', id: 'x', createdAt: 'y' };

    expect(checkNote(input)).toStrictEqual({
      ok: true,
      value: { title: 'a', content: 'b' },
    });
  });

  it('accepts a title of 100 and a content of 1000 characters', () => {
    const result = checkNote({
      title: 'a'.repeat(100),
      content: 'b'.repeat(1000),
    });

    expect(result.ok).toBe(true);
  });

  it('answers REQUIRED when the title is not sent', () => {
    expect(checkNote({})).toStrictEqual({
      ok: false,
      errors: [{ field: 'title', code: 'REQUIRED' }],
    });
  });

  it('answers REQUIRED when the title is only spaces', () => {
    expect(checkNote({ title: `  ${NBSP}\r\n` })).toStrictEqual({
      ok: false,
      errors: [{ field: 'title', code: 'REQUIRED' }],
    });
  });

  it('answers TOO_LONG when the title has 101 characters', () => {
    expect(checkNote({ title: 'a'.repeat(101) })).toStrictEqual({
      ok: false,
      errors: [{ field: 'title', code: 'TOO_LONG' }],
    });
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['an array', ['Mua sữa']],
    ['an object', { text: 'Mua sữa' }],
    ['a boolean', true],
  ])('answers INVALID_TYPE when the title is %s', (_, title) => {
    expect(checkNote({ title, content: 'ok' })).toStrictEqual({
      ok: false,
      errors: [{ field: 'title', code: 'INVALID_TYPE' }],
    });
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['an array', ['2 hộp']],
    ['an object', { text: '2 hộp' }],
    ['a boolean', false],
  ])('answers INVALID_TYPE when the content is %s', (_, content) => {
    expect(checkNote({ title: 'Mua sữa', content })).toStrictEqual({
      ok: false,
      errors: [{ field: 'content', code: 'INVALID_TYPE' }],
    });
  });

  it('answers TOO_LONG when the content has 1001 characters', () => {
    expect(
      checkNote({ title: 'Mua sữa', content: 'b'.repeat(1001) }),
    ).toStrictEqual({
      ok: false,
      errors: [{ field: 'content', code: 'TOO_LONG' }],
    });
  });

  it('answers the title error before the content error', () => {
    expect(
      checkNote({ title: 'a'.repeat(101), content: 'b'.repeat(1001) }),
    ).toStrictEqual({
      ok: false,
      errors: [
        { field: 'title', code: 'TOO_LONG' },
        { field: 'content', code: 'TOO_LONG' },
      ],
    });
  });

  it('answers the title error first even when content comes first in the input', () => {
    expect(checkNote({ content: null, title: 7 })).toStrictEqual({
      ok: false,
      errors: [
        { field: 'title', code: 'INVALID_TYPE' },
        { field: 'content', code: 'INVALID_TYPE' },
      ],
    });
  });

  it('answers REQUIRED for a missing title together with a content error', () => {
    expect(checkNote({ content: 'b'.repeat(1001) })).toStrictEqual({
      ok: false,
      errors: [
        { field: 'title', code: 'REQUIRED' },
        { field: 'content', code: 'TOO_LONG' },
      ],
    });
  });

  it('answers field errors the API can send as FieldError', () => {
    const result = checkNote({});
    if (result.ok) throw new Error('expected errors');

    const fields: FieldError[] = result.errors;

    expect(fields).toStrictEqual([{ field: 'title', code: 'REQUIRED' }]);
  });
});

describe('shared types', () => {
  it('describe a note, its input and its list as the API contract does', () => {
    const note: Note = {
      id: '6f1c',
      title: 'Mua sữa',
      content: '2 hộp',
      createdAt: '2026-11-02T07:40:00.000Z',
      pinnedAt: null,
    };
    const pinned: Note = { ...note, pinnedAt: '2026-11-11T03:00:00.000Z' };
    const input: CreateNoteInput = { title: 'Mua sữa' };
    const list: NoteList = { data: [note] };
    const field: NoteField = 'content';
    const code: NoteFieldErrorCode = 'INVALID_TYPE';
    const error: NoteFieldError = { field, code };

    expect([pinned.pinnedAt, input, list, error]).toStrictEqual([
      '2026-11-11T03:00:00.000Z',
      { title: 'Mua sữa' },
      { data: [note] },
      { field: 'content', code: 'INVALID_TYPE' },
    ]);
  });
});

describe('notes.shared.ts', () => {
  const source = readFileSync(
    new URL('./notes.shared.ts', import.meta.url),
    'utf8',
  );

  it('imports nothing, so the web can import it too (ADR-0001)', () => {
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/^\s*export\b[^;]*\bfrom\s*['"]/m);
  });

  it('has no decorator', () => {
    expect(source).not.toMatch(/^\s*@\w/m);
  });

  it('uses no API that only Node.js or only browsers have (ADR-0001)', () => {
    expect(source).not.toMatch(/\/\/\/\s*<reference\b/);

    // Comments may name such APIs, as line 9 names crypto.randomUUID().
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const platformOnly =
      /\b(?:process|Buffer|global|globalThis|window|document|navigator|localStorage|sessionStorage)\b/g;

    expect(code.match(platformOnly)).toBeNull();
  });
});
