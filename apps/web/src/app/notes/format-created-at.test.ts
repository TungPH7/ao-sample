import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { formatCreatedAt } from './format-created-at';

// design.md S1.13: dd/MM/yyyy HH:mm, 24-hour, in the time zone of the user's machine. Node reads TZ again whenever it
// changes, so the tests pin the zone of the machine to UTC+7 and the result does not depend on where they run.
let savedTz: string | undefined;

beforeEach(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'Asia/Ho_Chi_Minh';
});

afterEach(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe('formatCreatedAt', () => {
  test('shows the time of the machine, not UTC', () => {
    expect(formatCreatedAt('2026-11-02T07:40:00.000Z')).toBe('02/11/2026 14:40');
  });

  test('adds a 0 in front of a day, month, hour and minute of one digit', () => {
    expect(formatCreatedAt('2026-01-04T23:03:00.000Z')).toBe('05/01/2026 06:03');
  });

  test('shows midnight as 00:00, on the new day of the machine', () => {
    expect(formatCreatedAt('2026-11-02T17:00:00.000Z')).toBe('03/11/2026 00:00');
  });

  test('counts the hours to 23, not 1 to 12 with AM and PM', () => {
    expect(formatCreatedAt('2026-12-31T16:59:59.999Z')).toBe('31/12/2026 23:59');
  });

  test('drops the seconds rather than rounding them up', () => {
    expect(formatCreatedAt('2026-11-02T07:40:59.999Z')).toBe('02/11/2026 14:40');
  });

  test('follows another zone of the machine as well', () => {
    process.env.TZ = 'America/New_York';
    expect(formatCreatedAt('2026-11-02T07:40:00.000Z')).toBe('02/11/2026 02:40');
  });
});
