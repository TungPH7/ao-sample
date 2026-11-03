import type { Note } from '@api/notes-shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import NoteForm from './note-form';

const SAVE_ERROR = 'Không lưu được ghi chú. Vui lòng thử lại.';

const STORED: Note = {
  id: '6f1c2b8e-0000-4000-8000-000000000001',
  title: 'Mua sữa',
  content: '2 hộp',
  createdAt: '2026-11-02T07:40:00.000Z',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// A fetch whose answers the test hands out one by one, and which fails like the browser once its signal aborts.
function controlledFetch() {
  const answers: Array<{ init: RequestInit; resolve: (r: Response) => void; reject: (e: unknown) => void }> = [];
  const fn = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        answers.push({ init, resolve, reject });
      }),
  );
  return { fn, answers };
}

let server: ReturnType<typeof controlledFetch>;
let onCreated: ReturnType<typeof vi.fn<(note: Note) => void>>;

beforeEach(() => {
  server = controlledFetch();
  vi.stubGlobal('fetch', server.fn);
  onCreated = vi.fn<(note: Note) => void>();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderForm() {
  render(
    <section>
      <h2 id="create-note-heading">Tạo ghi chú</h2>
      <NoteForm onCreated={onCreated} />
    </section>,
  );
  return {
    form: screen.getByRole('form', { name: 'Tạo ghi chú' }) as HTMLFormElement,
    title: screen.getByLabelText('Tiêu đề') as HTMLInputElement,
    content: screen.getByLabelText('Nội dung') as HTMLTextAreaElement,
    save: screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement,
  };
}

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

async function answer(response: Response | Error) {
  const next = server.answers.at(-1)!;
  await act(async () => {
    if (response instanceof Error) next.reject(response);
    else next.resolve(response);
  });
}

describe('the form, before saving', () => {
  test('is a form named by the h2 "Tạo ghi chú", and the browser does not check it', () => {
    const { form } = renderForm();
    expect(form.getAttribute('aria-labelledby')).toBe('create-note-heading');
    expect(form.noValidate).toBe(true);
  });

  test('has a single-line Tiêu đề field, marked required, with no autocomplete', () => {
    const { title } = renderForm();
    expect(title.tagName).toBe('INPUT');
    expect(title.getAttribute('aria-required')).toBe('true');
    expect(title.getAttribute('autocomplete')).toBe('off');
    expect(title.required).toBe(false);
    expect(title.hasAttribute('maxlength')).toBe(false);
  });

  test('has a Nội dung field of at least 4 lines', () => {
    const { content } = renderForm();
    expect(content.tagName).toBe('TEXTAREA');
    expect(content.rows).toBeGreaterThanOrEqual(4);
    expect(content.hasAttribute('maxlength')).toBe(false);
  });

  test('has one submit button "Lưu", which is not busy', () => {
    const { save } = renderForm();
    expect(save.type).toBe('submit');
    expect(save.getAttribute('aria-busy')).not.toBe('true');
    expect(save.getAttribute('aria-disabled')).not.toBe('true');
  });

  test('shows no save error', () => {
    renderForm();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('sends nothing on its own', () => {
    renderForm();
    expect(server.fn).not.toHaveBeenCalled();
  });
});

describe('saving', () => {
  test('sends exactly one POST with what was typed', () => {
    const { title, content, save } = renderForm();
    type(title, 'Mua sữa');
    type(content, '2 hộp');

    fireEvent.click(save);

    expect(server.fn).toHaveBeenCalledTimes(1);
    const { init } = server.answers[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Mua sữa', content: '2 hộp' });
  });

  test('makes both fields read-only, not disabled, and marks the button busy with a spinner', () => {
    const { title, content, save } = renderForm();
    type(title, 'Mua sữa');

    fireEvent.click(save);

    expect(title.readOnly).toBe(true);
    expect(content.readOnly).toBe(true);
    expect(title.disabled || content.disabled || save.disabled).toBe(false);
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(save.querySelector('[data-spinner]')?.getAttribute('aria-hidden')).toBe('true');
    expect(save.textContent).toBe('Lưu');
  });

  test('AC7 sends one POST when Lưu is pressed twice before the page redraws', () => {
    const { title, save } = renderForm();
    type(title, 'Mua sữa');

    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });

    expect(server.fn).toHaveBeenCalledTimes(1);
  });

  test('AC7 sends one POST when Lưu is pressed again while the API has not answered', async () => {
    const { title, form, save } = renderForm();
    type(title, 'Mua sữa');

    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.submit(form);
    await answer(json(STORED, 201));

    expect(server.fn).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});

describe('after the API stores the note', () => {
  test('empties both fields, puts the cursor in Tiêu đề and hands the stored note over', async () => {
    const { title, content, save } = renderForm();
    type(title, 'Mua sữa');
    type(content, '2 hộp');
    save.focus();

    fireEvent.click(save);
    await answer(json(STORED, 201));

    expect(title.value).toBe('');
    expect(content.value).toBe('');
    expect(document.activeElement).toBe(title);
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(STORED);
  });

  test('is ready for the next note: fields editable, button not busy', async () => {
    const { title, content, save } = renderForm();
    type(title, 'Mua sữa');

    fireEvent.click(save);
    await answer(json(STORED, 201));

    expect(title.readOnly).toBe(false);
    expect(content.readOnly).toBe(false);
    expect(save.getAttribute('aria-busy')).not.toBe('true');
    expect(save.getAttribute('aria-disabled')).not.toBe('true');
  });

  test('AC2 sends an empty content when Nội dung is left empty', async () => {
    const { title, save } = renderForm();
    type(title, 'Mua sữa');

    fireEvent.click(save);

    expect(JSON.parse(server.answers[0].init.body as string)).toEqual({ title: 'Mua sữa', content: '' });
  });
});

describe('when the API does not store the note', () => {
  test.each([
    ['a network failure', new TypeError('Failed to fetch')],
    ['a server error', json({ error: { code: 'INTERNAL_ERROR' } }, 500)],
    ['a 400 the form did not expect', json({ error: { code: 'VALIDATION_FAILED' } }, 400)],
  ])('AC8 shows the save error above Lưu on %s and keeps what was typed', async (_case, response) => {
    const { title, content, save } = renderForm();
    type(title, 'Mua sữa');
    type(content, '2 hộp');
    save.focus();

    fireEvent.click(save);
    await answer(response);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(SAVE_ERROR);
    expect(alert.nextElementSibling).toBe(save);
    expect(title.value).toBe('Mua sữa');
    expect(content.value).toBe('2 hộp');
    expect(document.activeElement).toBe(save);
    expect(onCreated).not.toHaveBeenCalled();
  });

  test('AC8 keeps the cursor on Lưu even when Enter was pressed in Tiêu đề', async () => {
    const { form, title, save } = renderForm();
    type(title, 'Mua sữa');
    title.focus();

    fireEvent.submit(form);
    await answer(new TypeError('Failed to fetch'));

    expect(document.activeElement).toBe(save);
  });

  test('gives the error icon no name for screen readers', async () => {
    const { title, save } = renderForm();
    type(title, 'Mua sữa');

    fireEvent.click(save);
    await answer(new TypeError('Failed to fetch'));

    const icon = screen.getByRole('alert').querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  test('AC8 shows the save error once 10 s pass without an answer', async () => {
    vi.useFakeTimers();
    const { title, content, save } = renderForm();
    type(title, 'Mua sữa');
    type(content, '2 hộp');

    fireEvent.click(save);
    await act(() => vi.advanceTimersByTimeAsync(9_999));
    expect(screen.queryByRole('alert')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(screen.getByRole('alert').textContent).toBe(SAVE_ERROR);
    expect(title.value).toBe('Mua sữa');
    expect(content.value).toBe('2 hộp');
  });

  test('hides the save error when Lưu is pressed again, and sends a new POST', async () => {
    const { title, save } = renderForm();
    type(title, 'Mua sữa');
    fireEvent.click(save);
    await answer(new TypeError('Failed to fetch'));

    fireEvent.click(save);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(server.fn).toHaveBeenCalledTimes(2);
  });

  test('shows the save error again if the retry fails too', async () => {
    const { title, save } = renderForm();
    type(title, 'Mua sữa');
    fireEvent.click(save);
    await answer(new TypeError('Failed to fetch'));

    fireEvent.click(save);
    await answer(json({}, 500));

    expect(screen.getByRole('alert').textContent).toBe(SAVE_ERROR);
  });

  test('clears the save error once a retry is stored', async () => {
    const { title, save } = renderForm();
    type(title, 'Mua sữa');
    fireEvent.click(save);
    await answer(new TypeError('Failed to fetch'));

    fireEvent.click(save);
    await answer(json(STORED, 201));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(STORED);
  });
});
