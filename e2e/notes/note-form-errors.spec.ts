import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// AC3, AC4, AC5 and AC6 of Story SMP-10: the error of each field shows next to it (design.md S1.4 to S1.7). Tests run
// in parallel on one shared API, so each one makes its own title and looks only for it (plan of SMP-2, decision 10).
const API_NOTES = '/api/notes';
const TITLE_REQUIRED = 'Vui lòng nhập tiêu đề';
const TITLE_TOO_LONG = 'Tiêu đề tối đa 100 ký tự';
const CONTENT_TOO_LONG = 'Nội dung tối đa 1000 ký tự';

function uniqueTitle(code: string): string {
  return `${code} ${crypto.randomUUID().slice(0, 8)}`;
}

// A title of exactly `length` characters that starts with a unique tag and ends with accented letters.
function titleOfLength(code: string, length: number): string {
  const tag = `${uniqueTitle(code)} `;
  return tag + 'ệ'.repeat(length - tag.length);
}

async function storedWithTitle(request: APIRequestContext, title: string) {
  const response = await request.get(API_NOTES);
  expect(response.status()).toBe(200);
  const { data } = (await response.json()) as { data: Array<{ title: string; content: string }> };
  return data.filter((note) => note.title === title);
}

// Opens /notes and counts the POSTs the page sends to the API.
async function openForm(page: Page) {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/notes') posts.push(request.url());
  });
  await page.goto('/notes');
  const scope = page.getByRole('form', { name: 'Tạo ghi chú' });
  return {
    posts,
    title: scope.getByRole('textbox', { name: 'Tiêu đề' }),
    content: scope.getByRole('textbox', { name: 'Nội dung' }),
    save: scope.getByRole('button', { name: 'Lưu' }),
  };
}

test('AC3 shows an error next to the title when Lưu is pressed with an empty title', async ({ page }) => {
  const { posts, title, save } = await openForm(page);

  await save.click();

  await expect(title).toHaveAccessibleDescription(TITLE_REQUIRED);
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toBeFocused();
  expect(posts).toEqual([]);
});

test('AC3 shows an error next to the title when Lưu is pressed with a title of spaces only', async ({ page }) => {
  const { posts, title, save } = await openForm(page);

  await title.fill('     ');
  await save.click();

  await expect(title).toHaveAccessibleDescription(TITLE_REQUIRED);
  await expect(title).toBeFocused();
  expect(posts).toEqual([]);
});

test('AC3 shows an error next to the title when Enter is pressed in an empty title', async ({ page }) => {
  const { posts, title } = await openForm(page);

  await title.press('Enter');

  await expect(title).toHaveAccessibleDescription(TITLE_REQUIRED);
  await expect(title).toBeFocused();
  expect(posts).toEqual([]);
});

test('AC3 shows an error next to the title when the empty title is left', async ({ page }) => {
  const { posts, title, content } = await openForm(page);

  await title.focus();
  await expect(title).toHaveAccessibleDescription('');
  await page.keyboard.press('Tab');

  await expect(content).toBeFocused();
  await expect(title).toHaveAccessibleDescription(TITLE_REQUIRED);
  expect(posts).toEqual([]);
});

test('AC4 shows an error next to the title at 101 characters and does not save it', async ({ page, request }) => {
  const { posts, title, save } = await openForm(page);
  const tooLong = `${titleOfLength('AC4', 100)}x`;

  await title.fill(tooLong.slice(0, -1));
  await expect(title).toHaveAccessibleDescription('');
  await title.press('x');

  await expect(title).toHaveValue(tooLong);
  await expect(title).toHaveAccessibleDescription(TITLE_TOO_LONG);
  await save.click();
  await expect(title).toBeFocused();
  await expect(title).toHaveAccessibleDescription(TITLE_TOO_LONG);
  expect(posts).toEqual([]);
  expect(await storedWithTitle(request, tooLong)).toEqual([]);
});

test('AC4 saves a title of exactly 100 accented characters', async ({ page, request }) => {
  const { posts, title, save } = await openForm(page);
  const exact = titleOfLength('AC4', 100);
  expect(Array.from(exact)).toHaveLength(100);

  await title.fill(exact);
  await expect(title).toHaveAccessibleDescription('');
  await save.click();

  await expect(page.getByRole('heading', { level: 3, name: exact })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(await storedWithTitle(request, exact)).toHaveLength(1);
});

test('AC5 shows an error next to the content at 1001 characters and does not save it', async ({ page, request }) => {
  const { posts, title: titleField, content, save } = await openForm(page);
  const title = uniqueTitle('AC5');

  await titleField.fill(title);
  await content.fill('ệ'.repeat(1000));
  await expect(content).toHaveAccessibleDescription('');
  await content.press('x');

  await expect(content).toHaveAccessibleDescription(CONTENT_TOO_LONG);
  await expect(content).toHaveAttribute('aria-invalid', 'true');
  await save.click();
  await expect(content).toBeFocused();
  expect(posts).toEqual([]);
  expect(await storedWithTitle(request, title)).toEqual([]);
});

test('AC5 saves a content of exactly 1000 characters', async ({ page, request }) => {
  const { posts, title: titleField, content, save } = await openForm(page);
  const title = uniqueTitle('AC5');
  const exact = `${'ệ'.repeat(500)}\n${'a'.repeat(499)}`;

  await titleField.fill(title);
  await content.fill(exact);
  await expect(content).toHaveAccessibleDescription('');
  await save.click();

  await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(await storedWithTitle(request, title)).toEqual([expect.objectContaining({ content: exact })]);
});

test('AC6 removes the error of the title as soon as a title is typed', async ({ page }) => {
  const { title, save } = await openForm(page);
  await save.click();
  await expect(title).toHaveAccessibleDescription(TITLE_REQUIRED);

  await title.press('M');

  await expect(title).toHaveAccessibleDescription('');
  await expect(title).not.toHaveAttribute('aria-invalid');
  await expect(title).not.toHaveAttribute('aria-describedby');
});

test('AC6 removes the error of a too long title as soon as it is cut back to 100 characters', async ({ page }) => {
  const { title } = await openForm(page);
  await title.fill(`${titleOfLength('AC6', 100)}x`);
  await expect(title).toHaveAccessibleDescription(TITLE_TOO_LONG);

  await title.press('Backspace');

  await expect(title).toHaveAccessibleDescription('');
  await expect(title).not.toHaveAttribute('aria-invalid');
});

test('AC6 removes the error of the content as soon as it is cut back to 1000 characters', async ({ page }) => {
  const { title, content } = await openForm(page);
  await title.fill(uniqueTitle('AC6'));
  await content.fill('a'.repeat(1001));
  await expect(content).toHaveAccessibleDescription(CONTENT_TOO_LONG);

  await content.press('Backspace');

  await expect(content).toHaveAccessibleDescription('');
  await expect(content).not.toHaveAttribute('aria-invalid');
  await expect(title).toHaveAccessibleDescription('');
});

test('keeps Lưu in place when the errors of both fields show up', async ({ page }) => {
  const { title, content, save } = await openForm(page);
  const before = await save.boundingBox();

  await content.fill('a'.repeat(1001));
  await save.click();

  await expect(title).toHaveAccessibleDescription(TITLE_REQUIRED);
  await expect(content).toHaveAccessibleDescription(CONTENT_TOO_LONG);
  const after = await save.boundingBox();
  expect(after?.y).toBe(before?.y);
});
