// The floor guard of the policy job (quality-gates spec section 2.4): added lines that switch a check off, deleted test
// files, and quality/gates.yaml thresholds a PR lowers. Pure: scripts/check-policy.mjs runs git.
import { diffLines } from './diff-paths.mjs';
import { matchesGlob } from './glob.mjs';

// Documentation may name a suppression without using one, and the kit copy is a protected path anyway.
const NOT_CHECKED = ['**/*.md', '.ai-orchestrator/**'];
// NestJS names its end-to-end tests test/<name>.e2e-spec.ts.
const TEST_FILE = ['**/*.{test,spec}.*', '**/*.e2e-spec.*', 'e2e/**'];
const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];

// [{ file, line, text }] for every line a zero-context `git diff` adds. A path git quotes is read as it is on disk.
export function addedLines(diff) {
  const added = [];
  let file = null;
  let line = 0;
  for (const part of diffLines(diff)) {
    if (part.kind === 'file') file = null;
    else if (part.kind === 'header') file = part.side === '+++' ? part.path : file;
    else if (part.kind === 'hunk') line = part.start;
    else if (file && part.text.startsWith('+')) added.push({ file, line: line++, text: part.text.slice(1) });
  }
  return added;
}

// suppressions: the suppressions block of quality/gates.yaml.
export function findSuppressions(added, { reason_marker: marker, patterns, never }) {
  const reasoned = new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\S`);
  const problems = [];
  for (const { file, line, text } of added.filter(({ file: f }) => !NOT_CHECKED.some((glob) => matchesGlob(glob, f)))) {
    for (const pattern of never.filter((p) => text.includes(p))) problems.push(`${file}:${line} ${pattern} is never allowed`);
    for (const pattern of patterns.filter((p) => text.includes(p))) {
      if (!reasoned.test(text)) problems.push(`${file}:${line} ${pattern} needs "${marker} <why>" on the same line`);
    }
  }
  return problems;
}

// Test files the diff deletes; the policy job lists them for the reviewer rather than failing.
export function deletedTests(diff) {
  const deleted = [];
  let from = null;
  for (const part of diffLines(diff)) {
    if (part.kind === 'header' && part.side === '+++' && from && part.path === null) deleted.push(from);
    from = part.kind === 'header' && part.side === '---' ? part.path : null;
  }
  return deleted.filter((file) => TEST_FILE.some((glob) => matchesGlob(glob, file)));
}

// What a PR loosens in quality/gates.yaml, comparing the base version with its own.
export function loweredThresholds(before, after) {
  const problems = [];
  const lost = (path, from, to) => {
    const gone = from.filter((item) => !to.includes(item));
    if (gone.length > 0) problems.push(`${path} lost ${gone.join(', ')}`);
  };
  if (after.coverage.changed_lines_min < before.coverage.changed_lines_min) {
    problems.push(`coverage.changed_lines_min went down from ${before.coverage.changed_lines_min} to ${after.coverage.changed_lines_min}`);
  }
  // A higher audit level lets more through.
  if (LEVELS.indexOf(after.dependencies.audit_level) > LEVELS.indexOf(before.dependencies.audit_level)) {
    problems.push(`dependencies.audit_level went down from ${before.dependencies.audit_level} to ${after.dependencies.audit_level}`);
  }
  lost('suppressions.patterns', before.suppressions.patterns, after.suppressions.patterns);
  lost('suppressions.never', before.suppressions.never, after.suppressions.never);
  lost('checks', before.checks, after.checks);
  lost('protected_branches', before.protected_branches, after.protected_branches);
  lost('protected_paths', before.protected_paths.map(({ path }) => path), after.protected_paths.map(({ path }) => path));
  return problems;
}

export { LEVELS };
