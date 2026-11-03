import type { Note } from '@api/notes-shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import NoteList from './note-list';

afterEach(cleanup);

function note(id: string, title: string, content: string): Note {
  return { id, title, content, createdAt: '2026-11-02T07:40:00.000Z' };
}

describe('the note list', () => {
  test('shows the notes in the order given, each with an h3 title and its content', () => {
    render(<NoteList notes={[note('b', 'Mua sữa', '2 hộp'), note('a', 'Gọi mẹ', 'Tối nay')]} />);

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => within(li).getByRole('heading', { level: 3 }).textContent)).toEqual(['Mua sữa', 'Gọi mẹ']);
    expect(within(items[0]).getByText('2 hộp')).toBeTruthy();
    expect(within(items[1]).getByText('Tối nay')).toBeTruthy();
  });

  test('draws nothing for an empty content, only the title', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', '')]} />);

    const item = screen.getByRole('listitem');
    expect(item.children).toHaveLength(1);
    expect(item.textContent).toBe('Mua sữa');
  });

  test('shows markup in a note as plain text', () => {
    render(<NoteList notes={[note('a', '<b>đậm</b>', '<script>alert(1)</script>')]} />);

    const item = screen.getByRole('listitem');
    expect(item.querySelector('b, script')).toBeNull();
    expect(within(item).getByRole('heading', { level: 3 }).textContent).toBe('<b>đậm</b>');
  });

  test('has nothing that takes Tab', () => {
    render(<NoteList notes={[note('a', 'Mua sữa', '2 hộp')]} />);
    expect(screen.getByRole('list').querySelector('a, button, input, [tabindex]')).toBeNull();
  });
});
