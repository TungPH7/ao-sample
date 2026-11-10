import { Injectable } from '@nestjs/common';
import type { Note } from './notes.shared.js';

// The most notes the store holds, so that a public API cannot fill the memory of
// its container (SMP-18). It is the volume the NFR of docs/specs/SMP-2/spec.md uses.
export const MAX_NOTES = 1000;

// The notes of the one API process, kept in memory in the order the API
// received them (plan of SMP-2, decision 5). A singleton provider of NotesModule.
@Injectable()
export class NotesStore {
  private readonly notes: Note[] = [];

  // Answers whether the note was stored: a full store keeps the notes it has.
  add(note: Note): boolean {
    if (this.notes.length >= MAX_NOTES) {
      return false;
    }
    this.notes.push(note);
    return true;
  }

  // Newest first, by the order of adding rather than by createdAt, so two notes
  // of the same millisecond keep their order. A copy: callers cannot change the store.
  list(): Note[] {
    return this.notes.toReversed();
  }
}
