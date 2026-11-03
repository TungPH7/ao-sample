"use client";

import type { Note } from "@api/notes-shared";
import { useCallback, useEffect, useRef, useState } from "react";
import NoteForm from "./note-form";
import NoteList from "./note-list";
import { listNotes } from "./notes-api";

type ListState = { status: "loading" } | { status: "ready"; notes: Note[] } | { status: "error" };

// The notes in `first`, then those of `rest` that are not already there.
function putFirst(first: Note[], rest: Note[]): Note[] {
  const ids = new Set(first.map((note) => note.id));
  return [...first, ...rest.filter((note) => !ids.has(note.id))];
}

// design.md S1.3 and S1.10: the create form and the list, 32 px apart. The list loads once in the browser after
// hydration (plan decision 6), and a stored note joins it as plan decision 7 says. In this Story the loading and the
// error states draw nothing; Story "Xem danh sách ghi chú" adds them.
export default function NotesView() {
  const [list, setList] = useState<ListState>({ status: "loading" });
  // The state as of now, for a save that ends after the list changed.
  const current = useRef<ListState>(list);
  // Notes stored while the list was not ready, newest first, put on top once a GET answers.
  const unlisted = useRef<Note[]>([]);
  // The GET in flight, if any.
  const loading = useRef<AbortController | null>(null);

  const show = useCallback((next: ListState) => {
    current.current = next;
    setList(next);
  }, []);

  const load = useCallback(() => {
    const controller = new AbortController();
    loading.current = controller;
    listNotes(controller.signal)
      .then(
        (notes) => {
          show({ status: "ready", notes: putFirst(unlisted.current, notes) });
          unlisted.current = [];
        },
        () => {
          // Aborted on unmount: nothing to show. Any other failure keeps or shows the error state.
          if (!controller.signal.aborted) show({ status: "error" });
        },
      )
      .finally(() => {
        if (loading.current === controller) loading.current = null;
      });
  }, [show]);

  useEffect(() => {
    load();
    // React Strict Mode in next dev runs this twice; the first GET is aborted here.
    return () => loading.current?.abort();
  }, [load]);

  const handleCreated = useCallback(
    (note: Note) => {
      const now = current.current;
      if (now.status === "ready") {
        show({ status: "ready", notes: putFirst([note], now.notes) });
        return;
      }
      unlisted.current = [note, ...unlisted.current];
      // Decision 7: after a failed load, a save asks for the list once more, unless a GET is already on its way.
      if (now.status === "error" && !loading.current) load();
    },
    [load, show],
  );

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 id="create-note-heading" className="text-lg font-semibold">
          Tạo ghi chú
        </h2>
        <NoteForm onCreated={handleCreated} />
      </section>
      <section>
        <h2 id="notes-list-heading" className="text-lg font-semibold">
          Danh sách ghi chú
        </h2>
        {list.status === "ready" ? <NoteList notes={list.notes} /> : null}
      </section>
    </div>
  );
}
