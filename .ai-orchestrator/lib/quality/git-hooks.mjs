// The checks behind the git hooks of kit/.githooks (quality-gates spec section 2.3). Pure: the scripts in scripts/ read
// what git hands the hook and call these.
import { checkCommit } from '../tracker/conventions.mjs';
import { matchesGlob } from './glob.mjs';

// Headers git writes itself, for a merge or a revert.
const GIT_WRITTEN = [/^Merge (branch|branches|remote-tracking branch|pull request|tag|commit) /, /^Revert ".*"$/];

// commit-msg: the first line that is not a comment must follow type(scope): subject (<KEY>).
export function checkCommitMessage(message) {
  const header = message.split(/\r?\n/).find((line) => line.trim() !== '' && !line.startsWith('#')) ?? '';
  if (GIT_WRITTEN.some((pattern) => pattern.test(header))) return { ok: true };
  return checkCommit(header);
}

const ZERO = /^0+$/;

// pre-push: git gives one line per ref, "<local ref> <local sha> <remote ref> <remote sha>". Only a PR may change a
// protected branch: pushing to it or deleting it is refused, while creating it (a new release branch) is not.
export function checkPush(lines, protectedBranches) {
  const reasons = [];
  for (const line of lines.filter((l) => l.trim() !== '')) {
    const [, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!remoteRef?.startsWith('refs/heads/')) continue;
    const branch = remoteRef.slice('refs/heads/'.length);
    if (!protectedBranches.some((pattern) => matchesGlob(pattern, branch))) continue;
    if (ZERO.test(localSha)) reasons.push(`${branch} is protected: do not delete it`);
    else if (!ZERO.test(remoteSha)) reasons.push(`${branch} is protected: change it through a pull request, not a push`);
  }
  return { ok: reasons.length === 0, reasons };
}
