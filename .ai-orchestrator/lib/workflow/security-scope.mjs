// What security reviews on a PR (dev-workflow spec 2.6): only the changes since its last full report, at effort high,
// when that report is readable and was posted by ao-review on a commit X that is an ancestor of the head, and the diff
// from X to the head has at most 300 added and deleted lines and touches no protected path. Otherwise the whole PR, at
// the effort of the roster. A report with Critical or High findings open, the newest or the full one, always asks for
// the whole PR again: a review of the new part would not carry those findings, and merge-gate reads only the newest
// report. Pure.
import { protectedPaths } from '../quality/merge-gate.mjs';

export const MAX_DELTA_LINES = 300;

const open = (n) => `${n} Critical or High finding${n === 1 ? '' : 's'} open: only a full review clears ${n === 1 ? 'it' : 'them'}`;

// report: the newest security report as facts give it ({ sha, at, ok, blocking, onHead }), or null. full: the newest
// full one, the same when the newest has no Scope line; null when there is none. compare: GitHub's compare of the full
// report's commit X with the head ({ status, files }), or null.
// Returns { mode: 'none' | 'full' | 'delta', reason, since?, at?, lines? }.
export function securityScope({ report, full = report, compare, gates }) {
  if (!report) return { mode: 'full', reason: 'no security report on this PR yet' };
  if (report.onHead) return { mode: 'none', reason: `the security report is on the head ${report.sha.slice(0, 7)}` };
  if (!report.ok) return { mode: 'full', reason: `the security report on ${report.sha.slice(0, 7)} cannot be read` };
  if (report.blocking > 0) return { mode: 'full', reason: `the security report on ${report.sha.slice(0, 7)} has ${open(report.blocking)}` };
  if (!full) return { mode: 'full', reason: 'no full security report on this PR yet' };
  const since = full.sha.slice(0, 7);
  if (!full.ok) return { mode: 'full', reason: `the full security report on ${since} cannot be read` };
  if (full.blocking > 0) return { mode: 'full', reason: `the full security report on ${since} has ${open(full.blocking)}` };
  // ahead: the head has X and more. behind, diverged or no answer: a rebase or force-push took X out.
  if (compare?.status !== 'ahead') return { mode: 'full', reason: `${since} is no longer an ancestor of the head (rebase or force-push)` };
  const lines = compare.files.reduce((total, { additions = 0, deletions = 0 }) => total + additions + deletions, 0);
  if (lines > MAX_DELTA_LINES) return { mode: 'full', reason: `${lines} lines changed since ${since}, over ${MAX_DELTA_LINES}` };
  const paths = protectedPaths(compare.files, gates);
  if (paths.length > 0) return { mode: 'full', reason: `the changes since ${since} touch ${paths.join(', ')}` };
  return { mode: 'delta', reason: `${lines} lines changed since ${since}`, since: full.sha, at: full.at, lines };
}
