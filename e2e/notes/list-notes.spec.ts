import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';

// AC10, AC11, AC12 and AC13 of Story SMP-11: the list of notes (design.md S1.11 to S1.15). Tests run in parallel on
// one shared API, so each one makes its own titles and looks only for them; the answers that must be controlled are
// faked with page.route (plan of SMP-2, decision 10).
const API_NOTES = 'http://localhost:3001/notes';
const EMPTY = 'Chưa có ghi chú nào.';
const LOAD_ERROR = 'Không tải được danh sách ghi chú. Vui lòng thử lại.';

interface StoredNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

function uniqueTitle(code: string): string {
  return `${code} ${crypto.randomUUID().slice(0, 8)}`;
}

async function createNote(request: APIRequestContext, data: { title: string; content: string }): Promise<StoredNote> {
  const response = await request.post(API_NOTES, { data });
  expect(response.status()).toBe(201);
  return (await response.json()) as StoredNote;
}

// The section of the list. Next.js adds its own empty role="alert", the route announcer, to every page, so the
// messages are looked for in here only.
function listSection(page: Page) {
  return page.getByRole('region', { name: 'Danh sách ghi chú' });
}

function itemWithTitle(page: Page, title: string) {
  return listSection(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name: title, exact: true }) });
}

// Answers every GET to /api/notes with `onGet`, and lets every other request through.
async function interceptGet(page: Page, onGet: (route: Route) => Promise<void>) {
  await page.route('**/api/notes', (route) => (route.request().method() === 'GET' ? onGet(route) : route.continue()));
}

// dd/MM/yyyy HH:mm in Asia/Ho_Chi_Minh, worked out here from the createdAt of the API: that zone is UTC+7 all year.
function inHoChiMinh(createdAt: string): string {
  const shifted = new Date(new Date(createdAt).getTime() + 7 * 60 * 60 * 1000);
  const two = (value: number) => String(value).padStart(2, '0');
  return (
    `${two(shifted.getUTCDate())}/${two(shifted.getUTCMonth() + 1)}/${shifted.getUTCFullYear()} ` +
    `${two(shifted.getUTCHours())}:${two(shifted.getUTCMinutes())}`
  );
}

test('AC10 shows "Chưa có ghi chú nào." in place of the list when there is no note', async ({ page }) => {
  await interceptGet(page, (route) => route.fulfill({ json: { data: [] } }));

  await page.goto('/notes');

  const section = listSection(page);
  await expect(section.getByRole('status')).toHaveText(EMPTY);
  await expect(section.getByRole('list')).toHaveCount(0);
  await expect(section.getByRole('alert')).toHaveCount(0);
});

test.describe('in the time zone of Ho Chi Minh City', () => {
  test.use({ timezoneId: 'Asia/Ho_Chi_Minh' });

  test('AC11 shows B above A, each with its title, its line breaks and its creation time, after a reload too', async ({
    page,
    request,
  }) => {
    const a = await createNote(request, { title: uniqueTitle('AC11 A'), content: 'Dòng một\nDòng hai' });
    const b = await createNote(request, { title: uniqueTitle('AC11 B'), content: 'Dòng một\n\nDòng ba' });

    await page.goto('/notes');
    await expectListed(page, a, b);

    await page.reload();
    await expectListed(page, a, b);
  });

  async function expectListed(page: Page, a: StoredNote, b: StoredNote) {
    const titles = listSection(page).getByRole('heading', { level: 3 });
    await expect(titles.filter({ hasText: b.title })).toHaveCount(1);
    await expect(titles.filter({ hasText: a.title })).toHaveCount(1);
    const all = await titles.allTextContents();
    expect(all.indexOf(b.title)).toBeLessThan(all.indexOf(a.title));

    for (const note of [a, b]) {
      const item = itemWithTitle(page, note.title);
      const content = item.locator('p');
      await expect(content).toHaveCSS('white-space', 'pre-wrap');
      // innerText follows the rendering, so it has the line breaks only if the page shows them.
      expect(await content.innerText()).toBe(note.content);
      await expect(item.locator('time')).toHaveText(inHoChiMinh(note.createdAt));
      await expect(item.locator('time')).toHaveAttribute('datetime', note.createdAt);
    }
  }
});

test('AC12 shows markup in a note as typed, neither bold nor run', async ({ page, request }) => {
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  const title = `${uniqueTitle('AC12')} <b>đậm</b> <script>alert(1)</script>`;
  const content = '<b>đậm</b>\n<script>alert(1)</script>\n<img src=x onerror="alert(2)">';
  await createNote(request, { title, content });

  await page.goto('/notes');

  const item = itemWithTitle(page, title);
  await expect(item.getByRole('heading', { level: 3 })).toHaveText(title);
  expect(await item.locator('p').innerText()).toBe(content);
  await expect(item.locator('b')).toHaveCount(0);
  await expect(item.locator('script, img')).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test('AC13 shows the load error in place of the list when the API answers 500', async ({ page }) => {
  await interceptGet(page, (route) => route.fulfill({ status: 500 }));

  await page.goto('/notes');

  const section = listSection(page);
  await expect(section.getByRole('alert')).toHaveText(LOAD_ERROR);
  await expect(section.getByRole('list')).toHaveCount(0);
  await expect(section.getByRole('status')).toHaveCount(0);
});

test('AC13 shows the load error in place of the list when the network fails', async ({ page }) => {
  await interceptGet(page, (route) => route.abort('failed'));

  await page.goto('/notes');

  const section = listSection(page);
  await expect(section.getByRole('alert')).toHaveText(LOAD_ERROR);
  await expect(section.getByRole('list')).toHaveCount(0);
});
