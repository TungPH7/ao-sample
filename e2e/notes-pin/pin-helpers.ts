import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

// Helpers of the E2E tests of SMP-23 (plan, decision 12). Every request goes through the web, /api/notes and
// /api/notes/<id>/pin, as the browser does (ADR-0002, ADR-0004), so the tests run on an environment too.
export const API_NOTES = '/api/notes';
export const PINNED_MARK = 'Đã ghim';
export const HINT = 'Bỏ ghim một ghi chú để ghim ghi chú này';
export const PIN_ERROR = 'Không ghim được ghi chú. Vui lòng thử lại.';
export const UNPIN_ERROR = 'Không bỏ ghim được ghi chú. Vui lòng thử lại.';

export interface StoredNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  pinnedAt: string | null;
}

// `AC<n> <8 characters of a uuid>`: tests run in parallel on one shared API, so each one looks only for its own titles.
export function uniqueTitle(code: string): string {
  return `${code} ${crypto.randomUUID().slice(0, 8)}`;
}

export async function createNote(request: APIRequestContext, data: { title: string; content?: string }): Promise<StoredNote> {
  const response = await request.post(API_NOTES, { data: { content: '', ...data } });
  expect(response.status()).toBe(201);
  return (await response.json()) as StoredNote;
}

function pinPath(id: string): string {
  return `${API_NOTES}/${encodeURIComponent(id)}/pin`;
}

// PUT /api/notes/<id>/pin; answers the sorted list.
export async function pinNote(request: APIRequestContext, id: string): Promise<StoredNote[]> {
  const response = await request.put(pinPath(id));
  expect(response.status(), `pin ${id}`).toBe(200);
  return ((await response.json()) as { data: StoredNote[] }).data;
}

// DELETE /api/notes/<id>/pin. A test unpins only the notes it pinned itself (Code Style of the SPEC).
export async function unpinNote(request: APIRequestContext, id: string): Promise<void> {
  const response = await request.delete(pinPath(id));
  expect(response.status(), `unpin ${id}`).toBe(200);
}

export async function storedNotes(request: APIRequestContext): Promise<StoredNote[]> {
  const response = await request.get(API_NOTES);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: StoredNote[] }).data;
}

// The section of the list. Next.js adds its own empty role="alert", the route announcer, to every page.
export function listSection(page: Page): Locator {
  return page.getByRole('region', { name: 'Danh sách ghi chú' });
}

export function itemWithTitle(page: Page, title: string): Locator {
  return listSection(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name: title, exact: true }) });
}

// The Ghim or Bỏ ghim button [S1.17] of an item; its name is the word on it, then the title of the note.
export function pinButton(item: Locator): Locator {
  return item.getByRole('button', { name: /^(Ghim|Bỏ ghim) / });
}

export function pinnedMark(item: Locator): Locator {
  return item.getByText(PINNED_MARK, { exact: true });
}

// The titles on the page, top to bottom, of the notes named in `titles` only.
export async function orderOf(page: Page, titles: string[]): Promise<string[]> {
  const all = await listSection(page).getByRole('heading', { level: 3 }).allTextContents();
  return all.filter((title) => titles.includes(title));
}

// Gone if the page reloads.
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => Object.assign(window, { __sameDocument: true }));
}

export async function isSameDocument(page: Page): Promise<boolean> {
  return (await page.evaluate(() => (window as { __sameDocument?: boolean }).__sameDocument)) === true;
}
