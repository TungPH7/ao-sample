"use client";

import { isPinned, type Note } from "@api/notes-shared";
import { useCallback, useEffect, useRef, useState } from "react";
import NoteForm, { ErrorIcon } from "./note-form";
import NoteList, { isPinLimitReached } from "./note-list";
import { PinnedNotesLimitError, listNotes, pinNote, unpinNote } from "./notes-api";
import { LOAD_ERROR_ID, useNotePins } from "./use-note-pins";

type ListState = { status: "loading" } | { status: "ready"; notes: Note[] } | { status: "error" };

// Plan of SMP-23, decision 7: the notes this page saved that `notes` lacks go first among the notes that are not
// pinned, right below the pinned ones, newest first. Where a note stands, not a sort by time.
function withSaved(notes: Note[], saved: Note[]): Note[] {
  const ids = new Set(notes.map((note) => note.id));
  const missing = saved.filter((note) => !ids.has(note.id));
  if (missing.length === 0) return notes;
  const firstUnpinned = notes.findIndex((note) => !isPinned(note));
  const at = firstUnpinned === -1 ? notes.length : firstUnpinned;
  return [...notes.slice(0, at), ...missing, ...notes.slice(at)];
}

// design.md S1.3 and S1.10: the create form and the list, 32 px apart. The list loads once in the browser after
// hydration (decision 6 of SMP-2). Every request that answers a list (GET, PUT, DELETE) takes a number when it is
// sent, and only a list newer than the one shown is drawn (decision 7 of SMP-23).
export default function NotesView() {
  const [list, setList] = useState<ListState>({ status: "loading" });
  // The state as of now, for a request that ends after the list changed.
  const current = useRef<ListState>(list);
  // Notes this page saved, newest first, kept until a list that has them is drawn.
  const saved = useRef<Note[]>([]);
  // The number of the last request sent, and of the request whose list or error is shown.
  const sent = useRef(0);
  const shown = useRef(0);
  // The GET in flight, if any, and the signal that aborts every GET when the view goes away.
  const loading = useRef<AbortController | null>(null);
  const unmounted = useRef<AbortController | null>(null);
  const pins = useNotePins();

  const setState = useCallback((next: ListState) => {
    current.current = next;
    setList(next);
  }, []);

  // Draws the answer of request `number` unless a newer one is shown already; true when it was drawn.
  const showAnswer = useCallback(
    (number: number, notes: Note[] | null): boolean => {
      if (number <= shown.current) return false;
      shown.current = number;
      if (notes === null) {
        setState({ status: "error" });
        return true;
      }
      const ids = new Set(notes.map((note) => note.id));
      const next = withSaved(notes, saved.current);
      saved.current = saved.current.filter((note) => !ids.has(note.id));
      setState({ status: "ready", notes: next });
      return true;
    },
    [setState],
  );

  // One GET of the list. Answers the list, or null when it failed; throws only when the view went away.
  const fetchList = useCallback(async (): Promise<{ number: number; notes: Note[] | null }> => {
    const controller = new AbortController();
    loading.current = controller;
    const stop = () => controller.abort();
    unmounted.current?.signal.addEventListener("abort", stop);
    const number = ++sent.current;
    try {
      return { number, notes: await listNotes(controller.signal) };
    } catch (error) {
      if (controller.signal.aborted) throw error;
      return { number, notes: null };
    } finally {
      unmounted.current?.signal.removeEventListener("abort", stop);
      if (loading.current === controller) loading.current = null;
    }
  }, []);

  const load = useCallback(() => {
    fetchList().then(
      ({ number, notes }) => showAnswer(number, notes),
      () => undefined, // Aborted on unmount: nothing to show.
    );
  }, [fetchList, showAnswer]);

  useEffect(() => {
    const controller = new AbortController();
    unmounted.current = controller;
    load();
    // React Strict Mode in next dev runs this twice; the first GET is aborted here.
    return () => controller.abort();
  }, [load]);

  const handleCreated = useCallback(
    (note: Note) => {
      saved.current = [note, ...saved.current];
      const now = current.current;
      if (now.status === "ready") {
        // AC3: right below the pinned notes, with no GET.
        setState({ status: "ready", notes: withSaved(now.notes, [note]) });
        return;
      }
      // Decision 7 of SMP-2: after a failed load, a save asks for the list once more, unless a GET is on its way.
      if (now.status === "error" && !loading.current) load();
    },
    [load, setState],
  );

  const { start, succeeded, failed, refused, reloadFailed } = pins;
  const handlePress = useCallback(
    async (note: Note) => {
      if (!start(note.id)) return;
      const action = isPinned(note) ? "unpin" : "pin";
      const number = ++sent.current;
      try {
        const notes = await (action === "pin" ? pinNote(note.id) : unpinNote(note.id));
        showAnswer(number, notes);
        succeeded(note.id, action);
      } catch (error) {
        if (!(error instanceof PinnedNotesLimitError)) {
          failed(note.id, action);
          return;
        }
        // AC10: the list on the page was old. Load it once; the button stays pending meanwhile.
        let answer: Awaited<ReturnType<typeof fetchList>>;
        try {
          answer = await fetchList();
        } catch {
          return; // The view went away.
        }
        const drawn = showAnswer(answer.number, answer.notes);
        if (answer.notes === null) {
          if (drawn) reloadFailed(note.id);
          else refused(note.id, false);
          return;
        }
        const after = answer.notes.find((other) => other.id === note.id);
        refused(note.id, after !== undefined && !isPinned(after) && isPinLimitReached(answer.notes));
      }
    },
    [failed, fetchList, refused, reloadFailed, showAnswer, start, succeeded],
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
        {list.status === "loading" ? (
          LIST_SKELETON
        ) : list.status === "error" ? (
          <LoadError focusable={pins.loadErrorFocusable} />
        ) : list.notes.length === 0 ? (
          <p role="status" className="mt-4 text-muted">
            Chưa có ghi chú nào.
          </p>
        ) : (
          <NoteList
            notes={list.notes}
            pending={pins.pending}
            errors={pins.errors}
            hints={pins.hints}
            announcement={pins.announcement}
            onPress={handlePress}
          />
        )}
      </section>
    </div>
  );
}

// design.md S1.15: the load error in place of the list. It takes focus, with tabindex="-1", only when it replaced the
// list after a refused pin (AC10 of SMP-23), so focus does not fall to the top of the document.
function LoadError({ focusable }: { focusable: boolean }) {
  return (
    <p
      id={LOAD_ERROR_ID}
      role="alert"
      tabIndex={focusable ? -1 : undefined}
      className="mt-4 flex items-center gap-2 text-error focus:outline-none"
    >
      <ErrorIcon className="size-5" />
      Không tải được danh sách ghi chú. Vui lòng thử lại.
    </p>
  );
}

// Three rows as tall as a note with one line of content, with no text. The form stays usable meanwhile.
const LIST_SKELETON = (
  <div aria-busy="true" className="mt-4 flex flex-col gap-4">
    {[0, 1, 2].map((row) => (
      <div key={row} className="h-13 rounded bg-border/20 motion-safe:animate-pulse" />
    ))}
  </div>
);
