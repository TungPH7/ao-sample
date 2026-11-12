"use client";

import { useEffect, useRef, useState } from "react";

// The id of the Ghim or Bỏ ghim button of a note, so the view can give focus back to it once the note moved.
export function pinButtonId(noteId: string): string {
  return `pin-button-${noteId}`;
}

function hintId(noteId: string): string {
  return `pin-hint-${noteId}`;
}

const HINT = "Bỏ ghim một ghi chú để ghim ghi chú này";

const BUTTON =
  "inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded border bg-background px-3 md:h-8 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const OPEN = "border-border text-foreground hover:border-foreground";
const LOCKED = "cursor-not-allowed border-dashed border-muted text-muted";

interface PinButtonProps {
  noteId: string;
  // The id of the h3 of the note [S1.12], which the name of the button ends with.
  titleId: string;
  pinned: boolean;
  // MAX_PINNED_NOTES notes are pinned: a Ghim button is locked. A Bỏ ghim button never is.
  locked: boolean;
  pending: boolean;
  // The id of the pin error of the note [S1.19], while it shows.
  errorId?: string;
  // A count the view raises to open the hint as after a press, when the API refused a pin (AC10).
  openHint: number;
  // Called on a press of an open button only: a pending or locked button sends nothing (AC4, AC8).
  onPress: () => void;
}

// design.md S1.17 and S1.18 of SMP-23: the button, then the hint of a locked Ghim button, right of it from 768 px and
// below it under 768 px. The hint is drawn only on a locked button and is its description at all times; the eye sees
// it while the pointer is on the button or the hint, while the button has focus, and after a press until a press
// outside, a blur or Esc (plan of SMP-23, decision 8).
export default function PinButton({
  noteId,
  titleId,
  pinned,
  locked,
  pending,
  errorId,
  openHint,
  onPress,
}: PinButtonProps) {
  const isLocked = locked && !pinned;
  const id = pinButtonId(noteId);
  const area = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  // Raising openHint opens the hint in the same render, as a press would.
  const [openedFor, setOpenedFor] = useState(openHint);
  if (openHint !== openedFor) {
    setOpenedFor(openHint);
    setPressed(true);
  }

  const shown = isLocked && (hovered || focused || pressed);

  useEffect(() => {
    if (!shown) return;
    function onPointerDown(event: PointerEvent) {
      if (!area.current?.contains(event.target as Node)) setPressed(false);
    }
    // Esc hides the hint and leaves focus where it is; the next hover, focus or press shows it again.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setHovered(false);
      setFocused(false);
      setPressed(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shown]);

  function handleClick() {
    if (pending) return;
    if (isLocked) {
      setPressed(true);
      return;
    }
    onPress();
  }

  const describedBy = [isLocked ? hintId(noteId) : null, errorId ?? null].filter(Boolean).join(" ");

  return (
    <div
      ref={area}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="mt-3 flex w-fit max-w-full flex-col items-start gap-2 md:flex-row md:items-center md:gap-3"
    >
      <button
        id={id}
        type="button"
        aria-labelledby={`${id} ${titleId}`}
        aria-describedby={describedBy || undefined}
        aria-disabled={pending || isLocked ? true : undefined}
        aria-busy={pending ? true : undefined}
        onClick={handleClick}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setPressed(false);
        }}
        className={`${BUTTON} ${isLocked ? LOCKED : OPEN}`}
      >
        {pending ? (
          <span
            data-spinner
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : null}
        {pinned ? "Bỏ ghim" : "Ghim"}
      </button>
      {/* A div, not a p: a p in an item is the content of the note [S1.14] to the E2E tests of SMP-2, and every
          unpinned item holds this hint while 3 notes are pinned. */}
      {isLocked ? (
        <div id={hintId(noteId)} hidden={!shown} className="text-sm text-muted">
          {HINT}
        </div>
      ) : null}
    </div>
  );
}
