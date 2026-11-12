import type { Note } from '@api/notes-shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import NotesView from './notes-view';

// Integration of the view, the form and the list, with fetch faked (plan of SMP-2, Story 4, Sub-task FE). The NFR
// "Số yêu cầu tới API": one GET when the page opens, one POST per save, and no GET after a save while the list is
// ready (decision 7).

function note(id: string, title: string): Note {
  return { id, title, content: '', createdAt: '2026-11-02T07:40:00.000Z', pinnedAt: null };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface Call {
  method: string;
  url: string;
  signal: AbortSignal | null | undefined;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}

// Every request waits until the test answers it, and fails like the browser once its signal aborts.
function fakeApi() {
  const calls: Call[] = [];
  const fn = vi.fn(
    (url: string, init: RequestInit = {}) =>
      new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        calls.push({ method: init.method ?? 'GET', url, signal: init.signal, resolve, reject });
      }),
  );
  const of = (method: string) => calls.filter((c) => c.method === method);
  return { fn, gets: () => of('GET'), posts: () => of('POST'), puts: () => of('PUT'), deletes: () => of('DELETE') };
}

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
  vi.stubGlobal('fetch', api.fn);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle(call: Call, response: Response | Error) {
  await act(async () => {
    if (response instanceof Error) call.reject(response);
    else call.resolve(response);
  });
}

function save(title: string) {
  fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: title } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
}

function listedTitles(): string[] {
  const list = screen.queryByRole('list');
  if (!list) return [];
  return within(list)
    .queryAllByRole('heading', { level: 3 })
    .map((h) => h.textContent ?? '');
}

describe('opening the page', () => {
  test('sends exactly one GET', () => {
    render(<NotesView />);
    expect(api.fn).toHaveBeenCalledTimes(1);
    expect(api.gets()).toHaveLength(1);
  });

  test('shows the notes the API answers, in its order', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({ data: [note('b', 'B'), note('a', 'A')] }));
    expect(listedTitles()).toEqual(['B', 'A']);
  });

  test('keeps the form usable while the list loads', () => {
    render(<NotesView />);
    expect(screen.getByLabelText('Tiêu đề')).toHaveProperty('readOnly', false);
  });

  test('aborts the GET when the view goes away', () => {
    const { unmount } = render(<NotesView />);
    const [get] = api.gets();
    unmount();
    expect(get.signal?.aborted).toBe(true);
  });

  test('shows no list while the GET fails', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({}, 500));
    expect(screen.queryByRole('list')).toBeNull();
  });
});

// design.md S1.11 and S1.15: exactly one of the skeleton, the list, the empty message and the load error.
const EMPTY = 'Chưa có ghi chú nào.';
const LOAD_ERROR = 'Không tải được danh sách ghi chú. Vui lòng thử lại.';

function skeleton(): HTMLElement | null {
  return document.querySelector('[aria-busy="true"]');
}

describe('the state of the list', () => {
  test('shows three skeleton rows with no text while the GET is on its way', () => {
    render(<NotesView />);

    const busy = skeleton();
    expect(busy?.children).toHaveLength(3);
    expect(busy?.textContent).toBe('');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('AC11 shows the list in place of the skeleton once the GET answers notes', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({ data: [note('a', 'A')] }));

    expect(listedTitles()).toEqual(['A']);
    expect(skeleton()).toBeNull();
    // The only status is the empty announcer of SMP-23 [S1.20], not the empty-list message.
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('AC10 shows "Chưa có ghi chú nào." as a status in place of the list when there is no note', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({ data: [] }));

    expect(screen.getByRole('status').textContent).toBe(EMPTY);
    expect(screen.queryByRole('list')).toBeNull();
    expect(skeleton()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('AC13 shows the load error as an alert, with a decorative icon, when the API answers 500', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({}, 500));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(LOAD_ERROR);
    expect(alert.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(skeleton()).toBeNull();
  });

  test('AC13 shows the load error when the network fails', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], new TypeError('Failed to fetch'));

    expect(screen.getByRole('alert').textContent).toBe(LOAD_ERROR);
  });

  test('AC13 shows the load error once 10 s pass without an answer, not before', async () => {
    vi.useFakeTimers();
    render(<NotesView />);

    await act(() => vi.advanceTimersByTimeAsync(9_999));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(skeleton()).not.toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('alert').textContent).toBe(LOAD_ERROR);
    expect(api.gets()[0].signal?.aborted).toBe(true);
  });

  test('replaces "Chưa có ghi chú nào." by the list when a note is saved', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({ data: [] }));

    save('Mua sữa');
    await settle(api.posts()[0], json(note('n', 'Mua sữa'), 201));

    expect(listedTitles()).toEqual(['Mua sữa']);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

