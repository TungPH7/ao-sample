import {
  CONTENT_MAX_CHARS,
  TITLE_MAX_CHARS,
  checkContent,
  checkTitle,
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

  it('answers TOO_LONG for 20 × 👨‍👩‍👧 and one more letter', () => {
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

  it('answers TOO_LONG for 200 × 👨‍👩‍👧 and one more letter', () => {
    expect(checkContent(`${FAMILY.repeat(200)}a`)).toBe('TOO_LONG');
  });
});
