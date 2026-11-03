import type { Note } from '@api/notes-shared';
import { formatCreatedAt } from './format-created-at';

// design.md S1.11 to S1.14: newest first, items split by a 1 px line with 16 px on each side of it. Each item has an
// h3 title [12] and the time it was created [13], on one row from 768 px and stacked below it, then the content [14],
// which is not drawn when empty. Titles and contents reach the page only as React text, so markup in them shows as
// typed and a URL is not a link (AC12).
export default function NoteList({ notes }: { notes: Note[] }) {
  return (
    // role="list": Tailwind's preflight removes the bullets, and Safari with VoiceOver then stops reading a ul as a list.
    <ul role="list" className="mt-4 divide-y divide-border">
      {notes.map((note) => (
        <li key={note.id} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-col md:flex-row md:items-baseline md:justify-between md:gap-4">
            <h3 className="min-w-0 font-medium wrap-anywhere">{note.title}</h3>
            <time dateTime={note.createdAt} className="shrink-0 text-sm whitespace-nowrap text-muted">
              {formatCreatedAt(note.createdAt)}
            </time>
          </div>
          {note.content === '' ? null : <p className="mt-1 whitespace-pre-wrap wrap-anywhere">{note.content}</p>}
        </li>
      ))}
    </ul>
  );
}
