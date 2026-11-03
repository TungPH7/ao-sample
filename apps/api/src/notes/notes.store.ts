import { Injectable } from '@nestjs/common';
import type { Note } from './notes.shared.js';

// The notes of the one API process, kept in memory in the order the API
// received them (plan of SMP-2, decision 5). A singleton provider of NotesModule.
@Injectable()
export class NotesStore {
  private readonly notes: Note[] = [];

  add(note: Note): void {
    this.notes.push(note);
  }

  // Newest first, by the order of adding rather than by createdAt, so two notes
  // of the same millisecond keep their order. A copy: callers cannot change the store.
  list(): Note[] {
    return this.notes.toReversed();
  }
}
