import { expect, test, type Page, type Route } from '@playwright/test';
import {
  HINT,
  PIN_ERROR,
  isSameDocument,
  itemWithTitle,
  listSection,
  markDocument,
  pinButton,
  pinnedMark,
  uniqueTitle,
  type StoredNote,
} from './pin-helpers';

// AC8, AC9 and AC10 of SMP-23 need an exact count of pinned notes, which a shared store cannot give. The answers of
// the API are faked with page.route, so nothing is pinned for real and these tests run in parallel (plan, decision 12).
// '**/api/notes' does not match the pin path, and '**/api/notes/*/pin' does not match /api/notes.
const LIMIT_REACHED = {
  status: 409,
  json: { error: { code: 'PINNED_NOTES_LIMIT_REACHED', message: 'The limit of pinned notes is reached.' } },
};

function fakeNote(title: string, minute: number, pinnedMinute: number | null = null): StoredNote {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 11, 1, m)).toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    content: '',
    createdAt: at(minute),
    pinnedAt: pinnedMinute === null ? null : at(pinnedMinute),
  };
}

function pinnedOf(note: StoredNote, minute: number): StoredNote {
  return { ...note, pinnedAt: new Date(Date.UTC(2026, 10, 11, 2, minute)).toISOString() };
}

// Answers the GETs of /api/notes with the lists given, one per GET, the last one again after that.
async function fakeLists(page: Page, lists: StoredNote[][]) {
  let gets = 0;
  await page.route('**/api/notes', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const data = lists[Math.min(gets, lists.length - 1)];
    gets += 1;
    return route.fulfill({ json: { data } });
  });
  return { gets: () => gets };
}

// Answers the pin requests with `answer`, and records each one.
async function fakePins(page: Page, answer: (route: Route) => Promise<void>) {
  const requests: string[] = [];
  await page.route('**/api/notes/*/pin', (route) => {
    requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return answer(route);
  });
  return { requests };
}

function threePinned(code: string) {
  const prefix = uniqueTitle(code);
  const p1 = fakeNote(`${prefix} P1`, 1, 10);
  const p2 = fakeNote(`${prefix} P2`, 2, 11);
  const p3 = fakeNote(`${prefix} P3`, 3, 12);
  const b = fakeNote(`${prefix} B`, 4);
  const c = fakeNote(`${prefix} C`, 5);
  // The earliest pin first (Rules 1 of the SPEC), then the notes that are not pinned, newest first.
  return { p1, p2, p3, b, c, list: [p1, p2, p3, c, b] };
}

test('AC8 locks Ghim on a note that is not pinned once 3 are pinned, with the hint as its description', async ({ page }) => {
  const { p1, p2, p3, b, c, list } = threePinned('AC8');
  await fakeLists(page, [list]);
  // The answer of the DELETE of P1 at the end: P1 back among the others, by creation time.
  const pins = await fakePins(page, (route) =>
    route.fulfill({ json: { data: [p2, p3, c, b, { ...p1, pinnedAt: null }] } }),
  );
  await page.goto('/notes');
  const item = itemWithTitle(page, b.title);
  const button = pinButton(item);
  const hint = item.getByText(HINT);

  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(button).toHaveAccessibleDescription(HINT);
  await expect(hint).toBeHidden();

  // Hover shows the hint next to the button, and leaving hides it again.
  await button.hover();
  await expect(hint).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(hint).toBeHidden();

  // Focus shows it.
  await button.focus();
  await expect(hint).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hint).toBeHidden();
  await expect(button).toBeFocused();

  // A press shows it, pins nothing and sends nothing.
  await button.click({ force: true });
  await expect(hint).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(pinnedMark(item)).toHaveCount(0);
  expect(pins.requests).toEqual([]);

  // The Bỏ ghim buttons of the 3 pinned notes are not locked and still send their request.
  for (const pinned of [p1, p2, p3]) {
    await expect(pinButton(itemWithTitle(page, pinned.title))).not.toHaveAttribute('aria-disabled', 'true');
  }
  await pinButton(itemWithTitle(page, p1.title)).click();
  await expect.poll(() => pins.requests).toEqual([`DELETE /api/notes/${p1.id}/pin`]);
});

test('AC9 opens Ghim again and drops the hint once one of the 3 notes is unpinned, without reloading the page', async ({
  page,
}) => {
  const { p1, p2, p3, b, c, list } = threePinned('AC9');
  await fakeLists(page, [list]);
  // The answer of the DELETE: 2 pinned notes, and P2 back among the others by creation time.
  await fakePins(page, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ json: { data: [p1, p3, c, b, { ...p2, pinnedAt: null }] } })
      : route.fulfill({ status: 500 }),
  );
  await page.goto('/notes');
  await markDocument(page);
  const item = itemWithTitle(page, b.title);
  const button = pinButton(item);
  await button.click({ force: true });
  await expect(item.getByText(HINT)).toBeVisible();

  await pinButton(itemWithTitle(page, p2.title)).click();

  await expect(pinnedMark(itemWithTitle(page, p2.title))).toHaveCount(0);
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
  await expect(item.getByText(HINT)).toHaveCount(0);
  await expect(button).toHaveAccessibleDescription('');
  expect(await isSameDocument(page)).toBe(true);
});

test('AC10 reloads the list once, shows the 3 pinned notes and locks Ghim with its hint when the API refuses a pin', async ({
  page,
}) => {
  const prefix = uniqueTitle('AC10');
  const p1 = fakeNote(`${prefix} P1`, 1, 10);
  const p2 = fakeNote(`${prefix} P2`, 2, 11);
  const x = fakeNote(`${prefix} X`, 3);
  const b = fakeNote(`${prefix} B`, 4);
  // Seen by this page: 2 pinned. At the API: X was pinned meanwhile from another browser. The GETs are counted from
  // the refused PUT on: next dev runs React Strict Mode, which sends one more GET, aborted, when the page opens.
  let refused = false;
  let getsAfterPut = 0;
  await page.route('**/api/notes', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (!refused) return route.fulfill({ json: { data: [p1, p2, b, x] } });
    getsAfterPut += 1;
    // X, pinned last, at the bottom of the pinned notes.
    return route.fulfill({ json: { data: [p1, p2, pinnedOf(x, 30), b] } });
  });
  const pins = await fakePins(page, (route) => {
    refused = true;
    return route.fulfill(LIMIT_REACHED);
  });
  await page.goto('/notes');
  const item = itemWithTitle(page, b.title);
  const button = pinButton(item);
  await expect(button).toBeVisible();
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');

  await button.click();

  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(item.getByText(HINT)).toBeVisible();
  await expect(button).toHaveAccessibleDescription(HINT);
  await expect(button).toBeFocused();
  await expect(pinnedMark(item)).toHaveCount(0);
  await expect(item.getByText(PIN_ERROR)).toHaveCount(0);
  const items = listSection(page).getByRole('listitem');
  for (const n of [0, 1, 2]) await expect(pinnedMark(items.nth(n))).toBeVisible();
  await expect(items.nth(0).getByRole('heading', { level: 3 })).toHaveText(p1.title);
  await expect(items.nth(1).getByRole('heading', { level: 3 })).toHaveText(p2.title);
  await expect(items.nth(2).getByRole('heading', { level: 3 })).toHaveText(x.title);
  await expect(items.nth(3).getByRole('heading', { level: 3 })).toHaveText(b.title);
  expect(pins.requests).toEqual([`PUT /api/notes/${b.id}/pin`]);
  expect(getsAfterPut).toBe(1);
});
