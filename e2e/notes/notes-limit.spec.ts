import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// AC14 and AC15 of Story SMP-18: the store keeps at most 1000 notes. Tests run in parallel on one shared API, so a full
// store would break the other tests (SPEC of SMP-2, "Kho dùng chung khi chạy E2E"). The answers of a full store are
// faked with page.route instead, as in the AC8 and AC13 tests; the API side is pinned by apps/api/test/notes.e2e-spec.ts.
const API_NOTES = '/api/notes';
const MAX_NOTES = 1000;
const SAVE_ERROR = 'Không lưu được ghi chú. Vui lòng thử lại.';

// The answer of POST /notes on a full store, in the error shape of ADR-0003 (API Contract of the plan of SMP-2).
const LIMIT_REACHED = {
  status: 409,
  json: { error: { code: 'NOTES_LIMIT_REACHED', message: 'The limit of stored notes is reached.' } },
};

interface StoredNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

function uniqueTitle(code: string): string {
  return `${code} ${crypto.randomUUID().slice(0, 8)}`;
}

// A full store as GET answers it: newest first, so N999 comes first and N0 last.
function fullStore(prefix: string): StoredNote[] {
  const start = Date.parse('2026-11-09T01:00:00.000Z');
  return Array.from({ length: MAX_NOTES }, (_, index) => {
    const n = MAX_NOTES - 1 - index;
    return {
      id: crypto.randomUUID(),
      title: `${prefix} N${n}`,
      content: '',
      createdAt: new Date(start + n * 1000).toISOString(),
    };
  });
}

async function storedWithTitle(request: APIRequestContext, title: string) {
  const response = await request.get(API_NOTES);
  expect(response.status()).toBe(200);
  const { data } = (await response.json()) as { data: StoredNote[] };
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

function listTitles(page: Page) {
  return page
    .getByRole('region', { name: 'Danh sách ghi chú' })
    .getByRole('listitem')
    .getByRole('heading', { level: 3 });
}

test('AC14 shows the save error and keeps the typed note when the store already holds 1000 notes', async ({
  page,
  request,
}) => {
  const title = uniqueTitle('AC14');
  await page.route('**/api/notes', (route) =>
    route.request().method() === 'POST' ? route.fulfill(LIMIT_REACHED) : route.continue(),
  );
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

test('AC15 shows all 1000 notes, newest first, without the refused one, when the page is opened and reloaded', async ({
  page,
  request,
}) => {
  const prefix = uniqueTitle('AC15');
  const refused = `${prefix} refused`;
  const notes = fullStore(prefix);
  await page.route('**/api/notes', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { data: notes } }) : route.fulfill(LIMIT_REACHED),
  );
  await page.goto('/notes');
  const { title: titleField, save, saveError } = form(page);
  await expect(listTitles(page)).toHaveCount(MAX_NOTES);

  await titleField.fill(refused);
  await save.click();
  await expect(saveError).toHaveText(SAVE_ERROR);
  await expectFullList(page);

  await page.reload();
  await expectFullList(page);
  expect(await storedWithTitle(request, refused)).toEqual([]);

  async function expectFullList(target: Page) {
    const titles = listTitles(target);
    await expect(titles).toHaveCount(MAX_NOTES);
    expect(await titles.allTextContents()).toEqual(notes.map((note) => note.title));
    await expect(titles.first()).toHaveText(`${prefix} N999`);
    await expect(target.getByRole('heading', { level: 3, name: refused })).toHaveCount(0);
  }
});
