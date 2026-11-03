import type { Note } from '@api/notes-shared';

// design.md S1.11, S1.12 and S1.14, the basic version of Story "Tạo ghi chú": newest first, an h3 title and the
// content, which is not drawn when empty. Story "Xem danh sách ghi chú" adds the time, the dividers and the wrapping.
// Titles and contents reach the page only as React text, so markup in them shows as typed (AC12).
export default function NoteList({ notes }: { notes: Note[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {notes.map((note) => (
        <li key={note.id}>
          <h3 className="font-medium">{note.title}</h3>
          {note.content === "" ? null : <p>{note.content}</p>}
        </li>
      ))}
    </ul>
  );
}
