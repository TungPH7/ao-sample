import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotesLimitReachedException,
  PinnedNotesLimitReachedException,
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
      pinnedAt: null, // a new note is never pinned, whatever the body sends
    };
    if (!this.store.add(note)) {
      throw new NotesLimitReachedException();
    }
    return note;
  }

  list(): Note[] {
    return this.store.list();
  }

  // Pins the note at the time the API received the request, and answers the
  // list right after it (docs/specs/SMP-23/plan.md, API Contract). Pinning a
  // pinned note changes nothing.
  pin(id: string): Note[] {
    const result = this.store.pin(id, new Date().toISOString());
    if (result === 'NOT_FOUND') {
      throw new NotFoundException();
    }
    if (result === 'LIMIT_REACHED') {
      throw new PinnedNotesLimitReachedException();
    }
    return this.store.list();
  }

  // Unpins the note and answers the list right after it. Unpinning a note that
  // is not pinned changes nothing.
  unpin(id: string): Note[] {
    if (this.store.unpin(id) === 'NOT_FOUND') {
      throw new NotFoundException();
    }
    return this.store.list();
  }
}
