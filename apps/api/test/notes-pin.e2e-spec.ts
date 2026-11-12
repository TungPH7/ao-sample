import { Test, TestingModule } from '@nestjs/testing';
import { ConsoleLogger, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { NotesService } from './../src/notes/notes.service.js';
import type { Note } from './../src/notes/notes.shared.js';

// PUT and DELETE /notes/:id/pin, as in the API Contract of docs/specs/SMP-23/plan.md.

const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNKNOWN_UUID = '6f1c2b8e-0000-4000-8000-000000000001';
const NOT_FOUND = {
  error: { code: 'NOT_FOUND', message: 'Resource not found.' },
};
const PINNED_LIMIT = {
  error: {
    code: 'PINNED_NOTES_LIMIT_REACHED',
    message: 'The limit of pinned notes is reached.',
  },
};

describe('Note pins (integration)', () => {
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

  async function create(title: string, content = ''): Promise<Note> {
    const response = await request(app.getHttpServer())
      .post('/notes')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ title, content }))
      .expect(201);
    return response.body as Note;
  }

  function pin(id: string) {
    return request(app.getHttpServer()).put(`/notes/${id}/pin`);
  }

  function unpin(id: string) {
    return request(app.getHttpServer()).delete(`/notes/${id}/pin`);
  }

  async function listed(): Promise<Note[]> {
    const response = await request(app.getHttpServer()).get('/notes').expect(200);
    return (response.body as { data: Note[] }).data;
  }

  function titles(notes: Note[]): string[] {
    return notes.map(({ title }) => title);
  }

  function pinnedTitles(notes: Note[]): string[] {
    return titles(notes.filter(({ pinnedAt }) => pinnedAt !== null));
  }

  describe('PUT /notes/:id/pin', () => {
    it('answers 200, no-store and the list with the note pinned on top', async () => {
      const a = await create('A');
      const b = await create('B');

      const response = await pin(a.id);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toStrictEqual({
        data: [{ ...a, pinnedAt: expect.stringMatching(ISO_UTC_MS) }, b],
      });
      expect(await listed()).toStrictEqual((response.body as { data: Note[] }).data);
    });

    it('records the time the API received the request', async () => {
      const a = await create('A');
      const before = Date.now();

      const response = await pin(a.id).expect(200);

      const [pinned] = (response.body as { data: Note[] }).data;
      const at = Date.parse(pinned.pinnedAt as string);
      expect(at).toBeGreaterThanOrEqual(before);
      expect(at).toBeLessThanOrEqual(Date.now());
    });

    it('lists the pinned notes first, the earliest pin on top and a later pin right below, then the others newest first', async () => {
      // AC1 and AC2: pin A, then B; C and D are not pinned, D created after C.
      const a = await create('A');
      const b = await create('B');
      await create('C');
      await create('D');

      await pin(a.id).expect(200);
      const response = await pin(b.id).expect(200);

      expect(titles((response.body as { data: Note[] }).data)).toEqual([
        'A',
        'B',
        'D',
        'C',
      ]);
      expect(titles(await listed())).toEqual(['A', 'B', 'D', 'C']);
      expect(pinnedTitles(await listed())).toEqual(['A', 'B']);
    });

    it('keeps the id, title, content and createdAt of the note', async () => {
      const a = await create('Mã cửa', '4821');

      await pin(a.id).expect(200);

      const [stored] = await listed();
      expect(stored).toStrictEqual({ ...a, pinnedAt: stored.pinnedAt });
      expect(stored.pinnedAt).toMatch(ISO_UTC_MS);
    });

    it('puts a note created after a pin right below the pinned notes', async () => {
      // AC3, Rules 5.
      const a = await create('A');
      await create('B');
      await pin(a.id).expect(200);

      await create('E');

      expect(titles(await listed())).toEqual(['A', 'E', 'B']);
    });

    it('is idempotent: pinning a pinned note answers 200 and changes nothing', async () => {
      const a = await create('A');
      const b = await create('B');
      await pin(a.id).expect(200);
      const first = await pin(b.id).expect(200);

      const again = await pin(a.id);

      expect(again.status).toBe(200);
      expect(again.headers['cache-control']).toBe('no-store');
      expect(again.body).toStrictEqual(first.body);
    });

    it('ignores a JSON body sent with the request', async () => {
      const a = await create('A');

      const response = await pin(a.id)
        .set('Content-Type', 'application/json')
        .send(
          JSON.stringify({ pinnedAt: '2000-01-01T00:00:00.000Z', title: 'x' }),
        );

      expect(response.status).toBe(200);
      const [stored] = await listed();
      expect(stored.title).toBe('A');
      expect(stored.pinnedAt).not.toBe('2000-01-01T00:00:00.000Z');
      expect(stored.pinnedAt).toMatch(ISO_UTC_MS);
    });

    it.each([
      ['application/x-www-form-urlencoded', 'pinnedAt=2000-01-01T00%3A00%3A00.000Z'],
      ['text/plain', 'anything'],
    ])('does not check the Content-Type: a %s body is ignored too', async (contentType, body) => {
      const a = await create('A');

      const response = await pin(a.id).set('Content-Type', contentType).send(body);

      expect(response.status).toBe(200);
      expect((await listed())[0].pinnedAt).toMatch(ISO_UTC_MS);
    });

    it('ignores the query', async () => {
      const a = await create('A');
      const b = await create('B');

      const response = await request(app.getHttpServer())
        .put(`/notes/${a.id}/pin?id=${b.id}&pinnedAt=2000-01-01T00:00:00.000Z`)
        .expect(200);

      expect(pinnedTitles((response.body as { data: Note[] }).data)).toEqual(['A']);
      expect((await listed())[0].pinnedAt).not.toBe('2000-01-01T00:00:00.000Z');
    });

    describe('the limit of 3 pinned notes (AC11)', () => {
      it('pins the third note, then answers 409 PINNED_NOTES_LIMIT_REACHED for the fourth', async () => {
        const notes: Note[] = [];
        for (const title of ['A', 'B', 'C', 'D']) {
          notes.push(await create(title));
        }
        await pin(notes[0].id).expect(200);
        await pin(notes[1].id).expect(200);
        await pin(notes[2].id).expect(200);
        const before = await listed();

        const response = await pin(notes[3].id);

        expect(response.status).toBe(409);
        expect(response.headers['content-type']).toMatch(/^application\/json/);
        expect(response.body).toStrictEqual(PINNED_LIMIT);
        const after = await listed();
        expect(after).toStrictEqual(before);
        expect(pinnedTitles(after)).toEqual(['A', 'B', 'C']);
        expect(after.find(({ id }) => id === notes[3].id)?.pinnedAt).toBeNull();
      });

      it('still answers 200 for a note already pinned when 3 are pinned', async () => {
        const notes: Note[] = [];
        for (const title of ['A', 'B', 'C']) {
          notes.push(await create(title));
        }
        for (const note of notes) {
          await pin(note.id).expect(200);
        }
        const before = await listed();

        const response = await pin(notes[1].id);

        expect(response.status).toBe(200);
        expect((response.body as { data: Note[] }).data).toStrictEqual(before);
      });

      it('lets exactly one of 5 pins sent at once through when 2 notes are pinned', async () => {
        const pinnedFirst = [await create('P1'), await create('P2')];
        for (const note of pinnedFirst) {
          await pin(note.id).expect(200);
        }
        const others: Note[] = [];
        for (let i = 0; i < 5; i++) {
          others.push(await create(`N${i}`));
        }

        const responses = await Promise.all(others.map(({ id }) => pin(id)));

        const statuses = responses.map(({ status }) => status).sort((a, b) => a - b);
        expect(statuses).toEqual([200, 409, 409, 409, 409]);
        responses
          .filter(({ status }) => status === 409)
          .forEach(({ body }) => expect(body).toStrictEqual(PINNED_LIMIT));
        expect(pinnedTitles(await listed())).toHaveLength(3);
      });
    });

    describe('an id the store does not hold', () => {
      it.each([
        ['an unknown UUID', UNKNOWN_UUID],
        ['a malformed id', 'x'],
        ['__proto__', '__proto__'],
        ['constructor', 'constructor'],
        ['an encoded path', '..%2Fhealth'],
      ])('answers 404 NOT_FOUND for %s and changes nothing', async (_name, id) => {
        const a = await create('A');
        await pin(a.id).expect(200);
        const before = await listed();

        const response = await pin(id);

        expect(response.status).toBe(404);
        expect(response.headers['content-type']).toMatch(/^application\/json/);
        expect(response.body).toStrictEqual(NOT_FOUND);
        expect(await listed()).toStrictEqual(before);
      });

      it('answers 404 before 409 when 3 notes are pinned', async () => {
        for (const title of ['A', 'B', 'C']) {
          await pin((await create(title)).id).expect(200);
        }

        const response = await pin(UNKNOWN_UUID);

        expect(response.status).toBe(404);
        expect(response.body).toStrictEqual(NOT_FOUND);
      });
    });
  });

  describe('DELETE /notes/:id/pin', () => {
    it('answers 200, no-store and the list with the note back in its place', async () => {
      // AC6: A was created after C and before D.
      await create('C');
      const a = await create('A');
      await create('D');
      await pin(a.id).expect(200);

      const response = await unpin(a.id);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.headers['cache-control']).toBe('no-store');
      const { data } = response.body as { data: Note[] };
      expect(titles(data)).toEqual(['D', 'A', 'C']);
      expect(data[1]).toStrictEqual({ ...a, pinnedAt: null });
      expect(await listed()).toStrictEqual(data);
    });

    it('frees a place: a fourth note can be pinned after one of 3 is unpinned', async () => {
      const notes: Note[] = [];
      for (const title of ['A', 'B', 'C', 'D']) {
        notes.push(await create(title));
      }
      for (const note of notes.slice(0, 3)) {
        await pin(note.id).expect(200);
      }

      await unpin(notes[1].id).expect(200);
      const response = await pin(notes[3].id);

      expect(response.status).toBe(200);
      expect(pinnedTitles((response.body as { data: Note[] }).data)).toEqual([
        'A',
        'C',
        'D',
      ]);
    });

    it('puts a note pinned again at the bottom of the pinned notes, not back in its old place', async () => {
      // Rules 4: pin A, B, then C; unpin A and pin it again.
      const a = await create('A');
      const b = await create('B');
      const c = await create('C');
      await create('D');
      await pin(a.id).expect(200);
      await pin(b.id).expect(200);
      await pin(c.id).expect(200);
      await unpin(a.id).expect(200);

      const response = await pin(a.id).expect(200);

      expect(titles((response.body as { data: Note[] }).data)).toEqual([
        'B',
        'C',
        'A',
        'D',
      ]);
      expect(pinnedTitles(await listed())).toEqual(['B', 'C', 'A']);
    });

    it('is idempotent: unpinning a note that is not pinned answers 200 and changes nothing', async () => {
      const a = await create('A');
      const b = await create('B');
      await pin(a.id).expect(200);
      const before = await listed();

      const response = await unpin(b.id);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect((response.body as { data: Note[] }).data).toStrictEqual(before);
    });

    it('ignores a JSON body sent with the request', async () => {
      const a = await create('A');
      await pin(a.id).expect(200);

      const response = await unpin(a.id)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ pinnedAt: '2000-01-01T00:00:00.000Z' }));

      expect(response.status).toBe(200);
      expect((await listed())[0].pinnedAt).toBeNull();
    });

    it.each([
      ['an unknown UUID', UNKNOWN_UUID],
      ['a malformed id', 'x'],
      ['__proto__', '__proto__'],
    ])('answers 404 NOT_FOUND for %s and changes nothing', async (_name, id) => {
      const a = await create('A');
      await pin(a.id).expect(200);
      const before = await listed();

      const response = await unpin(id);

      expect(response.status).toBe(404);
      expect(response.body).toStrictEqual(NOT_FOUND);
      expect(await listed()).toStrictEqual(before);
    });
  });

  describe('an id whose % codes do not decode to UTF-8 (AC12)', () => {
    // Pinned A, then B; C is not pinned. The % codes are well formed: a % and
    // two hex digits. Malformed ones, as %ZZ, are out of the Story.
    async function pinnedAndUnpinned(): Promise<Note[]> {
      const a = await create('A');
      const b = await create('B');
      await create('C');
      await pin(a.id).expect(200);
      await pin(b.id).expect(200);
      return listed();
    }

    const NOT_UTF8 = [
      ['a lone byte above 0x7F', '%FF'],
      ['a lead byte without its continuation', '%C3%28'],
      ['a UTF-16 surrogate', '%ED%A0%80'],
    ];
    const UNKNOWN_WELL_FORMED = [
      ['an unknown id', 'no-such-id'],
      ['an unknown id that decodes to é', '%C3%A9'],
    ];

    describe.each([
      ['PUT', pin],
      ['DELETE', unpin],
    ])('%s /notes/:id/pin', (_method, send) => {
      it.each(NOT_UTF8)(
        'answers 404 NOT_FOUND for %s (%s) and changes no note',
        async (_name, id) => {
          const before = await pinnedAndUnpinned();

          const response = await send(id);

          expect(response.status).toBe(404);
          expect(response.headers['content-type']).toMatch(
            /^application\/json/,
          );
          expect(response.body).toStrictEqual(NOT_FOUND);
          expect(await listed()).toStrictEqual(before);
          expect(pinnedTitles(await listed())).toEqual(['A', 'B']);
        },
      );

      it.each(UNKNOWN_WELL_FORMED)(
        'answers the same 404 NOT_FOUND for %s (%s)',
        async (_name, id) => {
          const before = await pinnedAndUnpinned();

          const response = await send(id);

          expect(response.status).toBe(404);
          expect(response.body).toStrictEqual(NOT_FOUND);
          expect(await listed()).toStrictEqual(before);
        },
      );

      it('answers 404 NOT_FOUND for an id that does not decode, even with a JSON body', async () => {
        const before = await pinnedAndUnpinned();

        const response = await send('%FF')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ pinnedAt: '2000-01-01T00:00:00.000Z' }));

        expect(response.status).toBe(404);
        expect(response.body).toStrictEqual(NOT_FOUND);
        expect(await listed()).toStrictEqual(before);
      });
    });

    it('changes no note after every one of them, in the order of the QA check', async () => {
      const before = await pinnedAndUnpinned();

      for (const [, id] of [...NOT_UTF8, ...UNKNOWN_WELL_FORMED]) {
        await pin(id).expect(404);
        await unpin(id).expect(404);
      }

      expect(await listed()).toStrictEqual(before);
    });

    it('still answers 400 INVALID_BODY for a broken JSON body on POST /notes', async () => {
      const response = await request(app.getHttpServer())
        .post('/notes')
        .set('Content-Type', 'application/json')
        .send('{"title": ');

      expect(response.status).toBe(400);
      expect(response.body).toStrictEqual({
        error: {
          code: 'INVALID_BODY',
          message: 'Request body must be a JSON object.',
        },
      });
    });
  });

  describe('other methods on /notes/:id/pin', () => {
    it.each([
      ['GET', (id: string) => request(app.getHttpServer()).get(`/notes/${id}/pin`)],
      ['POST', (id: string) => request(app.getHttpServer()).post(`/notes/${id}/pin`)],
      ['PATCH', (id: string) => request(app.getHttpServer()).patch(`/notes/${id}/pin`)],
    ])('%s answers 404 NOT_FOUND and changes nothing', async (_method, send) => {
      const a = await create('A');
      const before = await listed();

      const response = await send(a.id);

      expect(response.status).toBe(404);
      expect(response.body).toStrictEqual(NOT_FOUND);
      expect(await listed()).toStrictEqual(before);
    });

    it('POST with a form body, as an HTML form of another site sends, changes nothing', async () => {
      const a = await create('A');

      const response = await request(app.getHttpServer())
        .post(`/notes/${a.id}/pin`)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('_method=PUT');

      expect(response.status).toBe(404);
      expect((await listed())[0].pinnedAt).toBeNull();
    });

    it('answers a preflight from another origin without Access-Control-Allow-Origin', async () => {
      const a = await create('A');

      const response = await request(app.getHttpServer())
        .options(`/notes/${a.id}/pin`)
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'PUT');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect((await listed())[0].pinnedAt).toBeNull();
    });
  });

  it('answers PUT, DELETE and GET in under 1 s each with 1000 notes of the longest size and 3 pinned (NFR)', async () => {
    const notes = app.get(NotesService);
    const created: Note[] = [];
    for (let i = 0; i < 1000; i++) {
      created.push(
        notes.create({
          title: `N${i} `.padEnd(100, 'x'),
          content: 'y'.repeat(1000),
        }),
      );
    }
    notes.pin(created[10].id);
    notes.pin(created[20].id);

    async function timed(send: () => request.Test) {
      const started = performance.now();
      const response = await send();
      return { response, elapsed: performance.now() - started };
    }

    const put = await timed(() => pin(created[500].id));
    const del = await timed(() => unpin(created[20].id));
    await pin(created[30].id).expect(200);
    const get = await timed(() => request(app.getHttpServer()).get('/notes'));

    for (const { response, elapsed } of [put, del, get]) {
      expect(response.status).toBe(200);
      expect((response.body as { data: Note[] }).data).toHaveLength(1000);
      expect(elapsed).toBeLessThan(1000);
    }
    expect(pinnedTitles((get.response.body as { data: Note[] }).data)).toHaveLength(3);
  });

  it('writes neither a title, a content nor a request body to the log', async () => {
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
      const notes: Note[] = [];
      for (let i = 0; i < 4; i++) {
        notes.push(await create(`title-marker-3b7e ${i}`, 'content-marker-3b7e'));
      }
      for (const note of notes) {
        await pin(note.id)
          .set('Content-Type', 'application/json')
          .send('{"title": "body-marker-3b7e"}');
      }
      await unpin(notes[0].id).send('body-marker-3b7e');
      await pin(UNKNOWN_UUID).send('body-marker-3b7e');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      consoleSpies.forEach((spy) => spy.mockRestore());
    }

    expect(written.join('\n')).not.toMatch(/marker-3b7e/);
  });
});
