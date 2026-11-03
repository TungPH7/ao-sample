// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// The colours of design.md S1.1 must reach WCAG AA in the light and the dark scheme: text 4.5:1 against the page,
// the input border and the focus ring 3:1 (non-text contrast), and the page colour 4.5:1 as text on the accent.
const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

function variables(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));
}

const light = variables(css.match(/^:root\s*\{([^}]*)\}/m)?.[1] ?? '');
const dark = variables(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)?.[1] ?? '');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each([
  ['light', light],
  ['dark', dark],
])('the %s colour scheme', (_name, colours) => {
  test.each(['foreground', 'muted', 'error'])('%s text reaches 4.5:1 against the background', (name) => {
    expect(contrast(colours[name], colours.background)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(['border', 'focus-ring', 'accent'])('%s reaches 3:1 against the background', (name) => {
    expect(contrast(colours[name], colours.background)).toBeGreaterThanOrEqual(3);
  });

  test('the background colour as text on the accent reaches 4.5:1', () => {
    expect(contrast(colours.background, colours.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
