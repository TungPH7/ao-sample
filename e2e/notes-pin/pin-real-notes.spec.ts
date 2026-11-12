import { expect, test, type Page, type Route } from '@playwright/test';
import {
  PIN_ERROR,
  UNPIN_ERROR,
  createNote,
  isSameDocument,
  itemWithTitle,
  listSection,
  markDocument,
  orderOf,
  pinButton,
  pinNote,
  pinnedMark,
  pinnedTitles,
  storedNotes,
  uniqueTitle,
  unpinNote,
  type StoredNote,
} from './pin-helpers';

// AC1–AC7, AC11 and AC12 of SMP-23: every test here pins real notes. Pins are shared by the whole store, so the tests of
// this file run one after the other in one worker (plan, decision 12); not `serial`, which skips every test after a
// failed one. Each test unpins, in `finally`, exactly the notes it pinned.
test.describe.configure({ mode: 'default' });

const PIN_ROUTE = '**/api/notes/*/pin';

// Holds the requests of `method` to the pin path until `release` is called, and counts them.
async function holdPinRequests(page: Page, method: 'PUT' | 'DELETE') {
  let count = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(PIN_ROUTE, async (route) => {
    if (route.request().method() !== method) return route.continue();
    count += 1;
    await released;
    await route.continue();
  });
  return { count: () => count, release };
}

async function failPinRequests(page: Page, method: 'PUT' | 'DELETE', fail: (route: Route) => Promise<void>) {
  await page.route(PIN_ROUTE, (route) => (route.request().method() === method ? fail(route) : route.continue()));
}

async function unpinAll(request: Parameters<typeof unpinNote>[0], notes: StoredNote[]) {
  for (const note of notes) await unpinNote(request, note.id);
}

// The notes pinned before the test, if any, stay above; when there are none, the first pin goes to the top of the list.
test('AC1 pins a note at the bottom of the pinned notes, below the ones pinned before, which keep their places, without reloading the page', async ({
  page,
  request,
}) => {
  const a = await createNote(request, { title: uniqueTitle('AC1 A') });
  const b = await createNote(request, { title: uniqueTitle('AC1 B') });
  try {
    await page.goto('/notes');
    await markDocument(page);
    const itemA = itemWithTitle(page, a.title);
    const itemB = itemWithTitle(page, b.title);
    await expect(itemB).toBeVisible();
    await expect(pinnedMark(itemA)).toHaveCount(0);
    const before = await pinnedTitles(page);
    const items = listSection(page).getByRole('listitem');

    await pinButton(itemA).click();

    await expect(pinnedMark(itemA)).toBeVisible();
    await expect(itemA.getByRole('button', { name: `Bỏ ghim ${a.title}` })).toBeFocused();
    await expect.poll(() => pinnedTitles(page)).toEqual([...before, a.title]);
    await expect(items.nth(before.length).getByRole('heading', { level: 3 })).toHaveText(a.title);
    await expect(pinnedMark(items.nth(before.length + 1))).toHaveCount(0);

    // A second pin goes right below A, and A keeps its place.
    await pinButton(itemB).click();

    await expect(pinnedMark(itemB)).toBeVisible();
    await expect(itemB.getByRole('button', { name: `Bỏ ghim ${b.title}` })).toBeFocused();
    await expect.poll(() => pinnedTitles(page)).toEqual([...before, a.title, b.title]);
    await expect(items.nth(before.length).getByRole('heading', { level: 3 })).toHaveText(a.title);
    await expect(items.nth(before.length + 1).getByRole('heading', { level: 3 })).toHaveText(b.title);
    await expect(pinnedMark(items.nth(before.length + 2))).toHaveCount(0);
    expect(await isSameDocument(page)).toBe(true);
  } finally {
    await unpinNote(request, b.id);
    await unpinNote(request, a.id);
  }
});

