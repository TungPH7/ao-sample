"use client";

import type { Note } from "@api/notes-shared";
import { useRef, useState, type FormEvent } from "react";
import { createNote } from "./notes-api";

const FIELD =
  "rounded border border-border bg-background px-3 py-2 text-base focus:border-accent focus:outline-2 " +
  "focus:outline-offset-2 focus:outline-focus-ring focus:ring-1 focus:ring-inset focus:ring-accent";

// design.md S1.3 to S1.9. Story "Báo lỗi nhập ngay cạnh ô" adds the checks of each field ([5], [7]); until then a
// wrong value reaches the API, which answers 400, and the form shows the save error [8] (plan decision 8).
export default function NoteForm({ onCreated }: { onCreated: (note: Note) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // AC7: set on submit, before any redraw, so a second press that arrives first still sends nothing.
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      const note = await createNote({ title, content });
      setTitle("");
      setContent("");
      onCreated(note);
      titleRef.current?.focus();
    } catch {
      setSaveFailed(true);
      saveRef.current?.focus();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <form noValidate aria-labelledby="create-note-heading" onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="note-title">Tiêu đề</label>
        <input
          ref={titleRef}
          id="note-title"
          name="title"
          type="text"
          autoComplete="off"
          aria-required="true"
          readOnly={saving}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={FIELD}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="note-content">Nội dung</label>
        <textarea
          id="note-content"
          name="content"
          rows={4}
          readOnly={saving}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className={`${FIELD} resize-y`}
        />
      </div>
      {saveFailed ? (
        <p role="alert" className="flex items-center gap-2 text-error">
          <ErrorIcon />
          Không lưu được ghi chú. Vui lòng thử lại.
        </p>
      ) : null}
      <button
        ref={saveRef}
        type="submit"
        aria-disabled={saving ? true : undefined}
        aria-busy={saving ? true : undefined}
        className={
          "inline-flex min-h-11 w-full items-center justify-center gap-2 self-start rounded bg-accent px-6 " +
          "font-medium text-background hover:bg-[color-mix(in_srgb,var(--accent)_85%,black)] " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring md:w-auto"
        }
      >
        {saving ? (
          <span
            data-spinner
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : null}
        Lưu
      </button>
    </form>
  );
}

function ErrorIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-5 shrink-0">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-.75-11.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
