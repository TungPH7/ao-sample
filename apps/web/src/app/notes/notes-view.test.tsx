import type { Note } from '@api/notes-shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import NotesView from './notes-view';

// Integration of the view, the form and the list, with fetch faked (plan of SMP-2, Story 4, Sub-task FE). The NFR
// "Số yêu cầu tới API": one GET when the page opens, one POST per save, and no GET after a save while the list is
// ready (decision 7).

function note(id: string, title: string): Note {
  return { id, title, content: '', createdAt: '2026-11-02T07:40:00.000Z' };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface Call {
  method: string;
  signal: AbortSignal | null | undefined;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}

// Every request waits until the test answers it, and fails like the browser once its signal aborts.
function fakeApi() {
  const calls: Call[] = [];
  const fn = vi.fn(
    (_url: string, init: RequestInit = {}) =>
      new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        calls.push({ method: init.method ?? 'GET', signal: init.signal, resolve, reject });
      }),
  );
  const of = (method: string) => calls.filter((c) => c.method === method);
  return { fn, gets: () => of('GET'), posts: () => of('POST') };
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
    await settle(api.gets()[1], json({ data: [note('n', 'Mua sữa'), note('a', 'A')] }));
    expect(listedTitles()).toEqual(['Mua sữa', 'A']);
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