describe('saving while the list is ready', () => {
  test('sends one POST and puts the stored note first, with no new GET', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({ data: [note('a', 'A')] }));

    save('Mua sữa');
    await settle(api.posts()[0], json(note('n', 'Mua sữa'), 201));

    expect(api.posts()).toHaveLength(1);
    expect(api.gets()).toHaveLength(1);
    expect(listedTitles()).toEqual(['Mua sữa', 'A']);
  });

  test('puts each new note first, one POST each', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({ data: [] }));

    save('Một');
    await settle(api.posts()[0], json(note('1', 'Một'), 201));
    save('Hai');
    await settle(api.posts()[1], json(note('2', 'Hai'), 201));

    expect(api.posts()).toHaveLength(2);
    expect(api.gets()).toHaveLength(1);
    expect(listedTitles()).toEqual(['Hai', 'Một']);
  });

  test('sends one POST when Lưu is pressed twice', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({ data: [] }));

    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Mua sữa' } });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    });
    await settle(api.posts()[0], json(note('n', 'Mua sữa'), 201));

    expect(api.posts()).toHaveLength(1);
    expect(listedTitles()).toEqual(['Mua sữa']);
  });

  test('shows the save error once 10 s pass without an answer, and the list is unchanged', async () => {
    vi.useFakeTimers();
    render(<NotesView />);
    await settle(api.gets()[0], json({ data: [note('a', 'A')] }));

    save('Mua sữa');
    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(screen.getByRole('alert').textContent).toBe('Không lưu được ghi chú. Vui lòng thử lại.');
    expect(screen.getByLabelText('Tiêu đề')).toHaveProperty('value', 'Mua sữa');
    expect(listedTitles()).toEqual(['A']);
    expect(api.posts()[0].signal?.aborted).toBe(true);
  });
});

describe('saving while the list is still loading', () => {
  test('keeps the note when the GET answers without it, first in the list', async () => {
    render(<NotesView />);
    save('Mua sữa');
    await settle(api.posts()[0], json(note('n', 'Mua sữa'), 201));

    await settle(api.gets()[0], json({ data: [note('a', 'A')] }));

    expect(listedTitles()).toEqual(['Mua sữa', 'A']);
    expect(api.gets()).toHaveLength(1);
  });

  test('shows the note once when the GET answers with it too', async () => {
    render(<NotesView />);
    save('Mua sữa');
    await settle(api.posts()[0], json(note('n', 'Mua sữa'), 201));

    await settle(api.gets()[0], json({ data: [note('n', 'Mua sữa'), note('a', 'A')] }));

    expect(listedTitles()).toEqual(['Mua sữa', 'A']);
  });

  test('puts the note first when the GET answers before the POST does', async () => {
    render(<NotesView />);
    save('Mua sữa');
    await settle(api.gets()[0], json({ data: [note('a', 'A')] }));

    await settle(api.posts()[0], json(note('n', 'Mua sữa'), 201));

    expect(listedTitles()).toEqual(['Mua sữa', 'A']);
    expect(api.gets()).toHaveLength(1);
  });

  test('keeps every note saved while loading, newest first', async () => {
    render(<NotesView />);
    save('Một');
    await settle(api.posts()[0], json(note('1', 'Một'), 201));
    save('Hai');
    await settle(api.posts()[1], json(note('2', 'Hai'), 201));

    await settle(api.gets()[0], json({ data: [note('1', 'Một'), note('a', 'A')] }));

    expect(listedTitles()).toEqual(['Hai', 'Một', 'A']);
  });
});