test('AC2 shows A, B, D, C after a reload and in another browser, with the pinned mark on A and B only', async ({
  page,
  browser,
  request,
}) => {
  const a = await createNote(request, { title: uniqueTitle('AC2 A') });
  const b = await createNote(request, { title: uniqueTitle('AC2 B') });
  const c = await createNote(request, { title: uniqueTitle('AC2 C') });
  const d = await createNote(request, { title: uniqueTitle('AC2 D') });
  const pinned: StoredNote[] = [];
  const other = await browser.newContext();
  try {
    await pinNote(request, a.id);
    pinned.push(a);
    await pinNote(request, b.id);
    pinned.push(b);

    for (const target of [page, await other.newPage()]) {
      await target.goto('/notes');
      await expect(itemWithTitle(target, d.title)).toBeVisible();
      expect(await orderOf(target, [a.title, b.title, c.title, d.title])).toEqual([a.title, b.title, d.title, c.title]);
      await expect(pinnedMark(itemWithTitle(target, a.title))).toBeVisible();
      await expect(pinnedMark(itemWithTitle(target, b.title))).toBeVisible();
      await expect(pinnedMark(itemWithTitle(target, d.title))).toHaveCount(0);
      await expect(pinnedMark(itemWithTitle(target, c.title))).toHaveCount(0);
    }

    await page.reload();
    await expect(itemWithTitle(page, d.title)).toBeVisible();
    expect(await orderOf(page, [a.title, b.title, c.title, d.title])).toEqual([a.title, b.title, d.title, c.title]);
  } finally {
    await other.close();
    await unpinAll(request, pinned);
  }
});

test('AC3 shows a new note right below the pinned notes, without reloading the page', async ({ page, request }) => {
  const a = await createNote(request, { title: uniqueTitle('AC3 A') });
  const e = uniqueTitle('AC3 E');
  const pinned: StoredNote[] = [];
  try {
    await pinNote(request, a.id);
    pinned.push(a);
    await page.goto('/notes');
    await markDocument(page);
    const form = page.getByRole('form', { name: 'Tạo ghi chú' });

    await form.getByLabel('Tiêu đề').fill(e);
    await form.getByRole('button', { name: 'Lưu' }).click();

    const items = listSection(page).getByRole('listitem');
    await expect(itemWithTitle(page, e)).toBeVisible();
    expect(await orderOf(page, [a.title, e])).toEqual([a.title, e]);
    // E is the first note with no pinned mark: below every pinned note, above every other note.
    const firstUnpinned = items.filter({ hasNot: page.getByText('Đã ghim', { exact: true }) }).first();
    await expect(firstUnpinned.getByRole('heading', { level: 3 })).toHaveText(e);
    await expect(pinnedMark(itemWithTitle(page, e))).toHaveCount(0);
    expect(await isSameDocument(page)).toBe(true);
  } finally {
    await unpinAll(request, pinned);
  }
});

test('AC4 sends one PUT when Ghim is pressed again before the API answers', async ({ page, request }) => {
  const a = await createNote(request, { title: uniqueTitle('AC4') });
  try {
    const held = await holdPinRequests(page, 'PUT');
    await page.goto('/notes');
    const item = itemWithTitle(page, a.title);
    const button = pinButton(item);

    await button.click();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    // aria-disabled while pending, which Playwright treats as not clickable: force the press a user can still make.
    await button.click({ force: true });
    await button.press('Enter');
    held.release();

    await expect(item.getByRole('button', { name: `Bỏ ghim ${a.title}` })).toBeVisible();
    await expect(button).not.toHaveAttribute('aria-busy', 'true');
    expect(held.count()).toBe(1);
    await expect(pinnedMark(item)).toHaveCount(1);
  } finally {
    await unpinNote(request, a.id);
  }
});

