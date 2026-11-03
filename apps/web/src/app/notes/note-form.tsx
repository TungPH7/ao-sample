"use client";

import { checkContent, checkTitle, type Note } from "@api/notes-shared";
import { useRef, useState, type FormEvent } from "react";
import { createNote } from "./notes-api";

const FIELD =
  "rounded border bg-background px-3 py-2 text-base focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring";
// The border and the inner ring add up to the 2 px of design.md S1.4 and S1.6, without moving what is below.
const FIELD_OK = "border-border focus:border-accent focus:ring-1 focus:ring-inset focus:ring-accent";
const FIELD_ERROR = "border-error ring-1 ring-inset ring-error";

const TITLE_ERRORS = {
  REQUIRED: "Vui lòng nhập tiêu đề",
  TOO_LONG: "Tiêu đề tối đa 100 ký tự",
} as const;
const CONTENT_TOO_LONG = "Nội dung tối đa 1000 ký tự";

const TITLE_ERROR_ID = "note-title-error";
const CONTENT_ERROR_ID = "note-content-error";

// design.md S1.3 to S1.9. Each field is checked with the rules the API applies (ADR-0001), on every key press and
// with no debounce, so its error [5] or [7] changes in the redraw of that key.
export default function NoteForm({ onCreated }: { onCreated: (note: Note) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  // "Vui lòng nhập tiêu đề" is shown only once the title was left empty or Lưu was pressed, and stays while the title
  // stays empty. Every other error follows the value, so it is worked out on each render.
  const [titleRequiredShown, setTitleRequiredShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // AC7: set on submit, before any redraw, so a second press that arrives first still sends nothing.
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  const titleCheck = checkTitle(title);
  const titleError =
    titleCheck === "TOO_LONG" || (titleCheck === "REQUIRED" && titleRequiredShown) ? TITLE_ERRORS[titleCheck] : null;
  const contentError = checkContent(content) === "TOO_LONG" ? CONTENT_TOO_LONG : null;

  function handleTitleChange(value: string) {
    setTitle(value);
    if (checkTitle(value) !== "REQUIRED") setTitleRequiredShown(false);
  }

  function handleTitleBlur() {
    if (checkTitle(title) === "REQUIRED") setTitleRequiredShown(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // AC3, AC4, AC5: a wrong field sends nothing, and the cursor goes to the first one, Tiêu đề then Nội dung.
    if (titleCheck !== null || contentError !== null) {
      if (titleCheck === "REQUIRED") setTitleRequiredShown(true);
      (titleCheck !== null ? titleRef : contentRef).current?.focus();
      return;
    }

    inFlight.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      const note = await createNote({ title, content });
      setTitle("");
      setContent("");
      setTitleRequiredShown(false);
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
      {/* No name on either field: a submit before hydration then puts no note text in the URL. */}
      <div className="flex flex-col gap-1">
        <label htmlFor="note-title">Tiêu đề</label>
        <input
          ref={titleRef}
          id="note-title"
          type="text"
          autoComplete="off"
          aria-required="true"
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? TITLE_ERROR_ID : undefined}
          readOnly={saving}
          value={title}
          onChange={(event) => handleTitleChange(event.target.value)}
          onBlur={handleTitleBlur}
          className={`${FIELD} ${titleError ? FIELD_ERROR : FIELD_OK}`}
        />
        <FieldError id={TITLE_ERROR_ID} message={titleError} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="note-content">Nội dung</label>
        <textarea
          ref={contentRef}
          id="note-content"
          rows={4}
          aria-invalid={contentError ? true : undefined}
          aria-describedby={contentError ? CONTENT_ERROR_ID : undefined}
          readOnly={saving}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className={`${FIELD} ${contentError ? FIELD_ERROR : FIELD_OK} resize-y`}
        />
        <FieldError id={CONTENT_ERROR_ID} message={contentError} />
      </div>
      {saveFailed ? (
        <p role="alert" className="flex items-center gap-2 text-error">
          <ErrorIcon className="size-5" />
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

// design.md S1.5 and S1.7: always one 20 px line, even when empty, so an error that shows up does not push Lưu down
// while it is being pressed. A polite live region, so an error that shows up while typing is read once.
function FieldError({ id, message }: { id: string; message: string | null }) {
  return (
    <p id={id} aria-live="polite" className="flex min-h-5 items-center gap-1 text-sm text-error">
      {message ? (
        <>
          <ErrorIcon className="size-4" />
          {message}
        </>
      ) : null}
    </p>
  );
}

function ErrorIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={`${className} shrink-0`}>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-.75-11.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
