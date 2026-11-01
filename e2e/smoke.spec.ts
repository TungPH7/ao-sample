import { expect, test } from '@playwright/test';

test('the home page opens', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('the API reports that it is up', async ({ request }) => {
  const response = await request.get('http://localhost:3001/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
