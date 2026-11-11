// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest';
import nextConfig from './next.config';

// ADR-0002 and ADR-0004: /api/notes and /api/notes/:id/pin on the web origin are forwarded to the API, and nothing
// else. API_URL is read when rewrites() runs.
async function rewrites() {
  const list = await nextConfig.rewrites?.();
  if (!Array.isArray(list)) throw new Error('rewrites() must answer a plain list');
  return list;
}

async function destination(source: string): Promise<string> {
  const entry = (await rewrites()).find((r) => r.source === source);
  if (!entry) throw new Error(`no rewrite for ${source}`);
  return entry.destination;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the rewrites', () => {
  test('forward exactly /api/notes and /api/notes/:id/pin', async () => {
    expect((await rewrites()).map((r) => r.source)).toEqual(['/api/notes', '/api/notes/:id/pin']);
  });
});

describe('the rewrite of /api/notes', () => {
  test('goes to the local API when API_URL is not set', async () => {
    vi.stubEnv('API_URL', undefined);
    expect(await destination('/api/notes')).toBe('http://localhost:3001/notes');
  });

  test('goes to API_URL when it is set', async () => {
    vi.stubEnv('API_URL', 'http://api.internal:4000');
    expect(await destination('/api/notes')).toBe('http://api.internal:4000/notes');
  });

  test('goes to the local API when API_URL is empty, not back to the web itself', async () => {
    vi.stubEnv('API_URL', '');
    expect(await destination('/api/notes')).toBe('http://localhost:3001/notes');
  });

  test('drops the slashes at the end of API_URL, so the API never gets //notes', async () => {
    vi.stubEnv('API_URL', 'http://api.internal:4000//');
    expect(await destination('/api/notes')).toBe('http://api.internal:4000/notes');
  });
});

// Plan of SMP-23, decision 5: :id matches one segment only, and the target always ends with /pin.
describe('the rewrite of /api/notes/:id/pin', () => {
  test('goes to the local API when API_URL is not set', async () => {
    vi.stubEnv('API_URL', undefined);
    expect(await destination('/api/notes/:id/pin')).toBe('http://localhost:3001/notes/:id/pin');
  });

  test('goes to API_URL when it is set, without the slashes at its end', async () => {
    vi.stubEnv('API_URL', 'http://api.internal:4000/');
    expect(await destination('/api/notes/:id/pin')).toBe('http://api.internal:4000/notes/:id/pin');
  });
});
