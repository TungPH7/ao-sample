// The paths git writes in a diff and in `--name-status`, as they are on disk. Pure.
//
// git puts a path that has a byte outside printable ASCII, a double quote, a backslash or a control character in double
// quotes, with C escapes and each such byte in octal (core.quotePath, on by default): `ghi-chú.ts` is written
// "ghi-ch\303\272.ts". On a `---` or `+++` line of a diff it also ends a path that has a space with a tab.

const ESCAPES = { a: 0x07, b: 0x08, t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d, '"': 0x22, '\\': 0x5c };

// A path as git wrote it, quoted or not, as it is on disk.
export function unquotePath(text) {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text;
  const bytes = [];
  const body = text.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') {
      bytes.push(...new TextEncoder().encode(body[i]));
      continue;
    }
    const octal = body.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 3;
    } else {
      bytes.push(ESCAPES[body[i + 1]] ?? body.charCodeAt(i + 1));
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// The lines of a git diff: { kind: 'file' } for a `diff --git` line, { kind: 'header', side, path } for the `---` and
// `+++` lines of a file's header, { kind: 'hunk', start, count } for an `@@` line, and { kind: 'line', text } for the
// rest. A header line comes before the first hunk of its file: inside a hunk, an added line "++ b/README.md" shows as
// "+++ b/README.md" and is a line of the file (review of ao-sample PR #13).
export function* diffLines(diff) {
  let header = true;
  for (const text of diff.split(/\r?\n/)) {
    if (text.startsWith('diff --git ')) {
      header = true;
      yield { kind: 'file' };
      continue;
    }
    const hunk = text.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      header = false;
      yield { kind: 'hunk', start: Number(hunk[1]), count: hunk[2] === undefined ? 1 : Number(hunk[2]) };
      continue;
    }
    const found = header ? headerPath(text) : null;
    yield found ? { kind: 'header', ...found } : { kind: 'line', text };
  }
}

// The path of a `--- a/<path>` or `+++ b/<path>` line of a git diff: { side: '---' or '+++', path }, with path null for
// /dev/null; null for any other line.
export function headerPath(line) {
  const header = line.match(/^(---|\+\+\+) (.+?)\t?$/);
  if (!header) return null;
  const [, side, written] = header;
  if (written === '/dev/null') return { side, path: null };
  const path = unquotePath(written);
  const prefix = side === '---' ? 'a/' : 'b/';
  return path.startsWith(prefix) ? { side, path: path.slice(prefix.length) } : null;
}