test('AC4 sends one DELETE when Bỏ ghim is pressed again before the API answers', async ({ page, request }) => {
  const a = await createNote(request, { title: uniqueTitle('AC4') });
  try {
    await pinNote(request, a.id);
    const held = await holdPinRequests(page, 'DELETE');
    await page.goto('/notes');
    const item = itemWithTitle(page, a.title);
    const button = pinButton(item);

    await button.click();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await button.click({ force: true });
    held.release();

    await expect(item.getByRole('button', { name: `Ghim ${a.title}` })).toBeVisible();
    expect(held.count()).toBe(1);
    await expect(pinnedMark(item)).toHaveCount(0);
  } finally {
    await unpinNote(request, a.id);
  }
});

for (const [name, fail] of [
  ['the network fails', (route: Route) => route.abort('failed')],
  ['the server fails', (route: Route) => route.fulfill({ status: 500 })],
] as const) {
  test(`AC5 keeps the note unpinned in its place, with the pin error next to it only, when ${name}`, async ({
    page,
    request,
  }) => {
    const other = await createNote(request, { title: uniqueTitle('AC5 other') });
    const a = await createNote(request, { title: uniqueTitle('AC5') });
    await failPinRequests(page, 'PUT', fail);
    await page.goto('/notes');
    const item = itemWithTitle(page, a.title);
    await expect(item).toBeVisible();
    const before = await listSection(page).getByRole('heading', { level: 3 }).allTextContents();

    await pinButton(item).click();

    await expect(item.getByRole('alert')).toHaveText(PIN_ERROR);
    await expect(listSection(page).getByText(PIN_ERROR)).toHaveCount(1);
    await expect(itemWithTitle(page, other.title).getByRole('alert')).toHaveCount(0);
    await expect(pinnedMark(item)).toHaveCount(0);
    await expect(item.getByRole('button', { name: `Ghim ${a.title}` })).toBeVisible();
    expect(await listSection(page).getByRole('heading', { level: 3 }).allTextContents()).toEqual(before);
    expect((await storedNotes(request)).find((note) => note.id === a.id)?.pinnedAt).toBeNull();
  });
}

test('AC6 unpins a note back between D and C by creation time, without reloading the page, and after a reload', async ({
  page,
  request,
}) => {
  const c = await createNote(request, { title: uniqueTitle('AC6 C') });
  const a = await createNote(request, { title: uniqueTitle('AC6 A') });
  const d = await createNote(request, { title: uniqueTitle('AC6 D') });
  try {
    await pinNote(request, a.id);
    await page.goto('/notes');
    await markDocument(page);
    const item = itemWithTitle(page, a.title);
    await expect(item).toBeVisible();
    expect(await orderOf(page, [a.title, c.title, d.title])).toEqual([a.title, d.title, c.title]);

    await pinButton(item).click();

    await expect(item.getByRole('button', { name: `Ghim ${a.title}` })).toBeFocused();
    await expect(pinnedMark(item)).toHaveCount(0);
    expect(await orderOf(page, [a.title, c.title, d.title])).toEqual([d.title, a.title, c.title]);
    expect(await isSameDocument(page)).toBe(true);

    await page.reload();
    await expect(itemWithTitle(page, a.title)).toBeVisible();
    expect(await orderOf(page, [a.title, c.title, d.title])).toEqual([d.title, a.title, c.title]);
    await expect(pinnedMark(itemWithTitle(page, a.title))).toHaveCount(0);
  } finally {
    await unpinNote(request, a.id);
  }
});

