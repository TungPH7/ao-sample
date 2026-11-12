import { MAX_NOTES, NotesStore } from './notes.store.js';
import type { Note } from './notes.shared.js';

function note(id: string, createdAt = '2026-11-02T07:40:00.000Z'): Note {
  return { id, title: `Title ${id}`, content: '', createdAt, pinnedAt: null };
}

describe('NotesStore', () => {
  it('lists nothing when no note was added', () => {
    const store = new NotesStore();

    expect(store.list()).toEqual([]);
  });

  it('lists the notes newest first, in the order they were added', () => {
    const store = new NotesStore();
    store.add(note('a', '2026-11-02T07:40:00.000Z'));
    store.add(note('b', '2026-11-02T07:41:00.000Z'));
    store.add(note('c', '2026-11-02T07:42:00.000Z'));

    expect(store.list().map(({ id }) => id)).toEqual(['c', 'b', 'a']);
  });

  it('keeps the order of adding for two notes of the same millisecond', () => {
    const store = new NotesStore();
    const sameMillisecond = '2026-11-02T07:40:00.000Z';
    store.add(note('first', sameMillisecond));
    store.add(note('second', sameMillisecond));

    expect(store.list().map(({ id }) => id)).toEqual(['second', 'first']);
  });

  it('answers a copy, so changing the list does not change the store', () => {
    const store = new NotesStore();
    store.add(note('a'));

    const listed = store.list();
    listed.pop();
    listed.push(note('intruder'));

    expect(store.list().map(({ id }) => id)).toEqual(['a']);
  });

  it('does not reorder the store when it lists', () => {
    const store = new NotesStore();
    store.add(note('a'));
    store.add(note('b'));

    store.list();

    expect(store.list().map(({ id }) => id)).toEqual(['b', 'a']);
  });

  describe('the limit of notes', () => {
    function storeHolding(count: number): NotesStore {
      const store = new NotesStore();
      for (let i = 0; i < count; i++) {
        store.add(note(`n${i}`));
      }
      return store;
    }

    it('holds at most 1000 notes', () => {
      expect(MAX_NOTES).toBe(1000);
    });

    it('answers true when it stores a note', () => {
      expect(new NotesStore().add(note('a'))).toBe(true);
    });

    it('still stores the last note that fits', () => {
      const store = storeHolding(MAX_NOTES - 1);

      expect(store.add(note('last'))).toBe(true);

      expect(store.list()).toHaveLength(MAX_NOTES);
      expect(store.list()[0].id).toBe('last');
    });

    it('answers false and stores nothing once it is full', () => {
      const store = storeHolding(MAX_NOTES);

      expect(store.add(note('one-too-many'))).toBe(false);

      expect(store.list()).toHaveLength(MAX_NOTES);
      expect(store.list().map(({ id }) => id)).not.toContain('one-too-many');
    });
  });
});

