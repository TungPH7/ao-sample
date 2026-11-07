// What security reviews on a PR (dev-workflow spec 2.6): only the changes since its last full report, when that report
// is readable and was posted by ao-review on a commit X that is an ancestor of the head, and the diff from X to the head
// has at most 300 added and deleted lines. Otherwise the whole PR. Changes on a protected path are the new part too, at
// the roster's effort (`protected`), and Critical or High findings still open are passed on (`earlier`): the report of
// the new part lists each of them as Fixed or Open, and merge-gate keeps open those it leaves out (openFindings). Until
// Pilot 1, second review of ao-sample PR #13, both asked for a full review of the whole PR at max. Pure.
import { matchesGlob } from '../quality/glob.mjs';
import { protectedPaths } from '../quality/merge-gate.mjs';

export const MAX_DELTA_LINES = 300;

const plural = (n) => `${n} Critical or High finding${n === 1 ? '' : 's'}`;

// report: the newest security report as facts give it ({ sha, at, ok, blocking, open, onHead }), or null. full: the
// newest full one, the same when the newest has no Scope line; null when there is none. compare: GitHub's compare of the
// full report's commit X with the head ({ status, files }), or null.
// Returns { mode: 'none' | 'full' | 'delta', reason, since?, at?, lines?, protected?, earlier? }.
export function securityScope({ report, full = report, compare, gates }) {
  if (!report) return { mode: 'full', reason: 'no security report on this PR yet' };
  if (report.onHead) return { mode: 'none', reason: `the security report is on the head ${report.sha.slice(0, 7)}` };
  if (!report.ok) return { mode: 'full', reason: `the security report on ${report.sha.slice(0, 7)} cannot be read` };
  if (!full) return { mode: 'full', reason: 'no full security report on this PR yet' };
  const since = full.sha.slice(0, 7);
  if (!full.ok) return { mode: 'full', reason: `the full security report on ${since} cannot be read` };
  // ahead: the head has X and more. behind, diverged or no answer: a rebase or force-push took X out.
  if (compare?.status !== 'ahead') return { mode: 'full', reason: `${since} is no longer an ancestor of the head (rebase or force-push)` };
  const lines = compare.files.reduce((total, { additions = 0, deletions = 0 }) => total + additions + deletions, 0);
  if (lines > MAX_DELTA_LINES) return { mode: 'full', reason: `${lines} lines changed since ${since}, over ${MAX_DELTA_LINES}` };
  const paths = protectedPaths(compare.files, gates);
  // The findings to check: all that are open after the newest report, those it left out too (openFindings).
  const earlier = report.open ?? [];
  const reason = [`${lines} lines changed since ${since}`, paths.length > 0 && `on the protected path ${paths.join(', ')}`, earlier.length > 0 && `with ${plural(earlier.length)} open to check`].filter(Boolean).join(', ');
  return { mode: 'delta', reason, since: full.sha, at: full.at, lines, ...(paths.length > 0 && { protected: paths }), ...(earlier.length > 0 && { earlier }) };
}

// The effort of a full security review (Pilot 1, review cost): the roster's when the item or one of its Sub-tasks has an
// effort label (sa marked it at gate ②), or the PR touches a protected path or a path of security_review in
// quality/gates.yaml; security_review.lower_effort otherwise. files: the paths the PR changes; protectedPaths: those of
// them that are protected. Returns { effort, reason }.
export function fullReviewEffort({ files, protectedPaths: touched = [], item, gates, rosterEffort }) {
  const rule = gates.security_review;
  const labelled = [item, ...(item?.subtasks ?? [])].find((i) => i?.effort);
  if (labelled) return { effort: rosterEffort, reason: `${labelled.key} has the effort label ${labelled.effort}` };
  if (touched.length > 0) return { effort: rosterEffort, reason: `the PR touches the protected path ${touched.join(', ')}` };
  // Whatever the case: `**/*auth*.*` must take in AuthProvider.tsx and useAuth.ts (review test of 2026-11-07).
  const risky = files.filter((file) => rule.roster_effort_paths.some((glob) => matchesGlob(glob, file, { ignoreCase: true })));
  if (risky.length > 0) return { effort: rosterEffort, reason: `the PR touches ${risky.join(', ')}` };
  return { effort: rule.lower_effort, reason: 'no protected path, no path of security_review, no effort label' };
}
