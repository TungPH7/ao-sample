import type { Note } from '@api/notes-shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import NoteList, { type Announcement } from './note-list';

// The time of a note follows the zone of the machine (design.md S1.13); pin it to UTC+7.
let savedTz: string | undefined;

beforeEach(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'Asia/Ho_Chi_Minh';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

function note(id: string, title: string, content: string): Note {
  return { id, title, content, createdAt: '2026-11-02T07:40:00.000Z', pinnedAt: null };
}

describe('the note list', () => {
  test('shows the notes in the order given, each with an h3 title and its content', () => {
    render(<NoteList notes={[note('b', 'Mua sữa', '2 hộp'), note('a', 'Gọi mẹ', 'Tối nay')]} />);

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => within(li).getByRole('heading', { level: 3 }).textContent)).toEqual(['Mua sữa', 'Gọi mẹ']);
    expect(within(items[0]).getByText('2 hộp')).toBeTruthy();
    expect(within(items[1]).getByText('Tối nay')).toBeTruthy();
  });

  test('is a list for screen readers even though Tailwind removes its bullets', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', '2 hộp')]} />);

    expect(screen.getByRole('list').getAttribute('role')).toBe('list');
  });

  test('shows when each note was created, as a time element with the ISO value', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', '2 hộp')]} />);

    const time = screen.getByRole('listitem').querySelector('time');
    expect(time?.textContent).toBe('02/11/2026 14:40');
    expect(time?.getAttribute('datetime')).toBe('2026-11-02T07:40:00.000Z');
  });

  test('keeps every line break of the content', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', 'Dòng một\n\nDòng ba')]} />);

    const content = screen.getByText(/Dòng một/);
    expect(content.textContent).toBe('Dòng một\n\nDòng ba');
  });

  test('draws nothing for an empty content, only the title, the time and the pin button', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', '')]} />);

    const item = screen.getByRole('listitem');
    expect(item.querySelector('p')).toBeNull();
    expect(item.textContent).toBe('Mua sữa02/11/2026 14:40Ghim');
  });

  test('shows markup in a note as plain text', () => {
    render(<NoteList notes={[note('a', '<b>đậm</b>', '<script>alert(1)</script>')]} />);

    const item = screen.getByRole('listitem');
    expect(item.querySelector('b, script')).toBeNull();
    expect(within(item).getByRole('heading', { level: 3 }).textContent).toBe('<b>đậm</b>');
    expect(within(item).getByText('<script>alert(1)</script>')).toBeTruthy();
  });

  test('shows a link in a note as text, not as a link', () => {
    render(<NoteList notes={[note('a', 'https://example.com', 'Xem https://example.com')]} />);

    expect(screen.queryByRole('link')).toBeNull();
  });

  test('has exactly one thing per item that takes Tab: its pin button', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', '2 hộp'), pinned('b', 'Gọi mẹ')]} />);

    for (const item of screen.getAllByRole('listitem')) {
      const tabbable = item.querySelectorAll('a, button, input, textarea, select, [tabindex]');
      expect(tabbable).toHaveLength(1);
      expect(tabbable[0].tagName).toBe('BUTTON');
    }
  });
});

// SMP-23: design.md S1.11, S1.12, S1.16 to S1.20.
const PINNED_MARK = 'Đã ghim';
const HINT = 'Bỏ ghim một ghi chú để ghim ghi chú này';
const PIN_ERROR = 'Không ghim được ghi chú. Vui lòng thử lại.';
const UNPIN_ERROR = 'Không bỏ ghim được ghi chú. Vui lòng thử lại.';

function pinned(id: string, title: string): Note {
  return { id, title, content: '', createdAt: '2026-11-02T07:40:00.000Z', pinnedAt: '2026-11-11T03:00:00.000Z' };
}

function itemOf(title: string): HTMLElement {
  return screen.getByRole('heading', { level: 3, name: title }).closest('li')!;
}

function buttonOf(title: string): HTMLButtonElement {
  return itemOf(title).querySelector('button')!;
}

