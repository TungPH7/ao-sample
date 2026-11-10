import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotesLimitReachedException,
  ValidationFailedException,
} from '../common/api-error.js';
import { checkNote, type Note } from './notes.shared.js';
import { NotesStore } from './notes.store.js';

// An own property only, so nothing inherited, such as a polluted prototype, is read.
function ownField(body: object, name: 'title' | 'content'): unknown {
  return Object.hasOwn(body, name)
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

@Injectable()
export class NotesService {
  constructor(private readonly store: NotesStore) {}

  // Checks a request body by the rules of notes.shared.ts and stores a new note
  // (plan of SMP-2, decisions 4 and 5). Only title and content are read: the
  // note is built anew, never spread from the body. Nothing is stored on error.
  create(body: unknown): Note {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException();
    }
    const checked = checkNote({
      title: ownField(body, 'title'),
      content: ownField(body, 'content'),
    });
    if (!checked.ok) {
      throw new ValidationFailedException(checked.errors);
    }
    const note: Note = {
      id: randomUUID(),
      title: checked.value.title,
      content: checked.value.content,
      createdAt: new Date().toISOString(),
    };
    if (!this.store.add(note)) {
      throw new NotesLimitReachedException();
    }
    return note;
  }

  list(): Note[] {
    return this.store.list();
  }
}
