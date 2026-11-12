import type { Note } from '@api/notes-shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import NoteForm from './note-form';

const SAVE_ERROR = 'Không lưu được ghi chú. Vui lòng thử lại.';
const TITLE_REQUIRED = 'Vui lòng nhập tiêu đề';
const TITLE_TOO_LONG = 'Tiêu đề tối đa 100 ký tự';
const CONTENT_TOO_LONG = 'Nội dung tối đa 1000 ký tự';
// "ệ" typed in its decomposed form (e + U+0323 + U+0302): three code points that count as one character after NFC.
const E_NFD = 'ệ';

const STORED: Note = {
  id: '6f1c2b8e-0000-4000-8000-000000000001',
  title: 'Mua sữa',
  content: '2 hộp',
  createdAt: '2026-11-02T07:40:00.000Z',
  pinnedAt: null,
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

// The text the field is described by, as a screen reader reads it, or null when the field points at nothing.
function errorOf(field: HTMLElement): string | null {
  const id = field.getAttribute('aria-describedby');
  return id === null ? null : (document.getElementById(id)?.textContent ?? '');
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

  test('gives neither field a name, so a submit before hydration puts no note text in the URL', () => {
    const { title, content } = renderForm();
    expect(title.hasAttribute('name')).toBe(false);
    expect(content.hasAttribute('name')).toBe(false);
  });

  test('shows no field error and marks no field invalid', () => {
    const { title, content } = renderForm();
    for (const field of [title, content]) {
      expect(field.hasAttribute('aria-invalid')).toBe(false);
      expect(field.hasAttribute('aria-describedby')).toBe(false);
    }
  });

  test('keeps an empty polite live region with an id under each field', () => {
    renderForm();
    for (const id of ['note-title-error', 'note-content-error']) {
      const region = document.getElementById(id);
      expect(region?.getAttribute('aria-live')).toBe('polite');
      expect(region?.textContent).toBe('');
    }
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
    ['a full store', json({ error: { code: 'NOTES_LIMIT_REACHED' } }, 409)],
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

describe('the error of Tiêu đề, while typing', () => {
  test('AC4 shows "Tiêu đề tối đa 100 ký tự" as soon as the title reaches 101 characters', () => {
    const { title } = renderForm();

    type(title, 'a'.repeat(101));

    expect(errorOf(title)).toBe(TITLE_TOO_LONG);
    expect(title.getAttribute('aria-invalid')).toBe('true');
  });

  test('AC4 shows no error for exactly 100 accented characters, even typed decomposed', () => {
    const { title } = renderForm();

    type(title, 'ệ'.repeat(100));
    expect(errorOf(title)).toBeNull();

    type(title, E_NFD.repeat(100));
    expect(errorOf(title)).toBeNull();
  });

  test('AC4 counts 101 decomposed accented characters as 101', () => {
    const { title } = renderForm();

    type(title, E_NFD.repeat(101));

    expect(errorOf(title)).toBe(TITLE_TOO_LONG);
  });

  test('AC4 does not count the spaces at both ends', () => {
    const { title } = renderForm();

    type(title, `  ${'a'.repeat(100)}  `);

    expect(errorOf(title)).toBeNull();
  });

  test('does not stop typing past 100 characters', () => {
    const { title } = renderForm();

    type(title, 'a'.repeat(150));

    expect(title.value).toHaveLength(150);
  });

  test('AC6 removes the error at once when the title is cut back to 100 characters', () => {
    const { title } = renderForm();
    type(title, 'a'.repeat(101));

    type(title, 'a'.repeat(100));

    expect(errorOf(title)).toBeNull();
    expect(title.hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById('note-title-error')?.textContent).toBe('');
  });

  test('does not show "Vui lòng nhập tiêu đề" when the title is emptied and that error was not showing', () => {
    const { title } = renderForm();
    type(title, 'Mua sữa');

    type(title, '');

    expect(errorOf(title)).toBeNull();
  });

  test('does not show "Vui lòng nhập tiêu đề" when a too long title is emptied', () => {
    const { title } = renderForm();
    type(title, 'a'.repeat(101));

    type(title, '');

    expect(errorOf(title)).toBeNull();
  });

  test('does not show "Vui lòng nhập tiêu đề" again when a title typed after it is emptied', () => {
    const { title } = renderForm();
    fireEvent.blur(title);
    type(title, 'M');

    type(title, '');

    expect(errorOf(title)).toBeNull();
  });

  test('does not show "Vui lòng nhập tiêu đề" again when a too long title typed after it is emptied', () => {
    const { title } = renderForm();
    fireEvent.blur(title);
    type(title, 'a'.repeat(101));

    type(title, '');

    expect(errorOf(title)).toBeNull();
  });

  test('keeps "Vui lòng nhập tiêu đề" while the title stays empty or blank', () => {
    const { title } = renderForm();
    fireEvent.blur(title);

    type(title, '   ');

    expect(errorOf(title)).toBe(TITLE_REQUIRED);
  });

  test('AC6 removes "Vui lòng nhập tiêu đề" as soon as a character is typed', () => {
    const { title } = renderForm();
    fireEvent.blur(title);

    type(title, 'M');

    expect(errorOf(title)).toBeNull();
    expect(title.hasAttribute('aria-invalid')).toBe(false);
  });

  test('replaces "Vui lòng nhập tiêu đề" by "Tiêu đề tối đa 100 ký tự" when 101 characters are pasted', () => {
    const { title } = renderForm();
    fireEvent.blur(title);

    type(title, 'a'.repeat(101));

    expect(errorOf(title)).toBe(TITLE_TOO_LONG);
  });
});

describe('the error of Tiêu đề, on leaving the field', () => {
  test('AC3 shows "Vui lòng nhập tiêu đề" when the title is left empty', () => {
    const { title } = renderForm();
    title.focus();

    fireEvent.blur(title);

    expect(errorOf(title)).toBe(TITLE_REQUIRED);
    expect(title.getAttribute('aria-invalid')).toBe('true');
  });

  test('AC3 shows "Vui lòng nhập tiêu đề" when the title is left with spaces only', () => {
    const { title } = renderForm();
    type(title, ' \t  ');

    fireEvent.blur(title);

    expect(errorOf(title)).toBe(TITLE_REQUIRED);
  });

  test('shows nothing when a valid title is left', () => {
    const { title } = renderForm();
    type(title, 'Mua sữa');

    fireEvent.blur(title);

    expect(errorOf(title)).toBeNull();
  });

  test('keeps "Tiêu đề tối đa 100 ký tự" when a too long title is left', () => {
    const { title } = renderForm();
    type(title, 'a'.repeat(101));

    fireEvent.blur(title);

    expect(errorOf(title)).toBe(TITLE_TOO_LONG);
  });

  test('AC3 sends nothing when the title is left empty', () => {
    const { title } = renderForm();

    fireEvent.blur(title);

    expect(server.fn).not.toHaveBeenCalled();
  });
});

describe('the error of Nội dung', () => {
  test('AC5 shows "Nội dung tối đa 1000 ký tự" as soon as the content reaches 1001 characters', () => {
    const { content } = renderForm();

    type(content, 'a'.repeat(1001));

    expect(errorOf(content)).toBe(CONTENT_TOO_LONG);
    expect(content.getAttribute('aria-invalid')).toBe('true');
  });

  test('AC5 shows no error for exactly 1000 accented characters, even typed decomposed', () => {
    const { content } = renderForm();

    type(content, 'ệ'.repeat(1000));
    expect(errorOf(content)).toBeNull();

    type(content, E_NFD.repeat(1000));
    expect(errorOf(content)).toBeNull();
  });

  test('AC5 counts 1001 decomposed accented characters as 1001', () => {
    const { content } = renderForm();

    type(content, E_NFD.repeat(1001));

    expect(errorOf(content)).toBe(CONTENT_TOO_LONG);
  });

  test('AC5 counts the spaces and each line break of the content', () => {
    const { content } = renderForm();

    type(content, `${'a'.repeat(999)}\n`);
    expect(errorOf(content)).toBeNull();

    type(content, `${'a'.repeat(999)}\n `);
    expect(errorOf(content)).toBe(CONTENT_TOO_LONG);
  });

  test('does not stop typing past 1000 characters', () => {
    const { content } = renderForm();

    type(content, 'a'.repeat(1200));

    expect(content.value).toHaveLength(1200);
  });

  test('AC6 removes the error at once when the content is cut back to 1000 characters', () => {
    const { content } = renderForm();
    type(content, 'a'.repeat(1001));

    type(content, 'a'.repeat(1000));

    expect(errorOf(content)).toBeNull();
    expect(content.hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById('note-content-error')?.textContent).toBe('');
  });

  test('does nothing on leaving the field', () => {
    const { content } = renderForm();

    fireEvent.blur(content);
    expect(errorOf(content)).toBeNull();

    type(content, 'a'.repeat(1001));
    fireEvent.blur(content);
    expect(errorOf(content)).toBe(CONTENT_TOO_LONG);
  });

  test('leaves the error of Tiêu đề alone', () => {
    const { title, content } = renderForm();
    fireEvent.blur(title);

    type(content, 'a'.repeat(1001));
    type(content, '2 hộp');

    expect(errorOf(title)).toBe(TITLE_REQUIRED);
    expect(errorOf(content)).toBeNull();
  });
});

describe('pressing Lưu with a wrong field', () => {
  test('AC3 shows "Vui lòng nhập tiêu đề", sends nothing and puts the cursor in Tiêu đề when it is empty', () => {
    const { title, save } = renderForm();
    save.focus();

    fireEvent.click(save);

    expect(errorOf(title)).toBe(TITLE_REQUIRED);
    expect(document.activeElement).toBe(title);
    expect(server.fn).not.toHaveBeenCalled();
  });

  test('AC3 does the same for a title of spaces only', () => {
    const { title, save } = renderForm();
    type(title, '    ');
    save.focus();

    fireEvent.click(save);

    expect(errorOf(title)).toBe(TITLE_REQUIRED);
    expect(document.activeElement).toBe(title);
    expect(server.fn).not.toHaveBeenCalled();
  });

  test('AC3 does the same when Enter is pressed in an empty Tiêu đề', () => {
    const { form, title } = renderForm();
    title.focus();

    fireEvent.submit(form);

    expect(errorOf(title)).toBe(TITLE_REQUIRED);
    expect(document.activeElement).toBe(title);
    expect(server.fn).not.toHaveBeenCalled();
  });

  test('AC4 shows "Tiêu đề tối đa 100 ký tự", sends nothing and puts the cursor in Tiêu đề', () => {
    const { title, save } = renderForm();
    type(title, 'a'.repeat(101));
    save.focus();

    fireEvent.click(save);

    expect(errorOf(title)).toBe(TITLE_TOO_LONG);
    expect(document.activeElement).toBe(title);
    expect(server.fn).not.toHaveBeenCalled();
  });

  test('AC5 shows "Nội dung tối đa 1000 ký tự", sends nothing and puts the cursor in Nội dung', () => {
    const { title, content, save } = renderForm();
    type(title, 'Mua sữa');
    type(content, 'a'.repeat(1001));
    save.focus();

    fireEvent.click(save);

    expect(errorOf(content)).toBe(CONTENT_TOO_LONG);
    expect(errorOf(title)).toBeNull();
    expect(document.activeElement).toBe(content);
    expect(server.fn).not.toHaveBeenCalled();
  });

  test('shows the error of both fields and puts the cursor in Tiêu đề, the first one', () => {
    const { title, content, save } = renderForm();
    type(content, 'a'.repeat(1001));
    save.focus();

    fireEvent.click(save);

    expect(errorOf(title)).toBe(TITLE_REQUIRED);
    expect(errorOf(content)).toBe(CONTENT_TOO_LONG);
    expect(document.activeElement).toBe(title);
    expect(server.fn).not.toHaveBeenCalled();
  });

  test('keeps the fields editable and the button not busy', () => {
    const { title, content, save } = renderForm();

    fireEvent.click(save);

    expect(title.readOnly).toBe(false);
    expect(content.readOnly).toBe(false);
    expect(save.getAttribute('aria-busy')).not.toBe('true');
  });

  test('sends the note once the wrong field is fixed', () => {
    const { title, save } = renderForm();
    fireEvent.click(save);

    type(title, 'Mua sữa');
    fireEvent.click(save);

    expect(server.fn).toHaveBeenCalledTimes(1);
  });

  test('keeps the save error until a request is sent again', async () => {
    const { title, save } = renderForm();
    type(title, 'Mua sữa');
    fireEvent.click(save);
    await answer(new TypeError('Failed to fetch'));

    type(title, '');
    fireEvent.click(save);

    expect(screen.getByRole('alert').textContent).toBe(SAVE_ERROR);
    expect(server.fn).toHaveBeenCalledTimes(1);
  });
});

describe('pressing Lưu with valid fields at the limits', () => {
  test('AC4 AC5 sends a title of exactly 100 and a content of exactly 1000 accented characters', () => {
    const { title, content, save } = renderForm();
    type(title, 'ệ'.repeat(100));
    type(content, 'ệ'.repeat(1000));

    fireEvent.click(save);

    expect(server.fn).toHaveBeenCalledTimes(1);
    expect(errorOf(title)).toBeNull();
    expect(errorOf(content)).toBeNull();
  });

  test('shows no field error once the note is stored and the cursor is back in the empty Tiêu đề', async () => {
    const { title, content, save } = renderForm();
    type(title, 'Mua sữa');

    fireEvent.click(save);
    await answer(json(STORED, 201));

    expect(document.activeElement).toBe(title);
    expect(errorOf(title)).toBeNull();
    expect(errorOf(content)).toBeNull();
  });
});

describe('the field error, for screen readers', () => {
  test('is the exact text of the message, with a decorative icon', () => {
    const { title } = renderForm();
    fireEvent.blur(title);

    const region = document.getElementById(title.getAttribute('aria-describedby')!)!;
    expect(region.id).toBe('note-title-error');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe(TITLE_REQUIRED);
    expect(region.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  test('of Nội dung lives in its own region', () => {
    const { content } = renderForm();
    type(content, 'a'.repeat(1001));

    const region = document.getElementById(content.getAttribute('aria-describedby')!)!;
    expect(region.id).toBe('note-content-error');
    expect(region.textContent).toBe(CONTENT_TOO_LONG);
    expect(region.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  test('is not an alert, so the save error stays the only alert of the form', () => {
    const { title, content } = renderForm();
    fireEvent.blur(title);
    type(content, 'a'.repeat(1001));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
