import { expect, test, type APIRequestContext } from '@playwright/test';

// AC9 sends straight to the API, not through the form (plan of SMP-2, decision 10).
// Tests run in parallel on one shared API, so each one marks its own request with a
// unique text and checks that no stored note holds it, instead of counting notes.
const NOTES_URL = 'http://localhost:3001/notes';

interface StoredNote {
  title: string;
  content: string;
}

function uniqueMarker(): string {
  return `AC9 ${crypto.randomUUID().slice(0, 8)}`;
}

async function storedNotes(request: APIRequestContext): Promise<StoredNote[]> {
  const response = await request.get(NOTES_URL);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: StoredNote[] }).data;
}

function holding(notes: StoredNote[], marker: string): StoredNote[] {
  return notes.filter(
    ({ title, content }) => title.includes(marker) || content.includes(marker),
  );
}

test('AC9 rejects an empty title with 400 naming the title, and stores nothing', async ({
  request,
}) => {
  const marker = uniqueMarker();

  const response = await request.post(NOTES_URL, {
    data: { title: '   ', content: marker },
  });

  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed.',
      fields: [{ field: 'title', code: 'REQUIRED' }],
    },
  });
  expect(holding(await storedNotes(request), marker)).toEqual([]);
});

test('AC9 rejects a title of more than 100 characters with 400 naming the title, and stores nothing', async ({
  request,
}) => {
  const marker = uniqueMarker();
  const title = `${marker} `.padEnd(101, 'x');

  const response = await request.post(NOTES_URL, { data: { title, content: '' } });

  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed.',
      fields: [{ field: 'title', code: 'TOO_LONG' }],
    },
  });
  expect(holding(await storedNotes(request), marker)).toEqual([]);
});

test('AC9 rejects a content of more than 1000 characters with 400 naming the content, and stores nothing', async ({
  request,
}) => {
  const marker = uniqueMarker();

  const response = await request.post(NOTES_URL, {
    data: { title: marker, content: 'y'.repeat(1001) },
  });

  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed.',
      fields: [{ field: 'content', code: 'TOO_LONG' }],
    },
  });
  expect(holding(await storedNotes(request), marker)).toEqual([]);
});

test('AC9 names every wrong field at once, and stores nothing', async ({ request }) => {
  const marker = uniqueMarker();

  const response = await request.post(NOTES_URL, {
    data: { title: '', content: `${marker} `.padEnd(1001, 'y') },
  });

  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed.',
      fields: [
        { field: 'title', code: 'REQUIRED' },
        { field: 'content', code: 'TOO_LONG' },
      ],
    },
  });
  expect(holding(await storedNotes(request), marker)).toEqual([]);
});

test('AC9 still stores a valid note sent the same way', async ({ request }) => {
  const marker = uniqueMarker();

  const response = await request.post(NOTES_URL, {
    data: { title: marker, content: '2 hộp' },
  });

  expect(response.status()).toBe(201);
  expect(holding(await storedNotes(request), marker)).toEqual([
    expect.objectContaining({ title: marker, content: '2 hộp' }),
  ]);
});
