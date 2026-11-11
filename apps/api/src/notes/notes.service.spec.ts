import { BadRequestException } from '@nestjs/common';
import {
  NotesLimitReachedException,
  ValidationFailedException,
} from '../common/api-error.js';
import { NotesService } from './notes.service.js';
import { MAX_NOTES, NotesStore } from './notes.store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function thrownBy(act: () => unknown): unknown {
  try {
    act();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('NotesService', () => {
  let store: NotesStore;
  let service: NotesService;

  beforeEach(() => {
    store = new NotesStore();
    service = new NotesService(store);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create', () => {
    it('answers a new note with a random id and the time the API received it', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-02T07:40:00.123Z'));

      const created = service.create({ title: 'Mua sữa', content: '2 hộp' });

      expect(created).toStrictEqual({
        id: expect.stringMatching(UUID),
        title: 'Mua sữa',
        content: '2 hộp',
        createdAt: '2026-11-02T07:40:00.123Z',
        pinnedAt: null,
      });
    });

    it('stores the note it answers', () => {
      const created = service.create({ title: 'Mua sữa', content: '2 hộp' });

      expect(store.list()).toStrictEqual([created]);
    });

    it('gives every note its own id', () => {
      const first = service.create({ title: 'A' });
      const second = service.create({ title: 'A' });

      expect(first.id).not.toBe(second.id);
    });

    it('stores an empty content when none is sent', () => {
      expect(service.create({ title: 'Mua sữa' }).content).toBe('');
    });

    it('stores the normalized values: NFC, \\n line breaks, a trimmed title', () => {
      const created = service.create({
        title: '  Cafe\u0301\r\n ',
        content: 'Cafe\u0301\r\nline\rend',
      });

      expect(created.title).toBe('Caf\u00e9');
      expect(created.content).toBe('Caf\u00e9\nline\nend');
    });

    it('ignores the id, createdAt, pinnedAt and any other field sent', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-02T07:40:00.000Z'));

      const created = service.create({
        title: 'A',
        id: 'chosen-by-client',
        createdAt: '1999-01-01T00:00:00.000Z',
        pinnedAt: '2000-01-01T00:00:00.000Z',
        isAdmin: true,
      });

      expect(created).toStrictEqual({
        id: expect.stringMatching(UUID),
        title: 'A',
        content: '',
        createdAt: '2026-11-02T07:40:00.000Z',
        pinnedAt: null,
      });
    });

    it('ignores a __proto__ field of a parsed JSON body', () => {
      const body: unknown = JSON.parse(
        '{"title":"A","__proto__":{"title":"B","isAdmin":true}}',
      );

      const created = service.create(body);

      expect(created.title).toBe('A');
      expect(Object.getPrototypeOf(created)).toBe(Object.prototype);
      expect('isAdmin' in created).toBe(false);
    });

    it('reads a title that only an inherited property has as not sent', () => {
      const body = Object.create({ title: 'Inherited' }) as object;

      const error = thrownBy(() => service.create(body));

      expect(error).toBeInstanceOf(ValidationFailedException);
      expect((error as ValidationFailedException).fields).toStrictEqual([
        { field: 'title', code: 'REQUIRED' },
      ]);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an array', [{ title: 'A' }]],
      ['a string', 'A'],
      ['a number', 1],
      ['a boolean', true],
    ])('throws a plain BadRequestException for %s and stores nothing', (_name, body) => {
      const error = thrownBy(() => service.create(body));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).not.toBeInstanceOf(ValidationFailedException);
      expect(store.list()).toEqual([]);
    });

    it('throws ValidationFailedException with every wrong field and stores nothing', () => {
      const error = thrownBy(() =>
        service.create({ title: 'x'.repeat(101), content: null }),
      );

      expect(error).toBeInstanceOf(ValidationFailedException);
      expect((error as ValidationFailedException).fields).toStrictEqual([
        { field: 'title', code: 'TOO_LONG' },
        { field: 'content', code: 'INVALID_TYPE' },
      ]);
      expect(store.list()).toEqual([]);
    });

    it('throws ValidationFailedException with title REQUIRED for an empty object', () => {
      const error = thrownBy(() => service.create({}));

      expect((error as ValidationFailedException).fields).toStrictEqual([
        { field: 'title', code: 'REQUIRED' },
      ]);
    });
  });

  describe('create when the store is full', () => {
    beforeEach(() => {
      for (let i = 0; i < MAX_NOTES; i++) {
        service.create({ title: `N${i}` });
      }
    });

    it('throws NotesLimitReachedException and stores nothing', () => {
      const error = thrownBy(() => service.create({ title: 'One too many' }));

      expect(error).toBeInstanceOf(NotesLimitReachedException);
      expect(store.list()).toHaveLength(MAX_NOTES);
      expect(store.list()[0].title).toBe(`N${MAX_NOTES - 1}`);
    });

    it('still answers the error of a wrong body first', () => {
      const error = thrownBy(() => service.create({ title: '' }));

      expect(error).toBeInstanceOf(ValidationFailedException);
    });
  });

  describe('list', () => {
    it('answers the stored notes newest first', () => {
      const first = service.create({ title: 'First' });
      const second = service.create({ title: 'Second' });

      expect(service.list()).toStrictEqual([second, first]);
    });
  });
});