// The text of the elements an IDREF list points at, as a screen reader joins them.
function textOf(ids: string | null): string {
  return (ids ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

function follows(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('the pinned mark (S1.16)', () => {
  test('shows "Đã ghim" on a pinned note, before its title in the DOM', () => {
    render(<NoteList notes={[pinned('a', 'Mã cửa')]} />);

    const item = itemOf('Mã cửa');
    const mark = within(item).getByText(PINNED_MARK);
    expect(follows(mark, within(item).getByRole('heading', { level: 3 }))).toBe(true);
    expect(item.textContent?.startsWith(PINNED_MARK)).toBe(true);
  });

  test('has a decorative icon, so a screen reader reads only the words', () => {
    render(<NoteList notes={[pinned('a', 'Mã cửa')]} />);

    const mark = within(itemOf('Mã cửa')).getByText(PINNED_MARK);
    expect(mark.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(mark.textContent).toBe(PINNED_MARK);
  });

  test('is not drawn on a note that is not pinned', () => {
    render(<NoteList notes={[pinned('a', 'Mã cửa'), note('b', 'Mua sữa', '')]} />);

    expect(within(itemOf('Mua sữa')).queryByText(PINNED_MARK)).toBeNull();
    expect(screen.getAllByText(PINNED_MARK)).toHaveLength(1);
  });
});

describe('the title of each note (S1.12)', () => {
  test('has its own id, which the name of the pin button ends with', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', ''), pinned('b', 'Mã cửa')]} />);

    expect(screen.getByRole('heading', { name: 'Mua sữa' }).id).toBe('note-title-a');
    expect(screen.getByRole('heading', { name: 'Mã cửa' }).id).toBe('note-title-b');
    expect(textOf(buttonOf('Mua sữa').getAttribute('aria-labelledby'))).toBe('Ghim Mua sữa');
    expect(textOf(buttonOf('Mã cửa').getAttribute('aria-labelledby'))).toBe('Bỏ ghim Mã cửa');
  });
});

describe('the pin button of each note (S1.17)', () => {
  test('comes after the content', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', '2 hộp')]} />);

    expect(follows(screen.getByText('2 hộp'), buttonOf('Mua sữa'))).toBe(true);
  });

  test('tells onPress which note was pressed', () => {
    const onPress = vi.fn();
    render(<NoteList notes={[note('a', 'Mua sữa', ''), pinned('b', 'Mã cửa')]} onPress={onPress} />);

    fireEvent.click(buttonOf('Mã cửa'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(pinned('b', 'Mã cửa'));
  });

  test('is pending on the notes the view says, and only there', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', ''), note('b', 'Gọi mẹ', '')]} pending={new Set(['a'])} />);

    expect(buttonOf('Mua sữa').getAttribute('aria-busy')).toBe('true');
    expect(buttonOf('Gọi mẹ').hasAttribute('aria-busy')).toBe(false);
  });

  test('is open on every note while fewer than 3 notes are pinned', () => {
    render(<NoteList notes={[pinned('p1', 'P1'), pinned('p2', 'P2'), note('a', 'A', '')]} />);

    for (const button of screen.getAllByRole('button')) expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByText(HINT)).toBeNull();
  });

  test('locks every Ghim button once 3 notes are pinned, and no Bỏ ghim button (AC8)', () => {
    const onPress = vi.fn();
    render(
      <NoteList
        notes={[pinned('p1', 'P1'), pinned('p2', 'P2'), pinned('p3', 'P3'), note('a', 'A', ''), note('b', 'B', '')]}
        onPress={onPress}
      />,
    );

    for (const title of ['A', 'B']) {
      expect(buttonOf(title).getAttribute('aria-disabled')).toBe('true');
      expect(textOf(buttonOf(title).getAttribute('aria-describedby'))).toBe(HINT);
    }
    for (const title of ['P1', 'P2', 'P3']) expect(buttonOf(title).hasAttribute('aria-disabled')).toBe(false);

    fireEvent.click(buttonOf('A'));
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.click(buttonOf('P2'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('locks and opens in the very render the count of pinned notes reaches or leaves 3 (AC9)', () => {
    const three = [pinned('p1', 'P1'), pinned('p2', 'P2'), pinned('p3', 'P3'), note('a', 'A', '')];
    const two = [pinned('p1', 'P1'), pinned('p2', 'P2'), note('a', 'A', ''), note('p3', 'P3', '')];
    const { rerender } = render(<NoteList notes={two} />);
    expect(buttonOf('A').hasAttribute('aria-disabled')).toBe(false);

    rerender(<NoteList notes={three} />);
    expect(buttonOf('A').getAttribute('aria-disabled')).toBe('true');

    rerender(<NoteList notes={two} />);
    expect(buttonOf('A').hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByText(HINT)).toBeNull();
  });

  test('opens the hint of the note the view names (AC10)', () => {
    const notes = [pinned('p1', 'P1'), pinned('p2', 'P2'), pinned('p3', 'P3'), note('a', 'A', ''), note('b', 'B', '')];
    const { rerender } = render(<NoteList notes={notes} />);

    rerender(<NoteList notes={notes} hints={new Map([['a', 1]])} />);

    const shown = screen.getAllByText(HINT).filter((hint) => !hint.hidden);
    expect(shown).toEqual([within(itemOf('A')).getByText(HINT)]);
  });
});

describe('the pin error of a note (S1.19)', () => {
  test('shows the pin error in the item of its note only, after the pin button, as an alert', () => {
    render(<NoteList notes={[note('a', 'A', ''), note('b', 'B', '')]} errors={new Map([['a', 'pin' as const]])} />);

    const error = within(itemOf('A')).getByRole('alert');
    expect(error.textContent).toBe(PIN_ERROR);
    expect(error.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(follows(buttonOf('A'), error)).toBe(true);
    expect(within(itemOf('B')).queryByRole('alert')).toBeNull();
    expect(screen.getAllByText(PIN_ERROR)).toHaveLength(1);
  });

  test('shows the unpin error for a failed unpin', () => {
    render(<NoteList notes={[pinned('a', 'A')]} errors={new Map([['a', 'unpin' as const]])} />);

    expect(within(itemOf('A')).getByRole('alert').textContent).toBe(UNPIN_ERROR);
  });

  test('is the description of the pin button of its note', () => {
    render(<NoteList notes={[note('a', 'A', ''), note('b', 'B', '')]} errors={new Map([['a', 'pin' as const]])} />);

    expect(textOf(buttonOf('A').getAttribute('aria-describedby'))).toBe(PIN_ERROR);
    expect(buttonOf('B').hasAttribute('aria-describedby')).toBe(false);
  });

  test('stays on a locked button, whose description is then the hint and the error', () => {
    const notes = [pinned('p1', 'P1'), pinned('p2', 'P2'), pinned('p3', 'P3'), note('a', 'A', '')];
    render(<NoteList notes={notes} errors={new Map([['a', 'pin' as const]])} />);

    expect(within(itemOf('A')).getByRole('alert').textContent).toBe(PIN_ERROR);
    expect(textOf(buttonOf('A').getAttribute('aria-describedby'))).toBe(`${HINT} ${PIN_ERROR}`);
  });
});

describe('the announcer for screen readers (S1.20)', () => {
  function status(): HTMLElement {
    return screen.getByRole('status');
  }

  test('is an empty status region hidden from the eye, next to the ul, not inside it', () => {
    render(<NoteList notes={[note('a', 'A', '')]} />);

    expect(status().textContent).toBe('');
    expect(status().className).toMatch(/\bsr-only\b/);
    expect(status().parentElement).toBe(screen.getByRole('list').parentElement);
    expect(screen.getByRole('list').contains(status())).toBe(false);
  });

  test('clears itself, then says the message one tick later', () => {
    vi.useFakeTimers();
    const { rerender } = render(<NoteList notes={[note('a', 'A', '')]} />);

    const message: Announcement = { text: 'Đã ghim ghi chú.' };
    rerender(<NoteList notes={[note('a', 'A', '')]} announcement={message} />);
    expect(status().textContent).toBe('');
    act(() => vi.advanceTimersByTime(0));
    expect(status().textContent).toBe('Đã ghim ghi chú.');
  });

  test('says the same message again when it is announced twice in a row', () => {
    vi.useFakeTimers();
    const notes = [note('a', 'A', '')];
    const { rerender } = render(<NoteList notes={notes} announcement={{ text: 'Đã bỏ ghim ghi chú.' }} />);
    act(() => vi.advanceTimersByTime(0));
    expect(status().textContent).toBe('Đã bỏ ghim ghi chú.');

    rerender(<NoteList notes={notes} announcement={{ text: 'Đã bỏ ghim ghi chú.' }} />);
    expect(status().textContent).toBe('');
    act(() => vi.advanceTimersByTime(0));
    expect(status().textContent).toBe('Đã bỏ ghim ghi chú.');
  });
});