describe('saving while the list failed to load', () => {
  test('sends one more GET and shows the list it answers', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({}, 500));

    save('Mua sữa');
    await settle(api.posts()[0], json(note('n', 'Mua sữa'), 201));

    expect(api.gets()).toHaveLength(2);
    expect(screen.queryByRole('list')).toBeNull();
    // Decision 7: the load error stays while that GET is on its way, with no skeleton.
    expect(screen.getByRole('alert').textContent).toBe(LOAD_ERROR);
    expect(skeleton()).toBeNull();
    await settle(api.gets()[1], json({ data: [note('n', 'Mua sữa'), note('a', 'A')] }));
    expect(listedTitles()).toEqual(['Mua sữa', 'A']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('keeps the saved note when the new GET answers without it', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], new TypeError('Failed to fetch'));

    save('Mua sữa');
    await settle(api.posts()[0], json(note('n', 'Mua sữa'), 201));
    await settle(api.gets()[1], json({ data: [note('a', 'A')] }));

    expect(listedTitles()).toEqual(['Mua sữa', 'A']);
  });

  test('stays without a list, and sends no third GET, when the new GET fails too', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({}, 500));

    save('Mua sữa');
    await settle(api.posts()[0], json(note('n', 'Mua sữa'), 201));
    await settle(api.gets()[1], json({}, 500));

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(LOAD_ERROR);
    expect(api.gets()).toHaveLength(2);
  });

  test('sends one GET for two saves made while it is still loading', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({}, 500));

    save('Một');
    await settle(api.posts()[0], json(note('1', 'Một'), 201));
    save('Hai');
    await settle(api.posts()[1], json(note('2', 'Hai'), 201));

    expect(api.gets()).toHaveLength(2);
    await settle(api.gets()[1], json({ data: [note('1', 'Một')] }));
    expect(listedTitles()).toEqual(['Hai', 'Một']);
  });

  test('aborts that GET when the view goes away', async () => {
    const { unmount } = render(<NotesView />);
    await settle(api.gets()[0], json({}, 500));
    save('Mua sữa');
    await settle(api.posts()[0], json(note('n', 'Mua sữa'), 201));

    unmount();

    expect(api.gets()[1].signal?.aborted).toBe(true);
  });
});

// SMP-23, plan decisions 7, 8 and 9: pin and unpin from the list, with fetch faked. The NFR "Số yêu cầu tới API":
// one PUT or DELETE per press, no GET after a success, exactly one GET after a 409.
const PINNED_AT = '2026-11-11T03:00:00.000Z';
const PIN_ERROR = 'Không ghim được ghi chú. Vui lòng thử lại.';
const UNPIN_ERROR = 'Không bỏ ghim được ghi chú. Vui lòng thử lại.';
const HINT = 'Bỏ ghim một ghi chú để ghim ghi chú này';
const LIMIT_REACHED = { error: { code: 'PINNED_NOTES_LIMIT_REACHED', message: 'The limit of pinned notes is reached.' } };

function pinnedNote(id: string, title: string): Note {
  return { ...note(id, title), pinnedAt: PINNED_AT };
}

function itemOf(title: string): HTMLElement {
  return screen.getByRole('heading', { level: 3, name: title }).closest('li')!;
}

function buttonOf(title: string): HTMLButtonElement {
  return itemOf(title).querySelector('button')!;
}

function isMarkedPinned(title: string): boolean {
  return within(itemOf(title)).queryByText('Đã ghim') !== null;
}

