import { expect, test } from '@playwright/test';

test('the home page opens the notes page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Ghi chú' })).toBeVisible();
});

// @local: only the apps of an environment reach its API, so this test runs on the apps Playwright starts here.
test('the API reports that it is up', { tag: '@local' }, async ({ request }) => {
  const response = await request.get('http://localhost:3001/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

// ADR-0002 and ADR-0004: the web forwards exactly two paths to the API, /api/notes and /api/notes/:id/pin.
test('the web forwards /api/notes to the API', async ({ request }) => {
  const response = await request.get('/api/notes');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^application\/json/);
});

test('the web forwards no other /api path', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toMatch(/^text\/html/);
});

test('the web forwards /api/notes/:id/pin to the API', async ({ request }) => {
  const response = await request.put(`/api/notes/${crypto.randomUUID()}/pin`);
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toMatch(/^application\/json/);
  expect((await response.json()).error.code).toBe('NOT_FOUND');
});

test('the web forwards no other path below /api/notes', async ({ request }) => {
  const response = await request.get('/api/notes/x');
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toMatch(/^text\/html/);
});
