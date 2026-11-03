import {
  CONTENT_MAX_CHARS,
  TITLE_MAX_CHARS,
  countChars,
  normalizeContent,
  normalizeTitle,
} from './notes.shared.js';

// Characters written as escapes, so an editor cannot change their Unicode form.
const E_NFD = 'é'; // "e" + combining acute accent, as some input methods type "é"
const E_NFC = 'é'; // "é" as one code point
const NBSP = ' ';
const ZERO_WIDTH_SPACE = '​';
const THUMBS_UP_MEDIUM_SKIN = '\u{1F44D}\u{1F3FD}'; // 👍🏽
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // 👨‍👩‍👧
const FLAG_VN = '\u{1F1FB}\u{1F1F3}'; // 🇻🇳

describe('limits', () => {
  it('allows 100 characters in a title', () => {
    expect(TITLE_MAX_CHARS).toBe(100);
  });

  it('allows 1000 characters in a content', () => {
    expect(CONTENT_MAX_CHARS).toBe(1000);
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
    const nfd = 'Việt';
    expect(countChars(nfd)).toBe(countChars('Việt'));
    expect(countChars(nfd)).toBe(4);
  });

  it('counts 👍🏽 as 2 characters', () => {
    expect(countChars(THUMBS_UP_MEDIUM_SKIN)).toBe(2);
  });

  it('counts 👨‍👩‍👧 as 5 characters', () => {
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
