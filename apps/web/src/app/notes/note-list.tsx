import { MAX_PINNED_NOTES, isPinned, type Note } from '@api/notes-shared';
import { useEffect, useState } from 'react';
import { formatCreatedAt } from './format-created-at';
import { ErrorIcon } from './note-form';
import PinButton from './pin-button';

export type PinAction = 'pin' | 'unpin';

// One message for the announcer [S1.20]. A new object says its text again, even the same text as the last one.
export interface Announcement {
  text: string;
}

const PIN_ERRORS: Record<PinAction, string> = {
  pin: 'Không ghim được ghi chú. Vui lòng thử lại.',
  unpin: 'Không bỏ ghim được ghi chú. Vui lòng thử lại.',
};

// True when the list holds MAX_PINNED_NOTES pinned notes, so every Ghim button is locked (plan of SMP-23, decision 7).
export function isPinLimitReached(notes: Note[]): boolean {
  return notes.filter(isPinned).length >= MAX_PINNED_NOTES;
}

export function noteTitleId(noteId: string): string {
  return `note-title-${noteId}`;
}

function pinErrorId(noteId: string): string {
  return `pin-error-${noteId}`;
}

interface NoteListProps {
  notes: Note[];
  // Per note, by id (plan of SMP-23, decision 8): the notes waiting for the API, the last failed action of each, and
  // a count the view raises to open the hint of a locked Ghim button.
  pending?: ReadonlySet<string>;
  errors?: ReadonlyMap<string, PinAction>;
  hints?: ReadonlyMap<string, number>;
  announcement?: Announcement | null;
  onPress?: (note: Note) => void;
}

const NONE = new Set<string>();
const NO_ERRORS = new Map<string, PinAction>();
const NO_HINTS = new Map<string, number>();

// design.md S1.11 to S1.14 of SMP-2 and S1.11 to S1.20 of SMP-23: in the order the API answers, the pinned notes
// first. Items are split by a 1 px line with 16 px on each side of it. Each item has the pinned mark [16] when the note
// is pinned, the h3 title [12] and the time it was created [13], on one row from 768 px and stacked below it, the
// content [14], which is not drawn when empty, the pin button [17] and the pin error [19]. Titles and contents reach
// the page only as React text, so markup in them shows as typed and a URL is not a link (AC12 of SMP-2).
export default function NoteList({
  notes,
  pending = NONE,
  errors = NO_ERRORS,
  hints = NO_HINTS,
  announcement = null,
  onPress,
}: NoteListProps) {
  const locked = isPinLimitReached(notes);
  return (
    <>
      {/* role="list": Tailwind's preflight removes the bullets, and Safari with VoiceOver then stops reading a ul as a list. */}
      <ul role="list" className="mt-4 divide-y divide-border">
        {notes.map((note) => {
          const pinned = isPinned(note);
          const error = errors.get(note.id);
          return (
            <li key={note.id} className="py-4 first:pt-0 last:pb-0">
              {pinned ? <PinnedMark /> : null}
              <div className="flex flex-col md:flex-row md:items-baseline md:justify-between md:gap-4">
                <h3 id={noteTitleId(note.id)} className="min-w-0 font-medium wrap-anywhere">
                  {note.title}
                </h3>
                <time dateTime={note.createdAt} className="shrink-0 text-sm whitespace-nowrap text-muted">
                  {formatCreatedAt(note.createdAt)}
                </time>
              </div>
              {note.content === '' ? null : <p className="mt-1 whitespace-pre-wrap wrap-anywhere">{note.content}</p>}
              <PinButton
                noteId={note.id}
                titleId={noteTitleId(note.id)}
                pinned={pinned}
                locked={locked}
                pending={pending.has(note.id)}
                errorId={error ? pinErrorId(note.id) : undefined}
                openHint={hints.get(note.id) ?? 0}
                onPress={() => onPress?.(note)}
              />
              {error ? (
                <p id={pinErrorId(note.id)} role="alert" className="mt-2 flex items-center gap-2 text-error">
                  <ErrorIcon className="size-5" />
                  {PIN_ERRORS[error]}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Announcer announcement={announcement} />
    </>
  );
}

// design.md S1.16: a chip on its own line above the title, the words in --accent with a decorative pin before them.
function PinnedMark() {
  return (
    <p className="mb-2 flex w-fit items-center gap-1 rounded border border-accent bg-background px-2 py-0.5 text-sm font-medium text-accent">
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4 shrink-0">
        <path d="M7 2h6a1 1 0 1 1 0 2h-.5v4.17l2.3 2.3c.63.64.18 1.71-.71 1.71h-3.34v5.07a.75.75 0 0 1-1.5 0v-5.07H5.91c-.89 0-1.34-1.07-.7-1.7l2.29-2.3V4H7a1 1 0 0 1 0-2Z" />
      </svg>
      Đã ghim
    </p>
  );
}

// design.md S1.20: one status region for the whole list, hidden from the eye, there from the first render of the
// list. Each message empties it first and comes one tick later, so the same message twice in a row is read twice
// (plan of SMP-23, decision 10).
function Announcer({ announcement }: { announcement: Announcement | null }) {
  const [text, setText] = useState('');
  const [said, setSaid] = useState(announcement);
  if (announcement !== said) {
    setSaid(announcement);
    setText('');
  }

  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setText(announcement.text), 0);
    return () => clearTimeout(timer);
  }, [announcement]);

  return (
    <p role="status" className="sr-only">
      {text}
    </p>
  );
}