function describedText(button: HTMLElement): string {
  return (button.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

// The announcer [S1.20] once its one tick has passed.
async function announced(): Promise<string> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return screen.getByRole('status').textContent ?? '';
}

async function openWith(notes: Note[]) {
  render(<NotesView />);
  await settle(api.gets()[0], json({ data: notes }));
}

function press(title: string) {
  const button = buttonOf(title);
  act(() => button.focus());
  fireEvent.click(button);
}

describe('pinning a note (AC1)', () => {
  test('sends one PUT to the pin path of the note, and shows the list it answers, with no GET', async () => {
    await openWith([note('b', 'B'), note('a', 'A')]);

    press('A');
    expect(api.puts()).toHaveLength(1);
    expect(api.puts()[0].url).toBe('/api/notes/a/pin');
    await settle(api.puts()[0], json({ data: [pinnedNote('a', 'A'), note('b', 'B')] }));

    expect(listedTitles()).toEqual(['A', 'B']);
    expect(isMarkedPinned('A')).toBe(true);
    expect(isMarkedPinned('B')).toBe(false);
    expect(buttonOf('A').textContent).toBe('Bỏ ghim');
    expect(api.gets()).toHaveLength(1);
    expect(api.fn).toHaveBeenCalledTimes(2);
  });

  test('keeps focus on the button of the note once it moved, and says "Đã ghim ghi chú."', async () => {
    await openWith([note('b', 'B'), note('a', 'A')]);

    press('A');
    await settle(api.puts()[0], json({ data: [pinnedNote('a', 'A'), note('b', 'B')] }));

    expect(document.activeElement).toBe(buttonOf('A'));
    expect(await announced()).toBe('Đã ghim ghi chú.');
  });

  test('gives focus to the button of the note when focus fell to the body', async () => {
    await openWith([note('b', 'B'), note('a', 'A')]);

    press('A');
    act(() => buttonOf('A').blur());
    await settle(api.puts()[0], json({ data: [pinnedNote('a', 'A'), note('b', 'B')] }));

    expect(document.activeElement).toBe(buttonOf('A'));
  });

  test('leaves focus where it is when the user moved on to another field', async () => {
    await openWith([note('b', 'B'), note('a', 'A')]);

    press('A');
    const title = screen.getByLabelText('Tiêu đề');
    act(() => title.focus());
    await settle(api.puts()[0], json({ data: [pinnedNote('a', 'A'), note('b', 'B')] }));

    expect(document.activeElement).toBe(title);
  });

  test('marks only the pressed button as pending while the API has not answered', async () => {
    await openWith([note('b', 'B'), note('a', 'A')]);

    press('A');

    expect(buttonOf('A').getAttribute('aria-busy')).toBe('true');
    expect(buttonOf('A').getAttribute('aria-disabled')).toBe('true');
    expect(buttonOf('B').hasAttribute('aria-busy')).toBe(false);
    expect(listedTitles()).toEqual(['B', 'A']);
    expect(isMarkedPinned('A')).toBe(false);
  });
});

describe('unpinning a note (AC6)', () => {
  test('sends one DELETE, shows the list it answers, keeps focus on the button and says "Đã bỏ ghim ghi chú."', async () => {
    await openWith([pinnedNote('a', 'A'), note('d', 'D'), note('c', 'C')]);

    press('A');
    expect(api.deletes()).toHaveLength(1);
    expect(api.deletes()[0].url).toBe('/api/notes/a/pin');
    await settle(api.deletes()[0], json({ data: [note('d', 'D'), note('a', 'A'), note('c', 'C')] }));

    expect(listedTitles()).toEqual(['D', 'A', 'C']);
    expect(isMarkedPinned('A')).toBe(false);
    expect(buttonOf('A').textContent).toBe('Ghim');
    expect(document.activeElement).toBe(buttonOf('A'));
    expect(await announced()).toBe('Đã bỏ ghim ghi chú.');
    expect(api.gets()).toHaveLength(1);
  });
});

describe('pressing again while the API has not answered (AC4)', () => {
  test('sends one PUT for a double press in one go', async () => {
    await openWith([note('a', 'A')]);

    act(() => {
      fireEvent.click(buttonOf('A'));
      fireEvent.click(buttonOf('A'));
    });

    expect(api.puts()).toHaveLength(1);
    await settle(api.puts()[0], json({ data: [pinnedNote('a', 'A')] }));
    expect(buttonOf('A').textContent).toBe('Bỏ ghim');
    expect(api.fn).toHaveBeenCalledTimes(2);
  });

  test('sends one DELETE for a second press while pending', async () => {
    await openWith([pinnedNote('a', 'A')]);

    press('A');
    press('A');

    expect(api.deletes()).toHaveLength(1);
  });

  test('lets another note be pressed meanwhile, with its own request', async () => {
    await openWith([note('b', 'B'), note('a', 'A')]);

    press('A');
    press('B');

    expect(api.puts().map((c) => c.url)).toEqual(['/api/notes/a/pin', '/api/notes/b/pin']);
  });
});

describe('a pin or unpin that fails (AC5, AC7)', () => {
  test('shows the pin error next to that note only, and changes nothing else, with no GET', async () => {
    await openWith([note('b', 'B'), note('a', 'A')]);

    press('A');
    await settle(api.puts()[0], json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, 500));

    expect(within(itemOf('A')).getByRole('alert').textContent).toBe(PIN_ERROR);
    expect(within(itemOf('B')).queryByRole('alert')).toBeNull();
    expect(listedTitles()).toEqual(['B', 'A']);
    expect(isMarkedPinned('A')).toBe(false);
    expect(buttonOf('A').hasAttribute('aria-busy')).toBe(false);
    expect(document.activeElement).toBe(buttonOf('A'));
    expect(api.gets()).toHaveLength(1);
    expect(await announced()).toBe('');
  });

  test('shows the unpin error when the network fails', async () => {
    await openWith([pinnedNote('a', 'A'), note('b', 'B')]);

    press('A');
    await settle(api.deletes()[0], new TypeError('Failed to fetch'));

    expect(within(itemOf('A')).getByRole('alert').textContent).toBe(UNPIN_ERROR);
    expect(isMarkedPinned('A')).toBe(true);
    expect(listedTitles()).toEqual(['A', 'B']);
  });

  test('shows the pin error once 10 s pass without an answer, not before', async () => {
    vi.useFakeTimers();
    render(<NotesView />);
    await settle(api.gets()[0], json({ data: [note('a', 'A')] }));

    fireEvent.click(buttonOf('A'));
    await act(() => vi.advanceTimersByTimeAsync(9_999));
    expect(within(itemOf('A')).queryByRole('alert')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(within(itemOf('A')).getByRole('alert').textContent).toBe(PIN_ERROR);
    expect(api.puts()[0].signal?.aborted).toBe(true);
  });

  test('shows the pin error when the note is no longer at the API (404)', async () => {
    await openWith([note('a', 'A')]);

    press('A');
    await settle(api.puts()[0], json({ error: { code: 'NOT_FOUND', message: 'x' } }, 404));

    expect(within(itemOf('A')).getByRole('alert').textContent).toBe(PIN_ERROR);
  });

  test('clears the error when the button is pressed again, as the request is sent', async () => {
    await openWith([note('a', 'A')]);
    press('A');
    await settle(api.puts()[0], json({}, 500));

    press('A');

    expect(within(itemOf('A')).queryByRole('alert')).toBeNull();
    expect(api.puts()).toHaveLength(2);
  });

  test('keeps the error when the list is replaced by the answer of another note', async () => {
    await openWith([note('b', 'B'), note('a', 'A')]);
    press('A');
    await settle(api.puts()[0], json({}, 500));

    press('B');
    await settle(api.puts()[1], json({ data: [pinnedNote('b', 'B'), note('a', 'A')] }));

    expect(listedTitles()).toEqual(['B', 'A']);
    expect(within(itemOf('A')).getByRole('alert').textContent).toBe(PIN_ERROR);
  });

  test('keeps an old error once the button is locked, described by the hint and the error', async () => {
    await openWith([pinnedNote('p1', 'P1'), pinnedNote('p2', 'P2'), note('b', 'B'), note('a', 'A')]);
    press('A');
    await settle(api.puts()[0], json({}, 500));

    press('B');
    const three = [pinnedNote('p1', 'P1'), pinnedNote('p2', 'P2'), pinnedNote('b', 'B'), note('a', 'A')];
    await settle(api.puts()[1], json({ data: three }));

    expect(buttonOf('A').getAttribute('aria-disabled')).toBe('true');
    expect(describedText(buttonOf('A'))).toBe(`${HINT} ${PIN_ERROR}`);
    fireEvent.click(buttonOf('A'));
    expect(within(itemOf('A')).getByRole('alert').textContent).toBe(PIN_ERROR);
    expect(api.puts()).toHaveLength(2);
  });
});

describe('the limit of 3 pinned notes (AC8, AC9)', () => {
  // Pinned in the order P1, P2, P3: the earliest pin first (Rules 1 of the SPEC of SMP-23).
  const THREE = [pinnedNote('p1', 'P1'), pinnedNote('p2', 'P2'), pinnedNote('p3', 'P3'), note('b', 'B')];

  test('locks the Ghim button of every note that is not pinned, and sends nothing on a press', async () => {
    await openWith(THREE);

    expect(buttonOf('B').getAttribute('aria-disabled')).toBe('true');
    expect(describedText(buttonOf('B'))).toBe(HINT);
    fireEvent.click(buttonOf('B'));
    expect(api.fn).toHaveBeenCalledTimes(1);
    expect(screen.getByText(HINT).hidden).toBe(false);
  });

  test('opens the Ghim button again, with no hint, in the render of the unpin answer', async () => {
    await openWith(THREE);
    fireEvent.click(buttonOf('B'));

    press('P2');
    const two = [pinnedNote('p1', 'P1'), pinnedNote('p3', 'P3'), note('b', 'B'), note('p2', 'P2')];
    await settle(api.deletes()[0], json({ data: two }));

    expect(buttonOf('B').hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByText(HINT)).toBeNull();
  });

  test('locks the button of a note saved once 3 notes are pinned, and puts it right below them (AC3)', async () => {
    await openWith(THREE);

    save('Mới');
    await settle(api.posts()[0], json(note('n', 'Mới'), 201));

    expect(listedTitles()).toEqual(['P1', 'P2', 'P3', 'Mới', 'B']);
    expect(buttonOf('Mới').getAttribute('aria-disabled')).toBe('true');
    expect(api.gets()).toHaveLength(1);
  });
});

describe('saving a note while some are pinned (AC3)', () => {
  test('puts the new note right below the pinned notes, above every other note, with no GET', async () => {
    await openWith([pinnedNote('a', 'A'), note('c', 'C')]);

    save('E');
    await settle(api.posts()[0], json(note('e', 'E'), 201));

    expect(listedTitles()).toEqual(['A', 'E', 'C']);
    expect(api.gets()).toHaveLength(1);
  });

  test('keeps the new note when a pin answer sorted before it was saved arrives without it', async () => {
    await openWith([pinnedNote('p', 'P'), note('a', 'A')]);

    press('A');
    save('E');
    await settle(api.posts()[0], json(note('e', 'E'), 201));
    expect(listedTitles()).toEqual(['P', 'E', 'A']);
    await settle(api.puts()[0], json({ data: [pinnedNote('p', 'P'), pinnedNote('a', 'A')] }));

    expect(listedTitles()).toEqual(['P', 'A', 'E']);
  });

  test('shows the new note once when a later answer has it', async () => {
    await openWith([note('a', 'A')]);
    save('E');
    await settle(api.posts()[0], json(note('e', 'E'), 201));

    press('A');
    await settle(api.puts()[0], json({ data: [pinnedNote('a', 'A'), note('e', 'E')] }));
    press('A');
    await settle(api.deletes()[0], json({ data: [note('e', 'E'), note('a', 'A')] }));

    expect(listedTitles()).toEqual(['E', 'A']);
  });
});

describe('answers that arrive out of order (decision 7)', () => {
  test('ignores the list of an older request that arrives after a newer one, but still ends its pending state', async () => {
    await openWith([note('b', 'B'), note('a', 'A')]);

    press('A');
    press('B');
    await settle(api.puts()[1], json({ data: [pinnedNote('a', 'A'), pinnedNote('b', 'B')] }));
    await settle(api.puts()[0], json({ data: [pinnedNote('a', 'A'), note('b', 'B')] }));

    expect(listedTitles()).toEqual(['A', 'B']);
    expect(isMarkedPinned('B')).toBe(true);
    expect(buttonOf('A').hasAttribute('aria-busy')).toBe(false);
    expect(await announced()).toBe('Đã ghim ghi chú.');
  });
});

describe('a pin the API refuses because 3 notes are pinned already (AC10)', () => {
  test('sends exactly one GET, shows its list, locks the button with its hint open, and reads the hint', async () => {
    await openWith([pinnedNote('p1', 'P1'), pinnedNote('p2', 'P2'), note('b', 'B')]);

    press('B');
    await settle(api.puts()[0], json(LIMIT_REACHED, 409));
    expect(api.gets()).toHaveLength(2);
    // design.md S1.11: no skeleton; the old list stays and the button stays pending until the new list comes.
    expect(listedTitles()).toEqual(['P1', 'P2', 'B']);
    expect(buttonOf('B').getAttribute('aria-busy')).toBe('true');
    // X, pinned meanwhile from another browser, at the bottom of the pinned notes.
    const three = [pinnedNote('p1', 'P1'), pinnedNote('p2', 'P2'), pinnedNote('x', 'X'), note('b', 'B')];
    await settle(api.gets()[1], json({ data: three }));

    expect(listedTitles()).toEqual(['P1', 'P2', 'X', 'B']);
    expect(isMarkedPinned('B')).toBe(false);
    expect(buttonOf('B').getAttribute('aria-disabled')).toBe('true');
    expect(buttonOf('B').hasAttribute('aria-busy')).toBe(false);
    expect(screen.getByText(HINT).hidden).toBe(false);
    expect(within(itemOf('B')).queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(buttonOf('B'));
    expect(await announced()).toBe(HINT);
    expect(api.puts()).toHaveLength(1);
    expect(api.gets()).toHaveLength(2);
  });

  test('opens the button with no hint and no message when the new list has fewer than 3 pinned notes', async () => {
    await openWith([pinnedNote('p1', 'P1'), note('b', 'B')]);

    press('B');
    await settle(api.puts()[0], json(LIMIT_REACHED, 409));
    await settle(api.gets()[1], json({ data: [pinnedNote('p1', 'P1'), note('b', 'B')] }));

    expect(buttonOf('B').hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByText(HINT)).toBeNull();
    expect(within(itemOf('B')).queryByRole('alert')).toBeNull();
    expect(await announced()).toBe('');
  });

  test('shows the load error in place of the list, with focus on it, when that GET fails', async () => {
    await openWith([pinnedNote('p1', 'P1'), note('b', 'B')]);

    press('B');
    await settle(api.puts()[0], json(LIMIT_REACHED, 409));
    await settle(api.gets()[1], json({}, 500));

    const error = screen.getByRole('alert');
    expect(error.textContent).toBe(LOAD_ERROR);
    expect(screen.queryByRole('list')).toBeNull();
    expect(error.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(error);
  });

  test('gives no focus to a load error the page shows for another reason', async () => {
    render(<NotesView />);
    await settle(api.gets()[0], json({}, 500));

    expect(screen.getByRole('alert').hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
