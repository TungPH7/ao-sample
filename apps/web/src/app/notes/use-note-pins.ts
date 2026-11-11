"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Announcement, PinAction } from "./note-list";
import { pinButtonId } from "./pin-button";

export const LOAD_ERROR_ID = "notes-load-error";

const HINT = "Bỏ ghim một ghi chú để ghim ghi chú này";
const SUCCESS: Record<PinAction, string> = {
  pin: "Đã ghim ghi chú.",
  unpin: "Đã bỏ ghim ghi chú.",
};

type FocusRequest = { kind: "button"; noteId: string } | { kind: "load-error" };

// Plan of SMP-23, decisions 8 and 9: the state of each note, kept by id apart from the list, so it stays when the
// list is replaced; the announcer [S1.20]; and where focus goes once the answer of a note is drawn.
export function useNotePins() {
  // Set on press, before any redraw, so a second press that arrives first still sends nothing (AC4).
  const pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, PinAction>>(() => new Map());
  const [hints, setHints] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);

  // After the redraw: the button of the note gets focus back when focus is on it or fell to the body, as when React
  // moved its li, or Safari did not focus it on a click. Focus somewhere else stays there. No preventScroll, so the
  // browser scrolls the button into view (design.md S1.17).
  useLayoutEffect(() => {
    if (!focus) return;
    const active = document.activeElement;
    const atBody = active === null || active === document.body;
    if (focus.kind === "load-error") {
      if (atBody) document.getElementById(LOAD_ERROR_ID)?.focus();
      return;
    }
    const button = document.getElementById(pinButtonId(focus.noteId));
    if (button && (atBody || active === button)) button.focus();
  }, [focus]);

  const end = useCallback((noteId: string) => {
    pendingRef.current.delete(noteId);
    setPending(new Set(pendingRef.current));
  }, []);

  // A press on an open button: false when the note is waiting for the API already. Clears its error as the request
  // is sent (design.md S1.19).
  const start = useCallback((noteId: string): boolean => {
    if (pendingRef.current.has(noteId)) return false;
    pendingRef.current.add(noteId);
    setPending(new Set(pendingRef.current));
    setErrors((now) => {
      if (!now.has(noteId)) return now;
      const next = new Map(now);
      next.delete(noteId);
      return next;
    });
    return true;
  }, []);

  const succeeded = useCallback(
    (noteId: string, action: PinAction) => {
      end(noteId);
      setAnnouncement({ text: SUCCESS[action] });
      setFocus({ kind: "button", noteId });
    },
    [end],
  );

  const failed = useCallback(
    (noteId: string, action: PinAction) => {
      end(noteId);
      setErrors((now) => new Map(now).set(noteId, action));
      setFocus({ kind: "button", noteId });
    },
    [end],
  );

  // AC10: the API refused the pin and the list came again. When it locks the button, open its hint as after a press
  // and read the hint; otherwise the button is open and nothing is said.
  const refused = useCallback(
    (noteId: string, lockedNow: boolean) => {
      end(noteId);
      if (lockedNow) {
        setHints((now) => new Map(now).set(noteId, (now.get(noteId) ?? 0) + 1));
        setAnnouncement({ text: HINT });
      }
      setFocus({ kind: "button", noteId });
    },
    [end],
  );

  // AC10, then the list could not load again: the load error [S1.15] takes the focus the removed button held.
  const reloadFailed = useCallback(
    (noteId: string) => {
      end(noteId);
      setFocus({ kind: "load-error" });
    },
    [end],
  );

  return {
    pending,
    errors,
    hints,
    announcement,
    loadErrorFocusable: focus?.kind === "load-error",
    start,
    succeeded,
    failed,
    refused,
    reloadFailed,
  };
}