for (const [name, fail] of [
  ['the network fails', (route: Route) => route.abort('failed')],
  ['the server fails', (route: Route) => route.fulfill({ status: 500 })],
] as const) {
  test(`AC7 keeps the note pinned in its place, with the unpin error next to it only, when ${name}`, async ({
    page,
    request,
  }) => {
    const a = await createNote(request, { title: uniqueTitle('AC7') });
    try {
      await pinNote(request, a.id);
      await failPinRequests(page, 'DELETE', fail);
      await page.goto('/notes');
      const item = itemWithTitle(page, a.title);
      await expect(item).toBeVisible();
      const before = await listSection(page).getByRole('heading', { level: 3 }).allTextContents();

      await pinButton(item).click();

      await expect(item.getByRole('alert')).toHaveText(UNPIN_ERROR);
      await expect(listSection(page).getByText(UNPIN_ERROR)).toHaveCount(1);
      await expect(pinnedMark(item)).toBeVisible();
      await expect(item.getByRole('button', { name: `Bỏ ghim ${a.title}` })).toBeVisible();
      expect(await listSection(page).getByRole('heading', { level: 3 }).allTextContents()).toEqual(before);
      expect((await storedNotes(request)).find((note) => note.id === a.id)?.pinnedAt).not.toBeNull();
    } finally {
      await unpinNote(request, a.id);
    }
  });
}

test('AC11 refuses a pin sent straight to the API once 3 notes are pinned, and changes no note', async ({ request }) => {
  const notes: StoredNote[] = [];
  for (let n = 0; n < 4; n += 1) notes.push(await createNote(request, { title: uniqueTitle('AC11') }));
  const pinned: StoredNote[] = [];
  try {
    let refused: StoredNote | undefined;
    for (const note of notes) {
      const response = await request.put(`/api/notes/${note.id}/pin`);
      if (response.status() === 409) {
        expect(await response.json()).toEqual({
          error: { code: 'PINNED_NOTES_LIMIT_REACHED', message: 'The limit of pinned notes is reached.' },
        });
        refused = note;
        break;
      }
      expect(response.status()).toBe(200);
      pinned.push(note);
    }

    expect(refused, 'the API must refuse one of 4 pins').toBeDefined();
    const stored = await storedNotes(request);
    expect(stored.filter((note) => note.pinnedAt !== null)).toHaveLength(3);
    expect(stored.find((note) => note.id === refused!.id)?.pinnedAt).toBeNull();
  } finally {
    await unpinAll(request, pinned);
  }
});

// AC12: ids whose % codes are well formed but do not decode to UTF-8, sent as they are, never through encodeURIComponent.
// Malformed codes such as %ZZ are out of scope: the proxy of Development answers them 400 before the app.
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Resource not found.' } };

for (const [name, id] of [
  ['a lone byte above 0x7F', '%FF'],
  ['a lead byte followed by a byte that cannot continue it', '%C3%28'],
  ['an encoded UTF-16 surrogate', '%ED%A0%80'],
  ['an unknown id of the right form', 'no-such-id'],
  ['an unknown id that decodes to UTF-8', '%C3%A9'],
] as const) {
  test(`AC12 answers 404 NOT_FOUND to a pin and an unpin of ${id}, ${name}, sent straight to the API, and changes no note`, async ({
    request,
  }) => {
    const a = await createNote(request, { title: uniqueTitle('AC12 A') });
    const b = await createNote(request, { title: uniqueTitle('AC12 B') });
    const c = await createNote(request, { title: uniqueTitle('AC12 C') });
    const pinned: StoredNote[] = [];
    try {
      await pinNote(request, a.id);
      pinned.push(a);
      await pinNote(request, b.id);
      pinned.push(b);
      const pinnedBefore = (await storedNotes(request)).filter((note) => note.pinnedAt !== null);

      const put = await request.put(`/api/notes/${id}/pin`);
      expect(put.status(), `PUT ${id}`).toBe(404);
      expect(await put.json()).toEqual(NOT_FOUND);
      const del = await request.delete(`/api/notes/${id}/pin`);
      expect(del.status(), `DELETE ${id}`).toBe(404);
      expect(await del.json()).toEqual(NOT_FOUND);

      // The same pinned notes, in the same order, pinned at the same time; C is still unpinned.
      const stored = await storedNotes(request);
      expect(stored.filter((note) => note.pinnedAt !== null)).toEqual(pinnedBefore);
      expect(stored.find((note) => note.id === c.id)?.pinnedAt).toBeNull();
    } finally {
      await unpinAll(request, pinned);
    }
  });
}
