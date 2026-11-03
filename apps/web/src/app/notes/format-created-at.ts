function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

// design.md S1.13: the time a note was created, as dd/MM/yyyy HH:mm on a 24-hour clock in the time zone of the user's
// machine (AC11). Built from the local getters rather than toLocaleString or Intl.DateTimeFormat, whose output
// changes with the locale and the browser.
export function formatCreatedAt(createdAt: string): string {
  const date = new Date(createdAt);
  const day = `${twoDigits(date.getDate())}/${twoDigits(date.getMonth() + 1)}/${date.getFullYear()}`;
  return `${day} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}
