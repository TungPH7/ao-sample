import { Injectable } from '@nestjs/common';
import { MAX_PINNED_NOTES, type Note } from './notes.shared.js';

// The most notes the store holds, so that a public API cannot fill the memory of
// its container (SMP-18). It is the volume the NFR of docs/specs/SMP-2/spec.md uses.
export const MAX_NOTES = 1000;

export type PinResult = 'PINNED' | 'ALREADY_PINNED' | 'NOT_FOUND' | 'LIMIT_REACHED';
export type UnpinResult = 'UNPINNED' | 'NOT_PINNED' | 'NOT_FOUND';

// The notes of the one API process, kept in memory in the order the API
// received them (plan of SMP-2, decision 5). A singleton provider of NotesModule.
//
// Pins follow decision 3 of docs/specs/SMP-23/plan.md: the store keeps the ids of
// the pinned notes in the order it received the pins, rather than sorting by
// pinnedAt, so two pins of the same millisecond keep their order. pin() and
// unpin() are synchronous on purpose: with no await between the check of the
// limit and the pin, two requests cannot both take the last place.
@Injectable()
export class NotesStore {
  private readonly notes: Note[] = [];
  // The place of each note in `notes`. A Map, so an id such as __proto__ or
  // constructor finds nothing.
  private readonly places = new Map<string, number>();
  // Oldest pin first; at most MAX_PINNED_NOTES ids.
  private readonly pinned: string[] = [];

  // Answers whether the note was stored: a full store keeps the notes it has.
  add(note: Note): boolean {
    if (this.notes.length >= MAX_NOTES) {
      return false;
    }
    this.places.set(note.id, this.notes.length);
    this.notes.push(note);
    return true;
  }

  // Checks in the order of the API Contract: the id, then whether the note is
  // pinned already, then the limit.
  pin(id: string, at: string): PinResult {
    const place = this.places.get(id);
    if (place === undefined) {
      return 'NOT_FOUND';
    }
    if (this.pinned.includes(id)) {
      return 'ALREADY_PINNED';
    }
    if (this.pinned.length >= MAX_PINNED_NOTES) {
      return 'LIMIT_REACHED';
    }
    this.replace(place, at);
    this.pinned.push(id);
    return 'PINNED';
  }

  unpin(id: string): UnpinResult {
    const place = this.places.get(id);
    if (place === undefined) {
      return 'NOT_FOUND';
    }
    const index = this.pinned.indexOf(id);
    if (index === -1) {
      return 'NOT_PINNED';
    }
    this.replace(place, null);
    this.pinned.splice(index, 1);
    return 'UNPINNED';
  }

  // The pinned notes first, the earliest pin on top and each later pin right
  // below, so the top of the list stays put when a note is pinned (Rules 1 and 4
  // of docs/specs/SMP-23/spec.md); then the other notes, newest first by the
  // order of adding rather than by createdAt, so two notes of the same
  // millisecond keep their order. A copy: callers cannot change the store.
  list(): Note[] {
    const pinned = this.pinned.map((id) => this.noteOf(id));
    const pinnedIds = new Set(this.pinned);
    const unpinned = this.notes.filter(({ id }) => !pinnedIds.has(id));
    return [...pinned, ...unpinned.toReversed()];
  }

  // A new object, so a note handed out before never changes under its holder.
  private replace(place: number, pinnedAt: string | null): void {
    this.notes[place] = { ...this.notes[place], pinnedAt };
  }

  private noteOf(id: string): Note {
    return this.notes[this.places.get(id) as number];
  }
}
