import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';

// AC1, AC2, AC7 and AC8 of Story SMP-7, through the form (plan of SMP-2, decision 10). Tests run in parallel on one
// shared API, so each one makes its own title and looks only for it; none counts every note or expects an empty list.
const API_NOTES = '/api/notes';
const SAVE_ERROR = 'Không lưu được ghi chú. Vui lòng thử lại.';

function uniqueTitle(code: string): string {
  return `${code} ${crypto.randomUUID().slice(0, 8)}`;
}

async function storedWithTitle(request: APIRequestContext, title: string) {
  const response = await request.get(API_NOTES);
  expect(response.status()).toBe(200);
  const { data } = (await response.json()) as { data: Array<{ title: string; content: string }> };
  return data.filter((note) => note.title === title);
}

function form(page: Page) {
  const scope = page.getByRole('form', { name: 'Tạo ghi chú' });
  return {
    title: scope.getByLabel('Tiêu đề'),
    content: scope.getByLabel('Nội dung'),
    save: scope.getByRole('button', { name: 'Lưu' }),
    // Inside the form: Next.js adds its own empty role="alert", the route announcer, to every page.
    saveError: scope.getByRole('alert'),
  };
}

// The first note that is not pinned (SPEC of SMP-23, Changes to SMP-2): a new note goes right below the pinned ones.
function firstNote(page: Page) {
  return page
    .getByRole('list')
    .getByRole('listitem')
    .filter({ hasNot: page.getByText('Đã ghim', { exact: true }) })
    .first();
}

// Answers every request to /api/notes except POST, which `onPost` handles.
async function interceptPost(page: Page, onPost: (route: Route) => Promise<void>) {
  await page.route('**/api/notes', (route) =>
    route.request().method() === 'POST' ? onPost(route) : route.continue(),
  );
}

test('AC1 shows a saved note first in the list and empties the form, without reloading the page', async ({
  page,
  request,
}) => {
  const title = uniqueTitle('AC1');
  await page.goto('/notes');
  // Gone if the page reloads.
  await page.evaluate(() => Object.assign(window, { __sameDocument: true }));
  const { title: titleField, content, save } = form(page);

  await titleField.fill(title);
  await content.fill('2 hộp');
  await save.click();

  const first = firstNote(page);
  await expect(first.getByRole('heading', { level: 3 })).toHaveText(title);
  await expect(first).toContainText('2 hộp');
  await expect(titleField).toHaveValue('');
  await expect(content).toHaveValue('');
  await expect(titleField).toBeFocused();
  expect(await page.evaluate(() => (window as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
  expect(await storedWithTitle(request, title)).toEqual([expect.objectContaining({ content: '2 hộp' })]);
});

test('AC2 saves a note with an empty content and shows it first in the list', async ({ page, request }) => {
  const title = uniqueTitle('AC2');
  await page.goto('/notes');
  const { title: titleField, content, save } = form(page);

  await titleField.fill(title);
  await expect(content).toHaveValue('');
  await save.click();

  const first = firstNote(page);
  await expect(first.getByRole('heading', { level: 3 })).toHaveText(title);
  // design.md S1.14: with an empty content, the item has only its title [12] and its creation time [13], then the pin
  // button of SMP-23 [17] in the last child.
  await expect(first.locator('p')).toHaveCount(0);
  await expect(first.locator(':scope > *')).toHaveCount(2);
  await expect(first.locator(':scope > *').first()).toHaveText(title + (await first.locator('time').textContent()));
  expect(await storedWithTitle(request, title)).toEqual([expect.objectContaining({ content: '' })]);
});

test('AC7 creates only one note when Lưu is pressed again before the API answers', async ({ page, request }) => {
  const title = uniqueTitle('AC7');
  let posts = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await interceptPost(page, async (route) => {
    posts += 1;
    await released;
    await route.continue();
  });
  await page.goto('/notes');
  const { title: titleField, save } = form(page);

  await titleField.fill(title);
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  // The button is aria-disabled while saving, which Playwright treats as not clickable, so force the press a user
  // can still make; Enter in Tiêu đề is the other way to send the form again.
  await save.click({ force: true });
  await titleField.press('Enter');
  release();

  await expect(firstNote(page).getByRole('heading', { level: 3 })).toHaveText(title);
  await expect(save).not.toHaveAttribute('aria-busy', 'true');
  expect(posts).toBe(1);
  expect(await storedWithTitle(request, title)).toHaveLength(1);
  await expect(page.getByRole('heading', { level: 3, name: title })).toHaveCount(1);
});

test('AC8 shows the save error and keeps the typed note when the network fails', async ({ page, request }) => {
  const title = uniqueTitle('AC8');
  await interceptPost(page, (route) => route.abort('failed'));
  await page.goto('/notes');
  const { title: titleField, content, save, saveError } = form(page);

  await titleField.fill(title);
  await content.fill('2 hộp');
  await save.click();

  await expect(saveError).toHaveText(SAVE_ERROR);
  await expect(titleField).toHaveValue(title);
  await expect(content).toHaveValue('2 hộp');
  await expect(save).toBeFocused();
  expect(await storedWithTitle(request, title)).toEqual([]);
});

test('AC8 shows the save error and keeps the typed note when the server fails', async ({ page, request }) => {
  const title = uniqueTitle('AC8');
  await interceptPost(page, (route) => route.fulfill({ status: 500 }));
  await page.goto('/notes');
  const { title: titleField, content, save, saveError } = form(page);

  await titleField.fill(title);
  await content.fill('2 hộp');
  await save.click();

  await expect(saveError).toHaveText(SAVE_ERROR);
  await expect(titleField).toHaveValue(title);
  await expect(content).toHaveValue('2 hộp');
  await expect(page.getByRole('heading', { level: 3, name: title })).toHaveCount(0);
  expect(await storedWithTitle(request, title)).toEqual([]);
});
