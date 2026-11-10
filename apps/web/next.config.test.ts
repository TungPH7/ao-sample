// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest';
import nextConfig from './next.config';

// ADR-0002: /api/notes on the web origin is forwarded to the API. API_URL is read when rewrites() runs.
async function destination(): Promise<string> {
  const rewrites = await nextConfig.rewrites?.();
  if (!Array.isArray(rewrites)) throw new Error('rewrites() must answer a plain list');
  expect(rewrites.map((r) => r.source)).toEqual(['/api/notes']);
  return rewrites[0].destination;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the rewrite of /api/notes', () => {
  test('goes to the local API when API_URL is not set', async () => {
    vi.stubEnv('API_URL', undefined);
    expect(await destination()).toBe('http://localhost:3001/notes');
  });

  test('goes to API_URL when it is set', async () => {
    vi.stubEnv('API_URL', 'http://api.internal:4000');
    expect(await destination()).toBe('http://api.internal:4000/notes');
  });

  test('goes to the local API when API_URL is empty, not back to the web itself', async () => {
    vi.stubEnv('API_URL', '');
    expect(await destination()).toBe('http://localhost:3001/notes');
  });

  test('drops the slashes at the end of API_URL, so the API never gets //notes', async () => {
    vi.stubEnv('API_URL', 'http://api.internal:4000//');
    expect(await destination()).toBe('http://api.internal:4000/notes');
  });
});
