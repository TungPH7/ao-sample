import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import PinButton, { pinButtonId } from './pin-button';

// design.md S1.17 and S1.18 of SMP-23: the Ghim or Bỏ ghim button of one note, and the hint of a locked Ghim button.
const HINT = 'Bỏ ghim một ghi chú để ghim ghi chú này';
const TITLE_ID = 'note-title-a';
const ERROR_ID = 'pin-error-a';

interface Props {
  pinned?: boolean;
  locked?: boolean;
  pending?: boolean;
  errorId?: string;
  openHint?: number;
}

let onPress: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  onPress = vi.fn<() => void>();
});

afterEach(() => {
  cleanup();
});

function Item(props: Props) {
  return (
    <div>
      <h3 id={TITLE_ID}>Mua sữa</h3>
      <PinButton
        noteId="a"
        titleId={TITLE_ID}
        pinned={props.pinned ?? false}
        locked={props.locked ?? false}
        pending={props.pending ?? false}
        errorId={props.errorId}
        openHint={props.openHint ?? 0}
        onPress={onPress}
      />
      {props.errorId ? <p id={props.errorId}>Không ghim được ghi chú. Vui lòng thử lại.</p> : null}
      <button type="button">Khác</button>
    </div>
  );
}

function renderButton(props: Props = {}) {
  const view = render(<Item {...props} />);
  const button = document.getElementById(pinButtonId('a')) as HTMLButtonElement;
  return { ...view, button, rerender: (next: Props) => view.rerender(<Item {...next} />) };
}

