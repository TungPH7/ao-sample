// What a run left uncommitted when it stopped before its end (live-run-fixes spec 2.1). At T20 of human-loop, fe-dev hit
// the usage limit with its work not committed; ao-step then refused to switch the checkout, and the work was put aside
// by hand. Now ao-step puts it aside in a stash with a label, keeps the SHA of the stash on the record of the run, and
// applies it again when the run goes on in its session. The stash list is shared by every worktree of a repository, so
// an entry is found by its SHA or its label, never by its place in the list.
// git(...args): git in the project folder, resolving { status, stdout, stderr }.

export const wipLabel = ({ key, n, role }) => `ao-step ${key} run ${n} ${role}`;

const SHA = /^[0-9a-f]{40}$/;

// Puts aside what the checkout holds and has not committed, untracked files included and ignored ones (.ai/) left out,
// when the checkout is on a branch that is not protected: the branch of an item, where a dev agent works. A checkout on
// develop is never touched. Returns { stash, branch } once put aside, null when there is nothing to put aside, or
// { error } when git refused, with the work left where it was.
export function saveWip({ git, run, isProtected }) {
  const branch = git('branch', '--show-current').stdout.trim();
  if (!branch || isProtected(branch)) return null;
  const status = git('status', '--porcelain', '--untracked-files=all');
  if (status.status !== 0 || status.stdout.trim() === '') return null;
  const label = wipLabel(run);
  const pushed = git('stash', 'push', '--include-untracked', '-m', label);
  if (pushed.status !== 0) return { error: `git stash push failed: ${(pushed.stderr || pushed.stdout).trim()}` };
  // The newest entry with this label: git names it "On <branch>: <label>".
  const listed = git('stash', 'list', '--format=%H%x09%gs').stdout.split('\n').map((line) => line.split('\t'));
  const [stash] = listed.find(([sha, subject]) => SHA.test(sha ?? '') && subject === `On ${branch}: ${label}`) ?? [];
  if (!stash) return { error: `git stash push ran, but no entry "${label}" is in git stash list` };
  return { stash, branch };
}

// Applies the work of `wip` again before its run goes on: on its branch, with nothing else uncommitted, at the commit
// it was put aside on, so the apply cannot conflict. The entry is then dropped by its SHA. Returns { ok: true, notes }
// or { ok: false, reason }, the reason naming the SHA, so you can apply it yourself.
export function restoreWip({ git, wip }) {
  const { stash, branch } = wip;
  const yours = `apply it yourself with git stash apply ${stash}, then drop it`;
  const on = git('branch', '--show-current').stdout.trim();
  if (on !== branch) {
    const switched = git('switch', '--quiet', branch);
    if (switched.status !== 0) return { ok: false, reason: `the work the run left is in stash ${stash}, made on ${branch}, but git could not switch to ${branch}: ${switched.stderr.trim()}. Switch to it and ${yours}` };
  }
  const dirty = git('status', '--porcelain', '--untracked-files=all').stdout.trim();
  if (dirty) return { ok: false, reason: `the work the run left is in stash ${stash}, but ${branch} has other changes not committed (${dirty.split('\n').length} files): put them aside, then ${yours}` };
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const base = git('rev-parse', '--verify', '--quiet', `${stash}^1`).stdout.trim();
  if (!base) return { ok: false, reason: `stash ${stash}, the work the run left, is not in this repository any more` };
  if (head !== base) return { ok: false, reason: `the work the run left is in stash ${stash}, made on ${branch} at ${base.slice(0, 8)}, but ${branch} is at ${head.slice(0, 8)} now: ${yours}, and settle what conflicts` };
  const applied = git('stash', 'apply', stash);
  if (applied.status !== 0) return { ok: false, reason: `git stash apply ${stash} failed: ${(applied.stderr || applied.stdout).trim()}. The stash stays: ${yours}` };
  return { ok: true, notes: [`The work the stopped run left uncommitted, put aside in stash ${stash.slice(0, 8)}, is back on ${branch}.`, ...dropBySha(git, stash)] };
}

// git stash drop takes stash@{n} only. The place is found by the SHA, and the SHA of what was dropped is checked: another
// worktree may have put an entry on top in between, which is then put back with git stash store.
function dropBySha(git, stash) {
  const shas = git('stash', 'list', '--format=%H').stdout.split('\n').map((line) => line.trim());
  const place = shas.indexOf(stash);
  if (place < 0) return [];
  const dropped = git('stash', 'drop', `stash@{${place}}`);
  const [, gone] = /\(([0-9a-f]{40})\)/.exec(`${dropped.stdout}${dropped.stderr}`) ?? [];
  if (dropped.status === 0 && gone === stash) return [];
  if (gone && gone !== stash) {
    const subject = git('log', '-1', '--format=%s', gone).stdout.trim();
    git('stash', 'store', '-m', subject, gone);
    return [`Stash ${stash.slice(0, 8)} stays in git stash list: another entry took its place as it was dropped, and was put back. Drop ${stash.slice(0, 8)} yourself.`];
  }
  return [`Stash ${stash.slice(0, 8)} stays in git stash list: git stash drop failed. Drop it yourself.`];
}
