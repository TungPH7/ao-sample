import { Test, TestingModule } from '@nestjs/testing';
import { ConsoleLogger, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { NotesService } from './../src/notes/notes.service.js';
import { MAX_NOTES } from './../src/notes/notes.store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// "e" followed by U+0301 COMBINING ACUTE ACCENT (NFD), and U+00E9 (NFC).
const E_ACUTE_NFD = 'e' + String.fromCodePoint(0x0301);
const E_ACUTE_NFC = String.fromCodePoint(0x00e9);

describe('Notes (integration)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function postJson(body: unknown) {
    return request(app.getHttpServer())
      .post('/notes')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));
  }

  function postRaw(contentType: string, body: string) {
    return request(app.getHttpServer())
      .post('/notes')
      .set('Content-Type', contentType)
      .send(body);
  }

  async function storedNotes(): Promise<unknown[]> {
    const response = await request(app.getHttpServer()).get('/notes');
    return (response.body as { data: unknown[] }).data;
  }

  describe('POST /notes', () => {
    it('answers 201 with the stored note', async () => {
      const response = await postJson({ title: 'Mua sữa', content: '2 hộp' });

      expect(response.status).toBe(201);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.body).toStrictEqual({
        id: expect.stringMatching(UUID),
        title: 'Mua sữa',
        content: '2 hộp',
        createdAt: expect.stringMatching(ISO_UTC_MS),
      });
      expect(await storedNotes()).toStrictEqual([response.body]);
    });

    it('accepts a Content-Type with a charset', async () => {
      const response = await postRaw(
        'application/json; charset=utf-8',
        JSON.stringify({ title: 'A' }),
      );

      expect(response.status).toBe(201);
    });

    it('stores an empty content when none is sent', async () => {
      const response = await postJson({ title: 'Mua sữa' });

      expect(response.status).toBe(201);
      expect((response.body as { content: string }).content).toBe('');
    });

    it('answers the normalized values: NFC and \\n line breaks', async () => {
      const response = await postJson({
        title: `  Caf${E_ACUTE_NFD}\r\n`,
        content: `Caf${E_ACUTE_NFD}\r\nline\rend`,
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        title: `Caf${E_ACUTE_NFC}`,
        content: `Caf${E_ACUTE_NFC}\nline\nend`,
      });
      expect(await storedNotes()).toStrictEqual([response.body]);
    });

    it('ignores the id, createdAt, __proto__ and any other field sent', async () => {
      const response = await postRaw(
        'application/json',
        '{"title":"A","id":"chosen-by-client","createdAt":"1999-01-01T00:00:00.000Z",' +
          '"__proto__":{"isAdmin":true},"isAdmin":true}',
      );

      expect(response.status).toBe(201);
      expect(response.body).toStrictEqual({
        id: expect.stringMatching(UUID),
        title: 'A',
        content: '',
        createdAt: expect.stringMatching(ISO_UTC_MS),
      });
      expect((response.body as { createdAt: string }).createdAt).not.toBe(
        '1999-01-01T00:00:00.000Z',
      );
      expect(await storedNotes()).toStrictEqual([response.body]);
    });

    it('is not idempotent: the same body sent twice makes two notes', async () => {
      await postJson({ title: 'A' }).expect(201);
      await postJson({ title: 'A' }).expect(201);

      expect(await storedNotes()).toHaveLength(2);
    });

    describe('errors, in the order the API checks them; none stores a note', () => {
      it('1. a body larger than 100 kB answers 413 PAYLOAD_TOO_LARGE', async () => {
        const response = await postJson({ title: 'x'.repeat(110 * 1024) });

        expect(response.status).toBe(413);
        expect(response.headers['content-type']).toMatch(/^application\/json/);
        expect(response.body).toStrictEqual({
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Request body is too large.',
          },
        });
        expect(await storedNotes()).toEqual([]);
      });

      it('2. malformed JSON answers 400 INVALID_BODY without quoting the body', async () => {
        const response = await postRaw(
          'application/json',
          '{"title": body-marker-5d2e81}',
        );

        expect(response.status).toBe(400);
        expect(response.body).toStrictEqual({
          error: {
            code: 'INVALID_BODY',
            message: 'Request body must be a JSON object.',
          },
        });
        expect(response.text).not.toContain('body-marke');
        expect(await storedNotes()).toEqual([]);
      });

      it('2. a body of only null answers 400 INVALID_BODY', async () => {
        const response = await postRaw('application/json', 'null');

        expect(response.status).toBe(400);
        expect(response.body).toStrictEqual({
          error: {
            code: 'INVALID_BODY',
            message: 'Request body must be a JSON object.',
          },
        });
        expect(await storedNotes()).toEqual([]);
      });

      it.each([
        ['application/x-www-form-urlencoded', 'title=A&content=B'],
        ['text/plain', '{"title":"A"}'],
        ['application/merge-patch+json', '{"title":"A"}'],
      ])(
        '3. a body of %s answers 415 UNSUPPORTED_MEDIA_TYPE',
        async (contentType, body) => {
          const response = await postRaw(contentType, body);

          expect(response.status).toBe(415);
          expect(response.headers['content-type']).toMatch(
            /^application\/json/,
          );
          expect(response.body).toStrictEqual({
            error: {
              code: 'UNSUPPORTED_MEDIA_TYPE',
              message: 'Content-Type must be application/json.',
            },
          });
          expect(await storedNotes()).toEqual([]);
        },
      );

      it('3. a body without Content-Type answers 415 UNSUPPORTED_MEDIA_TYPE', async () => {
        // A Buffer, since superagent gives a string body a form Content-Type.
        const response = await request(app.getHttpServer())
          .post('/notes')
          .send(Buffer.from('{"title":"A"}'));

        expect(response.status).toBe(415);
        expect((response.body as { error: { code: string } }).error.code).toBe(
          'UNSUPPORTED_MEDIA_TYPE',
        );
        expect(await storedNotes()).toEqual([]);
      });

      it('3. a request without a body answers 415 UNSUPPORTED_MEDIA_TYPE', async () => {
        const response = await request(app.getHttpServer()).post('/notes');

        expect(response.status).toBe(415);
        expect(await storedNotes()).toEqual([]);
      });

      it('4. a JSON array answers 400 INVALID_BODY', async () => {
        const response = await postJson([{ title: 'A' }]);

        expect(response.status).toBe(400);
        expect(response.body).toStrictEqual({
          error: {
            code: 'INVALID_BODY',
            message: 'Request body must be a JSON object.',
          },
        });
        expect(await storedNotes()).toEqual([]);
      });

      it('5. a body that breaks the rules answers 400 VALIDATION_FAILED with fields', async () => {
        const response = await postJson({
          title: 'x'.repeat(101),
          content: 1,
        });

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toMatch(/^application\/json/);
        expect(response.body).toStrictEqual({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed.',
            fields: [
              { field: 'title', code: 'TOO_LONG' },
              { field: 'content', code: 'INVALID_TYPE' },
            ],
          },
        });
        expect(await storedNotes()).toEqual([]);
      });

      it('5. an empty object answers title REQUIRED', async () => {
        const response = await postJson({});

        expect(response.status).toBe(400);
        expect(
          (response.body as { error: { fields: unknown } }).error.fields,
        ).toStrictEqual([{ field: 'title', code: 'REQUIRED' }]);
        expect(await storedNotes()).toEqual([]);
      });

      it('5. a content longer than 1000 characters answers content TOO_LONG', async () => {
        const response = await postJson({
          title: 'A',
          content: 'y'.repeat(1001),
        });

        expect(response.status).toBe(400);
        expect(
          (response.body as { error: { fields: unknown } }).error.fields,
        ).toStrictEqual([{ field: 'content', code: 'TOO_LONG' }]);
        expect(await storedNotes()).toEqual([]);
      });

      it.each([
        ['title', 'a number', 1],
        ['title', 'null', null],
        ['title', 'an array', ['A']],
        ['title', 'an object', { text: 'A' }],
        ['title', 'a boolean', true],
        ['content', 'a number', 1],
        ['content', 'null', null],
        ['content', 'an array', ['B']],
        ['content', 'an object', { text: 'B' }],
        ['content', 'a boolean', false],
      ])('5. a %s that is %s answers INVALID_TYPE', async (field, _kind, value) => {
        const body: Record<string, unknown> = { title: 'A', [field]: value };

        const response = await postJson(body);

        expect(response.status).toBe(400);
        expect(
          (response.body as { error: { fields: unknown } }).error.fields,
        ).toStrictEqual([{ field, code: 'INVALID_TYPE' }]);
        expect(await storedNotes()).toEqual([]);
      });
    });

    it('writes neither the title, the content nor the body to the log', async () => {
      // The testing module installs a logger that drops every level but error;
      // the logger of a running API writes them all.
      app.useLogger(new ConsoleLogger());
      const written: string[] = [];
      const capture = (chunk: unknown) => {
        written.push(String(chunk));
        return true;
      };
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture);
      const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
        (method) =>
          vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
            written.push(args.map(String).join(' '));
          }),
      );

      try {
        await postJson({ title: 'title-marker-91c4', content: 'content-marker-91c4' });
        await postJson({ title: 'title-marker-91c4'.repeat(10) });
        await postRaw('application/json', '{"title": body-marker-91c4}');
        await postRaw('text/plain', 'body-marker-91c4');
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
        consoleSpies.forEach((spy) => spy.mockRestore());
      }

      expect(written.join('\n')).not.toMatch(/marker-91c4/);
    });
  });

  describe('GET /notes', () => {
    it('answers an empty list with Cache-Control: no-store', async () => {
      const response = await request(app.getHttpServer()).get('/notes');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toStrictEqual({ data: [] });
    });

    it('answers the notes newest first', async () => {
      const first = (await postJson({ title: 'First' }).expect(201)).body;
      const second = (await postJson({ title: 'Second' }).expect(201)).body;
      const third = (await postJson({ title: 'Third' }).expect(201)).body;

      const response = await request(app.getHttpServer()).get('/notes');

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toStrictEqual({ data: [third, second, first] });
    });

    it('answers 1000 notes of the longest size in under 1 s (NFR)', async () => {
      const notes = app.get(NotesService);
      for (let i = 0; i < 1000; i++) {
        notes.create({
          title: `N${i} `.padEnd(100, 'x'),
          content: 'y'.repeat(1000),
        });
      }

      const started = performance.now();
      const response = await request(app.getHttpServer()).get('/notes');
      const elapsed = performance.now() - started;

      expect(response.status).toBe(200);
      const { data } = response.body as { data: { title: string }[] };
      expect(data).toHaveLength(1000);
      expect(data[0].title).toHaveLength(100);
      expect(data[0].title.startsWith('N999 ')).toBe(true);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('when the store holds the most notes it can', () => {
    beforeEach(() => {
      const notes = app.get(NotesService);
      for (let i = 0; i < MAX_NOTES; i++) {
        notes.create({ title: `N${i}` });
      }
    });

    it('POST answers 409 NOTES_LIMIT_REACHED and stores nothing', async () => {
      const response = await postJson({ title: 'One too many' });

      expect(response.status).toBe(409);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).toStrictEqual({
        error: {
          code: 'NOTES_LIMIT_REACHED',
          message: 'The limit of stored notes is reached.',
        },
      });
      const stored = (await storedNotes()) as { title: string }[];
      expect(stored.map(({ title }) => title)).not.toContain('One too many');
    });

    it('GET still answers all 1000 notes, newest first', async () => {
      await postJson({ title: 'One too many' }).expect(409);

      const response = await request(app.getHttpServer()).get('/notes');

      expect(response.status).toBe(200);
      const { data } = response.body as { data: { title: string }[] };
      expect(data).toHaveLength(1000);
      expect(data[0].title).toBe('N999');
    });

    it('POST of a wrong body still answers 400 VALIDATION_FAILED', async () => {
      const response = await postJson({ title: '' });

      expect(response.status).toBe(400);
      expect((response.body as { error: { code: string } }).error.code).toBe(
        'VALIDATION_FAILED',
      );
    });
  });

  it('POST stores the 1000th note', async () => {
    const notes = app.get(NotesService);
    for (let i = 0; i < MAX_NOTES - 1; i++) {
      notes.create({ title: `N${i}` });
    }

    const response = await postJson({ title: 'The last that fits' });

    expect(response.status).toBe(201);
    expect(await storedNotes()).toHaveLength(MAX_NOTES);
  });
});