describe('NotesStore pins', () => {
  const T1 = '2026-11-11T03:00:00.000Z';
  const T2 = '2026-11-11T03:05:00.000Z';
  const T3 = '2026-11-11T03:10:00.000Z';
  const T4 = '2026-11-11T03:15:00.000Z';

  // A store holding the given notes, added in this order, all unpinned.
  function storeWith(...ids: string[]): NotesStore {
    const store = new NotesStore();
    for (const id of ids) {
      store.add(note(id));
    }
    return store;
  }

  function ids(store: NotesStore): string[] {
    return store.list().map(({ id }) => id);
  }

  function pinnedIds(store: NotesStore): string[] {
    return store
      .list()
      .filter(({ pinnedAt }) => pinnedAt !== null)
      .map(({ id }) => id);
  }

  describe('pin', () => {
    it('answers PINNED, records the time and moves the note to the top when no note is pinned', () => {
      const store = storeWith('a', 'b', 'c');

      expect(store.pin('a', T1)).toBe('PINNED');

      expect(ids(store)).toEqual(['a', 'c', 'b']);
      expect(store.list()[0]).toStrictEqual({ ...note('a'), pinnedAt: T1 });
    });

    it('lists the earliest pin first and a later pin right below it (AC2)', () => {
      // C and D are not pinned, D added after C.
      const store = storeWith('a', 'b', 'c', 'd');

      store.pin('a', T1);
      store.pin('b', T2);

      expect(ids(store)).toEqual(['a', 'b', 'd', 'c']);
    });

    it('puts a new pin at the bottom of the pinned notes and keeps the places of the others (AC1)', () => {
      const store = storeWith('a', 'b', 'c', 'd', 'e');
      store.pin('d', T1);
      store.pin('a', T2);

      store.pin('c', T3);

      expect(ids(store)).toEqual(['d', 'a', 'c', 'e', 'b']);
    });

    it('keeps the order of the requests for pins of the same millisecond', () => {
      const store = storeWith('a', 'b', 'c', 'd');

      store.pin('b', T1);
      store.pin('a', T1);
      expect(ids(store)).toEqual(['b', 'a', 'd', 'c']);

      store.pin('c', T1);
      expect(ids(store)).toEqual(['b', 'a', 'c', 'd']);
    });

    it('keeps the id, title, content and createdAt of the note', () => {
      const store = new NotesStore();
      const original: Note = {
        id: 'a',
        title: 'Mã cửa',
        content: '4821',
        createdAt: '2026-11-11T01:00:00.000Z',
        pinnedAt: null,
      };
      store.add(original);

      store.pin('a', T1);

      expect(store.list()).toStrictEqual([{ ...original, pinnedAt: T1 }]);
    });

    it('puts a note added after a pin at the top of the unpinned notes', () => {
      const store = storeWith('a', 'b');
      store.pin('a', T1);

      store.add(note('e'));

      expect(ids(store)).toEqual(['a', 'e', 'b']);
    });

    describe('when the note is already pinned', () => {
      it('answers ALREADY_PINNED and keeps its pinnedAt and its place', () => {
        const store = storeWith('a', 'b', 'c');
        store.pin('a', T1);
        store.pin('b', T2);
        const before = store.list();

        expect(store.pin('a', T3)).toBe('ALREADY_PINNED');

        expect(store.list()).toStrictEqual(before);
        expect(store.list()[0]).toMatchObject({ id: 'a', pinnedAt: T1 });
      });

      it('answers ALREADY_PINNED even when 3 notes are pinned', () => {
        const store = storeWith('a', 'b', 'c', 'd');
        store.pin('a', T1);
        store.pin('b', T2);
        store.pin('c', T3);
        const before = store.list();

        expect(store.pin('b', T4)).toBe('ALREADY_PINNED');

        expect(store.list()).toStrictEqual(before);
      });
    });

    describe('the limit of pinned notes', () => {
      it('pins a third note when 2 are pinned', () => {
        const store = storeWith('a', 'b', 'c', 'd');
        store.pin('a', T1);
        store.pin('b', T2);

        expect(store.pin('c', T3)).toBe('PINNED');

        expect(pinnedIds(store)).toEqual(['a', 'b', 'c']);
      });

      it('answers LIMIT_REACHED for a fourth note and changes nothing', () => {
        const store = storeWith('a', 'b', 'c', 'd');
        store.pin('a', T1);
        store.pin('b', T2);
        store.pin('c', T3);
        const before = store.list();

        expect(store.pin('d', T4)).toBe('LIMIT_REACHED');

        expect(store.list()).toStrictEqual(before);
        expect(pinnedIds(store)).toEqual(['a', 'b', 'c']);
      });

      it('pins again once one of the 3 is unpinned', () => {
        const store = storeWith('a', 'b', 'c', 'd');
        store.pin('a', T1);
        store.pin('b', T2);
        store.pin('c', T3);
        store.unpin('b');

        expect(store.pin('d', T4)).toBe('PINNED');

        expect(pinnedIds(store)).toEqual(['a', 'c', 'd']);
      });
    });
  });

  describe('unpin', () => {
    it('answers UNPINNED and clears pinnedAt', () => {
      const store = storeWith('a');
      store.pin('a', T1);

      expect(store.unpin('a')).toBe('UNPINNED');

      expect(store.list()).toStrictEqual([note('a')]);
    });

    it('puts the note back in its place by the order of creating', () => {
      // A was created after C and before D (AC6).
      const store = storeWith('c', 'a', 'd');
      store.pin('a', T1);
      expect(ids(store)).toEqual(['a', 'd', 'c']);

      store.unpin('a');

      expect(ids(store)).toEqual(['d', 'a', 'c']);
    });

    it('puts the note back in its place among notes of the same millisecond', () => {
      // note() gives every note the same createdAt.
      const store = storeWith('first', 'second', 'third');
      store.pin('second', T1);

      store.unpin('second');

      expect(ids(store)).toEqual(['third', 'second', 'first']);
    });

    it('keeps the order of the other pinned notes', () => {
      const store = storeWith('a', 'b', 'c', 'd');
      store.pin('a', T1);
      store.pin('b', T2);
      store.pin('c', T3);

      store.unpin('b');

      expect(ids(store)).toEqual(['a', 'c', 'd', 'b']);
    });

    it('answers NOT_PINNED for a note that is not pinned and changes nothing', () => {
      const store = storeWith('a', 'b');
      store.pin('a', T1);
      const before = store.list();

      expect(store.unpin('b')).toBe('NOT_PINNED');

      expect(store.list()).toStrictEqual(before);
    });

    it('puts a note pinned again at the bottom of the pinned notes with its new time, not back in its old place', () => {
      const store = storeWith('a', 'b', 'c', 'd');
      store.pin('a', T1);
      store.pin('b', T2);
      store.pin('c', T3);
      store.unpin('a');

      expect(store.pin('a', T4)).toBe('PINNED');

      expect(ids(store)).toEqual(['b', 'c', 'a', 'd']);
      expect(store.list()[2].pinnedAt).toBe(T4);
    });
  });

  describe('an id the store does not hold', () => {
    it.each([
      ['an unknown id', 'nope'],
      ['an empty id', ''],
      ['__proto__', '__proto__'],
      ['constructor', 'constructor'],
      ['toString', 'toString'],
      ['hasOwnProperty', 'hasOwnProperty'],
    ])('pin answers NOT_FOUND for %s and changes nothing', (_name, id) => {
      const store = storeWith('a', 'b');
      store.pin('a', T1);
      const before = store.list();

      expect(store.pin(id, T2)).toBe('NOT_FOUND');

      expect(store.list()).toStrictEqual(before);
    });

    it.each([
      ['an unknown id', 'nope'],
      ['__proto__', '__proto__'],
      ['constructor', 'constructor'],
    ])('unpin answers NOT_FOUND for %s and changes nothing', (_name, id) => {
      const store = storeWith('a', 'b');
      store.pin('a', T1);
      const before = store.list();

      expect(store.unpin(id)).toBe('NOT_FOUND');

      expect(store.list()).toStrictEqual(before);
    });

    it('answers NOT_FOUND before LIMIT_REACHED', () => {
      const store = storeWith('a', 'b', 'c');
      store.pin('a', T1);
      store.pin('b', T2);
      store.pin('c', T3);

      expect(store.pin('nope', T4)).toBe('NOT_FOUND');
    });
  });

  describe('the notes it has handed out', () => {
    it('answers a copy of the list when notes are pinned', () => {
      const store = storeWith('a', 'b');
      store.pin('a', T1);

      const listed = store.list();
      listed.reverse();
      listed.pop();

      expect(ids(store)).toEqual(['a', 'b']);
    });

    it('does not change a note it handed out when that note is pinned', () => {
      const store = storeWith('a');
      const handedOut = store.list()[0];

      store.pin('a', T1);

      expect(handedOut.pinnedAt).toBeNull();
      expect(store.list()[0]).not.toBe(handedOut);
    });

    it('does not change a note it handed out when that note is unpinned', () => {
      const store = storeWith('a');
      store.pin('a', T1);
      const handedOut = store.list()[0];

      store.unpin('a');

      expect(handedOut.pinnedAt).toBe(T1);
      expect(store.list()[0].pinnedAt).toBeNull();
    });

    it('keeps its own pin state when a caller changes a note it handed out', () => {
      const store = storeWith('a', 'b');
      store.list()[1].pinnedAt = T1;

      expect(store.pin('a', T2)).toBe('PINNED');
      expect(store.unpin('b')).toBe('NOT_PINNED');
      expect(pinnedIds(store)).toEqual(['a']);
    });
  });
});
