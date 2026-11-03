import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup } from '@testing-library/react';
import NotesPage from './page';

afterEach(cleanup);

describe('the notes page', () => {
  test('has one h1 "Ghi chú" inside main', () => {
    render(<NotesPage />);
    const main = screen.getByRole('main');
    const h1s = within(main).getAllByRole('heading', { level: 1 });
    expect(h1s.map((h) => h.textContent)).toEqual(['Ghi chú']);
  });

  test('has the h2 "Tạo ghi chú" first, then the h2 "Danh sách ghi chú"', () => {
    render(<NotesPage />);
    const h2s = within(screen.getByRole('main')).getAllByRole('heading', { level: 2 });
    expect(h2s.map((h) => h.textContent)).toEqual(['Tạo ghi chú', 'Danh sách ghi chú']);
  });

  test('gives each h2 the id that the form and the list will point to', () => {
    render(<NotesPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Tạo ghi chú' }).id).toBe('create-note-heading');
    expect(screen.getByRole('heading', { level: 2, name: 'Danh sách ghi chú' }).id).toBe('notes-list-heading');
  });

  test('puts each h2 in its own section', () => {
    render(<NotesPage />);
    const create = screen.getByRole('heading', { level: 2, name: 'Tạo ghi chú' });
    const list = screen.getByRole('heading', { level: 2, name: 'Danh sách ghi chú' });
    expect(create.parentElement?.tagName).toBe('SECTION');
    expect(list.parentElement?.tagName).toBe('SECTION');
    expect(create.parentElement).not.toBe(list.parentElement);
  });
});
