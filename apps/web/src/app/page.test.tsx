import { redirect } from 'next/navigation';
import { expect, test, vi } from 'vitest';
import Home from './page';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

test('the home page sends the user to /notes', () => {
  Home();
  expect(redirect).toHaveBeenCalledWith('/notes');
});