// The text of the elements an IDREF list points at, as a screen reader joins them.
function textOf(ids: string | null): string {
  return (ids ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

function nameOf(button: HTMLElement): string {
  return textOf(button.getAttribute('aria-labelledby'));
}

function descriptionOf(button: HTMLElement): string {
  return textOf(button.getAttribute('aria-describedby'));
}

// The hint as the eye sees it: drawn and not hidden.
function visibleHint(): HTMLElement | null {
  const hint = screen.queryByText(HINT);
  return hint && !hint.closest('[hidden]') ? hint : null;
}

describe('the name of the button', () => {
  test('is "Ghim" then the title of its note, for a note that is not pinned', () => {
    const { button } = renderButton();
    expect(button.textContent).toBe('Ghim');
    expect(nameOf(button)).toBe('Ghim Mua sữa');
  });

  test('is "Bỏ ghim" then the title of its note, for a pinned note', () => {
    const { button } = renderButton({ pinned: true });
    expect(button.textContent).toBe('Bỏ ghim');
    expect(nameOf(button)).toBe('Bỏ ghim Mua sữa');
  });

  test('is a real button that does not submit a form', () => {
    const { button } = renderButton();
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
  });
});

describe('pressing the button while it is idle', () => {
  test('calls onPress once, with no disabled state', () => {
    const { button } = renderButton();
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  test('works for Bỏ ghim too', () => {
    const { button } = renderButton({ pinned: true });
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('the pending state (AC4)', () => {
  test('is aria-disabled and aria-busy, not disabled, so focus stays on it', () => {
    const { button } = renderButton({ pending: true });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  test('keeps its text and shows a decorative spinner before it', () => {
    const { button } = renderButton({ pinned: true, pending: true });
    expect(button.textContent).toBe('Bỏ ghim');
    const spinner = button.querySelector('[data-spinner]');
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    expect(button.firstElementChild).toBe(spinner);
  });

  test('sends nothing when pressed', () => {
    const { button } = renderButton({ pending: true });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('the locked state (AC8)', () => {
  test('is aria-disabled, not busy and not disabled, so it still takes Tab and focus', () => {
    const { button } = renderButton({ locked: true });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.tabIndex).toBe(0);
  });

  test('has the hint as its description, while the hint is hidden from the eye', () => {
    const { button } = renderButton({ locked: true });
    expect(descriptionOf(button)).toBe(HINT);
    expect(screen.getByText(HINT).hasAttribute('hidden')).toBe(true);
    expect(visibleHint()).toBeNull();
  });

  test('sends nothing when pressed, and shows the hint', () => {
    const { button } = renderButton({ locked: true });
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(visibleHint()).not.toBeNull();
  });

  test('is never applied to Bỏ ghim', () => {
    const { button } = renderButton({ pinned: true, locked: true });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('looks different from an open button by more than colour: a dashed border', () => {
    const { button } = renderButton({ locked: true });
    expect(button.className).toMatch(/\bborder-dashed\b/);
    expect(button.className).toMatch(/\bcursor-not-allowed\b/);
  });
});

describe('the hint of a locked button (S1.18)', () => {
  test('shows while the pointer is on the button, and goes when it leaves', () => {
    const { button } = renderButton({ locked: true });
    fireEvent.pointerEnter(button);
    expect(visibleHint()).not.toBeNull();
    fireEvent.pointerLeave(button);
    expect(visibleHint()).toBeNull();
  });

  test('stays while the pointer moves from the button onto the hint itself', () => {
    const { button } = renderButton({ locked: true });
    const area = button.parentElement!;
    fireEvent.pointerEnter(area);
    fireEvent.pointerEnter(screen.getByText(HINT));
    expect(visibleHint()).not.toBeNull();
    fireEvent.pointerLeave(area);
    expect(visibleHint()).toBeNull();
  });

  test('shows while the button has focus, and goes when focus leaves', () => {
    const { button } = renderButton({ locked: true });
    act(() => button.focus());
    expect(visibleHint()).not.toBeNull();
    act(() => screen.getByRole('button', { name: 'Khác' }).focus());
    expect(visibleHint()).toBeNull();
  });

  test('stays after a press once the pointer leaves, until a press outside', () => {
    const { button } = renderButton({ locked: true });
    fireEvent.pointerEnter(button);
    fireEvent.click(button);
    fireEvent.pointerLeave(button);
    expect(visibleHint()).not.toBeNull();

    fireEvent.pointerDown(screen.getByRole('heading'));
    expect(visibleHint()).toBeNull();
  });

  test('stays after a press on the hint itself', () => {
    const { button } = renderButton({ locked: true });
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByText(HINT));
    expect(visibleHint()).not.toBeNull();
  });

  test('goes on Esc without moving focus, and shows again on the next press', () => {
    const { button } = renderButton({ locked: true });
    act(() => button.focus());
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(visibleHint()).toBeNull();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    expect(visibleHint()).not.toBeNull();
  });

  test('goes on Esc while only the pointer is on it, and shows again when the pointer comes back', () => {
    const { button } = renderButton({ locked: true });
    fireEvent.pointerEnter(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(visibleHint()).toBeNull();

    fireEvent.pointerLeave(button);
    fireEvent.pointerEnter(button);
    expect(visibleHint()).not.toBeNull();
  });

  test('shows again when focus comes back after Esc', () => {
    const { button } = renderButton({ locked: true });
    act(() => button.focus());
    fireEvent.keyDown(button, { key: 'Escape' });
    act(() => button.blur());
    act(() => button.focus());
    expect(visibleHint()).not.toBeNull();
  });

  test('goes at once when the button opens again (AC9), even while it has focus', () => {
    const { button, rerender } = renderButton({ locked: true });
    act(() => button.focus());
    fireEvent.click(button);

    rerender({ locked: false });

    expect(screen.queryByText(HINT)).toBeNull();
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  test('opens as after a press when the view asks (AC10)', () => {
    const { rerender } = renderButton({ locked: true, openHint: 0 });
    expect(visibleHint()).toBeNull();

    rerender({ locked: true, openHint: 1 });
    expect(visibleHint()).not.toBeNull();

    fireEvent.pointerDown(screen.getByRole('heading'));
    expect(visibleHint()).toBeNull();
  });

  test('is not a tooltip and not a live region', () => {
    renderButton({ locked: true });
    const hint = screen.getByText(HINT);
    expect(hint.getAttribute('role')).toBeNull();
    expect(hint.getAttribute('aria-live')).toBeNull();
  });
});

describe('the description with a pin error (S1.19)', () => {
  test('is the error alone on an open button', () => {
    const { button } = renderButton({ errorId: ERROR_ID });
    expect(button.getAttribute('aria-describedby')).toBe(ERROR_ID);
  });

  test('is the hint then the error on a locked button', () => {
    const { button } = renderButton({ locked: true, errorId: ERROR_ID });
    expect(descriptionOf(button)).toBe(`${HINT} Không ghim được ghi chú. Vui lòng thử lại.`);
  });

  test('is nothing with no error on an open button', () => {
    const { button } = renderButton();
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });
});
