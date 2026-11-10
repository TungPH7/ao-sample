"use client";

import type { Note } from "@api/notes-shared";
import { useCallback, useEffect, useRef, useState } from "react";
import NoteForm, { ErrorIcon } from "./note-form";
import NoteList from "./note-list";
import { listNotes } from "./notes-api";

type ListState = { status: "loading" } | { status: "ready"; notes: Note[] } | { status: "error" };

// The notes in `first`, then those of `rest` that are not already there.
function putFirst(first: Note[], rest: Note[]): Note[] {
  const ids = new Set(first.map((note) => note.id));
  return [...first, ...rest.filter((note) => !ids.has(note.id))];
}

// design.md S1.3 and S1.10: the create form and the list, 32 px apart. The list loads once in the browser after
// hydration (plan decision 6), and a stored note joins it as plan decision 7 says.
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
      <section aria-labelledby="notes-list-heading">
        <h2 id="notes-list-heading" className="text-lg font-semibold">
          Danh sách ghi chú
        </h2>
        <ListBody list={list} />
      </section>
    </div>
  );
}

// design.md S1.11 and S1.15: right below the h2, exactly one of the skeleton, the list, the empty message and the
// load error.
function ListBody({ list }: { list: ListState }) {
  if (list.status === "loading") return LIST_SKELETON;
  if (list.status === "error") {
    return (
      <p role="alert" className="mt-4 flex items-center gap-2 text-error">
        <ErrorIcon className="size-5" />
        Không tải được danh sách ghi chú. Vui lòng thử lại.
      </p>
    );
  }
  if (list.notes.length === 0) {
    return (
      <p role="status" className="mt-4 text-muted">
        Chưa có ghi chú nào.
      </p>
    );
  }
  return <NoteList notes={list.notes} />;
}

// Three rows as tall as a note with one line of content, with no text. The form stays usable meanwhile.
const LIST_SKELETON = (
  <div aria-busy="true" className="mt-4 flex flex-col gap-4">
    {[0, 1, 2].map((row) => (
      <div key={row} className="h-13 rounded bg-border/20 motion-safe:animate-pulse" />
    ))}
  </div>
);
