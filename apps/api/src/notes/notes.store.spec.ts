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
