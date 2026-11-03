import { isValidElement } from 'react';
import { expect, test, vi } from 'vitest';
import RootLayout, { metadata } from './layout';

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'font-geist-sans' }),
  Geist_Mono: () => ({ variable: 'font-geist-mono' }),
}));

test('the tab is named "Ghi chú"', () => {
  expect(metadata.title).toBe('Ghi chú');
});

test('the page is marked as Vietnamese', () => {
  const html = RootLayout({ children: null, params: Promise.resolve({}) });
  expect(isValidElement(html)).toBe(true);
  expect((html.props as { lang?: string }).lang).toBe('vi');
});
