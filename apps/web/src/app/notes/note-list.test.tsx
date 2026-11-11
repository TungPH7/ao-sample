import type { Note } from '@api/notes-shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import NoteList from './note-list';

// The time of a note follows the zone of the machine (design.md S1.13); pin it to UTC+7.
let savedTz: string | undefined;

beforeEach(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'Asia/Ho_Chi_Minh';
});

afterEach(() => {
  cleanup();
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

  test('draws nothing for an empty content, only the title and the time', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', '')]} />);

    const item = screen.getByRole('listitem');
    expect(item.querySelector('p')).toBeNull();
    expect(item.textContent).toBe('Mua sữa02/11/2026 14:40');
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

  test('has nothing that takes Tab', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', '2 hộp')]} />);
    expect(screen.getByRole('list').querySelector('a, button, input, [tabindex]')).toBeNull();
  });
});
