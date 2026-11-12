// What the human asks a dev agent to change, split by who does it (human-loop spec 4.4). A line that starts with "be:"
// or "fe:", in any case, starts the part of be-dev or fe-dev, which runs to the next such line; a prefix inside a line
// does not count. Text before the first prefix belongs to every part. Pure.
//
//   splitNote('be: add updatedAt\nfe: show it') → { parts: { 'be-dev': 'add updatedAt', 'fe-dev': 'show it' }, prefixed: true }
//   splitNote('make the button blue')          → { parts: {}, prefixed: false, text: 'make the button blue' }
const PREFIX = /^\s*(be|fe):\s?(.*)$/i;

export function splitNote(note) {
  const lines = note.replace(/\r\n?/g, '\n').split('\n');
  const before = [];
  const parts = {};
  let role = null;
  for (const line of lines) {
    const prefixed = line.match(PREFIX);
    if (prefixed) {
      role = `${prefixed[1].toLowerCase()}-dev`;
      parts[role] = [...(parts[role] ?? []), prefixed[2]];
    } else if (role) parts[role].push(line);
    else before.push(line);
  }
  const shared = before.join('\n').trim();
  if (!role) return { parts: {}, prefixed: false, text: shared };
  const joined = Object.entries(parts)
    .map(([who, text]) => [who, [shared, text.join('\n').trim()].filter(Boolean).join('\n\n')])
    .filter(([, text]) => text !== '');
  return { parts: Object.fromEntries(joined), prefixed: true };
}
