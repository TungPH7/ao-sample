// Coverage of the lines a PR adds or changes (quality-gates spec section 2.4): the lcov files of the tests intersected
// with a zero-context git diff. Only lines lcov lists count, since only those can run. Pure: scripts/coverage-diff.mjs
// runs git and finds the lcov files.
import { matchesGlob } from './glob.mjs';

const slashes = (path) => path.replaceAll('\\', '/');
const isAbsolute = (path) => /^(?:[A-Za-z]:)?\//.test(path);

// A path with forward slashes and without `.` or `..` segments.
function normalize(path) {
  const parts = [];
  for (const part of slashes(path).split('/')) {
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') parts.pop();
    else if (part !== '.' && (part !== '' || parts.length === 0)) parts.push(part);
  }
  return parts.join('/');
}

// The path inside the repository, or null for a file outside it.
function inside(path, root) {
  const base = `${normalize(root).replace(/\/$/, '')}/`;
  return path.toLowerCase().startsWith(base.toLowerCase()) ? path.slice(base.length) : null;
}

// { file: Map(line, hits) } of one lcov file. A relative SF is relative to the package that ran the tests, which is the
// folder holding the lcov file's coverage folder; `lcovDir` is that package folder.
export function parseLcov(text, { lcovDir, root }) {
  const files = new Map();
  let hits = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      const source = slashes(line.slice(3));
      const file = inside(normalize(isAbsolute(source) ? source : `${lcovDir}/${source}`), root);
      hits = file === null ? null : (files.get(file) ?? new Map());
      if (file !== null) files.set(file, hits);
    } else if (line.startsWith('DA:') && hits) {
      const [number, count] = line.slice(3).split(',').map(Number);
      hits.set(number, Math.max(hits.get(number) ?? 0, count));
    } else if (line === 'end_of_record') hits = null;
  }
  return files;
}

// { file: [line numbers] } added or changed in the new version, from `git diff -U0`. Deleted files have none.
export function changedLines(diff) {
  const changed = new Map();
  let lines = null;
  for (const line of diff.split(/\r?\n/)) {
    const target = line.match(/^\+\+\+ (?:b\/(.*)|\/dev\/null)$/);
    if (target) {
      lines = target[1] === undefined ? null : [];
      if (lines) changed.set(target[1], lines);
      continue;
    }
    const hunk = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (hunk && lines) {
      const [start, count = 1] = [Number(hunk[1]), hunk[2] === undefined ? 1 : Number(hunk[2])];
      for (let n = start; n < start + count; n++) lines.push(n);
    }
  }
  return changed;
}

// coverage: the coverage block of quality/gates.yaml.
export function changedLineCoverage({ changed, lcov, coverage }) {
  const counted = (file) => coverage.source.some((glob) => matchesGlob(glob, file)) && !coverage.exclude.some((glob) => matchesGlob(glob, file));
  const files = [];
  const problems = [];
  for (const [file, lines] of changed) {
    if (!counted(file)) continue;
    const hits = lcov.get(file);
    if (!hits) {
      problems.push(`${file} is not in any lcov file: the coverage of the tests must include every source file`);
      continue;
    }
    const runnable = lines.filter((line) => hits.has(line));
    if (runnable.length === 0) continue;
    const uncovered = runnable.filter((line) => hits.get(line) === 0);
    files.push({ file, covered: runnable.length - uncovered.length, total: runnable.length, uncovered });
  }
  const covered = files.reduce((sum, f) => sum + f.covered, 0);
  const total = files.reduce((sum, f) => sum + f.total, 0);
  const percent = total === 0 ? 100 : Math.round((covered / total) * 1000) / 10;
  if (percent < coverage.changed_lines_min) problems.push(`changed lines covered: ${percent}% (${covered} of ${total}), below ${coverage.changed_lines_min}%`);
  return { ok: problems.length === 0, percent, covered, total, files, problems };
}
