import { isValidElement } from 'react';
import { expect, test } from 'vitest';
import RootLayout, { metadata } from './layout';

test('the tab is named "Ghi chú"', () => {
  expect(metadata.title).toBe('Ghi chú');
});

test('the page is marked as Vietnamese', () => {
  const html = RootLayout({ children: null, params: Promise.resolve({}) });
  expect(isValidElement(html)).toBe(true);
  expect((html.props as { lang?: string }).lang).toBe('vi');
});

test('loads no web font: design.md has none, so the body keeps its own font stack', () => {
  const html = RootLayout({ children: null, params: Promise.resolve({}) });
  expect((html.props as { className?: string }).className).not.toMatch(/font-/);
});
