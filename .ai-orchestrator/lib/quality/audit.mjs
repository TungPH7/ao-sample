// audit (quality-gates spec section 2.6): before a deploy, checks that the commit came through the gates. decideAudit
// and mergedPull are pure; readAuditFacts reads the facts of one commit with a GitHub client; runAudit decides one
// commit and, when the audit fails, flags the work item with the CI token, as the contract effect flag-needs-you does;
// auditRange decides every new commit of a branch for the deployer, which writes nothing to Jira (release-workflow
// spec 2.3). scripts/audit.mjs only builds the clients.
import { extractKeys, parseBranch } from '../tracker/conventions.mjs';
import { adfText, readChecks } from '../tracker/facts.mjs';
import { raiseFlag } from '../tracker/sync.mjs';
import { docsPullRequest, readDocsFacts } from './docs-pr.mjs';
import { matchesGlob } from './glob.mjs';
import { approved, botLogin, docsUnmet, docsVerdict, isBackMerge, protectedPaths, unmetConditions } from './merge-gate.mjs';

// The only files the ao-dev bot may change on a release branch without a PR: the regression report and the changelog
// the script of /ao-ship commits (release-workflow spec 2.7 step 4). Both lie outside the image.
export const RELEASE_BOT_PATHS = ['docs/releases/**', 'CHANGELOG.md'];

// The merged PR whose merge commit is `sha`, into `branch`; for a release branch also into develop, since a new
// release branch is cut from a commit of develop. A PR that only contains the commit is not its merge.
export function mergedPull(pulls, sha, branch) {
  const bases = branch.startsWith('release/') ? [branch, 'develop'] : [branch];
  return pulls.find((pr) => pr.merged_at && pr.merge_commit_sha === sha && bases.includes(pr.base.ref));
}

// facts: the commit `sha` and its `message`, the `branch` it is deployed from, `commit` ({ author, committer, parents,
// files } of the commit itself: the two logins GitHub links, the number of parents, the changed files), `pull` (GET
// /pulls/{n} of the PR mergedPull found, or null), that PR's `files`, `reviews` and the `checks` of its head commit,
// the `gates`, the slugs of the two `apps`, your logins (`approvers`), and for a docs PR its `docs` facts as merge-gate
// reads them. Returns { ok, pr, problems, keys }: keys are the work items to flag, from the PR title, or from the commit
// header when there is no PR. A docs PR passes on the terms merge-gate merged it on (dev-workflow spec 2.4).
export function decideAudit({ sha, branch, message, commit, pull, files = [], reviews = [], checks, gates, apps, approvers, docs, space }) {
  const short = sha.slice(0, 7);
  if (!pull) {
    const keys = extractKeys(message.split('\n', 1)[0]);
    const bot = botLogin(apps.dev);
    if (parseBranch(branch)?.kind === 'release' && commit?.author === bot && commit.committer === bot && commit.parents === 1) {
      // The release report of /ao-ship. Whoever holds the token of ao-dev, an agent included, can change nothing the
      // image holds this way; a file moved away counts by its old path too.
      const outside = changedPaths(commit.files).filter((path) => !RELEASE_BOT_PATHS.some((glob) => matchesGlob(glob, path)));
      if (commit.files.length > 0 && outside.length === 0) return result(null, [], keys);
      const changes = outside.length > 0 ? outside.join(', ') : 'no file';
      return result(null, [`${short} on ${branch} is a commit of ${bot} without a PR, which may only change ${RELEASE_BOT_PATHS.join(' and ')}, but it changes ${changes}`], keys);
    }
    return result(null, [`${short} on ${branch} is not the merge of a PR into ${branch}: it was pushed without one`], keys);
  }
  const keys = extractKeys(pull.title ?? '');
  if (mergedPull([pull], sha, branch) !== pull) return result(pull.number, [`PR #${pull.number} was merged into ${pull.base.ref}, not ${branch}`], keys);

  const problems = [];
  let missing;
  if (isBackMerge(pull)) {
    // Every commit of main passed gate ③ or gate ⑤ there: no review and no approval (release-workflow spec 2.7).
    // merge-gate merges it only without conflicts, so the merge commit adds nothing of its own.
    missing = checks.green ? [] : [`CI green on head ${pull.head.sha.slice(0, 7)}`];
    const merger = pull.merged_by?.login;
    if (merger !== botLogin(apps.dev) && !approvers.includes(merger)) {
      problems.push(`PR #${pull.number} merges main back into ${pull.base.ref}, which merge-gate or you merge, but ${merger} merged it`);
    }
  } else if (parseBranch(pull.head.ref)?.kind === 'release') {
    // Every item of a release passed review on its own PR: CI and your approval are enough.
    const at = `on head ${pull.head.sha.slice(0, 7)}`;
    missing = [
      ...(checks.green ? [] : [`CI green ${at}`]),
      ...(approved({ pr: pull, reviews, approvers, authorApproves: true }) ? [] : [`approval ${at}`]),
    ];
  } else {
    const verdict = docsVerdict({ pr: pull, files, gates, apps, docs, space });
    if (verdict?.docs) missing = docsUnmet({ pr: pull, checks, reviews, verdict });
    else {
      missing = unmetConditions({ pr: pull, checks, reviews, gates, apps, approvers, authorApproves: true });
      if (verdict && missing.length > 0) missing[missing.length - 1] += ` (${verdict.reason})`;
    }
    const paths = protectedPaths(files, gates);
    const merger = pull.merged_by?.login;
    if (paths.length > 0 && !approvers.includes(merger)) problems.push(`PR #${pull.number} changes ${paths.join(', ')}, which only you merge, but ${merger} merged it`);
  }
  if (missing.length > 0) problems.unshift(`PR #${pull.number} was merged without: ${missing.join('; ')}`);
  return result(pull.number, problems, keys);
}

const result = (pr, problems, keys) => ({ ok: problems.length === 0, pr, problems, keys });

// The paths a commit touches; a renamed file counts by its old name too.
const changedPaths = (files = []) => [...new Set(files.flatMap(({ filename, previous_filename: previous }) => (previous ? [previous, filename] : [filename])))];

// Reads the facts of commit `sha` on `branch`, decides, and prints the outcome. When the audit fails, every work item
// of the project space it names is flagged, with a comment that says why, once per commit and branch. dryRun flags
// nothing. `docs` ({ jira, passage }, a reading Jira client) reads the facts of a docs PR. Returns the decision and the
// keys flagged.
export async function runAudit({ github, jira, docs, mapping, space, sha, branch, gates, apps, approvers, dryRun = false, log = console.log }) {
  const { facts, docsKey } = await readAuditFacts({ github, docs, sha, branch, gates, apps, space });
  const decision = decideAudit({ sha, branch, ...facts, gates, apps, approvers, space });
  const short = sha.slice(0, 7);
  if (decision.ok) {
    const what = decision.pr ? `the merge of PR #${decision.pr}${docsKey ? `, the docs PR of ${docsKey}` : ''}, which met every gate` : `a commit of ${botLogin(apps.dev)} that only changes ${RELEASE_BOT_PATHS.join(' and ')}`;
    log(`audit passed: ${short} on ${branch} is ${what}`);
    return { ...decision, flagged: [] };
  }
  log(`audit failed: ${short} on ${branch}`);
  for (const problem of decision.problems) log(`- ${problem}`);

  const keys = space ? decision.keys.filter((key) => key.startsWith(`${space}-`)) : [];
  if (keys.length === 0) {
    log(space ? `No work item of ${space} to flag` : 'No project space (AO_JIRA_SPACE) to flag work items in');
    return { ...decision, flagged: [] };
  }
  const marker = `audit: ${short} on ${branch} `;
  const text = `${marker}was not deployed. ${decision.problems.join('. ')}. It is flagged with the label ${mapping.needs_you_label} and waits for you.`;
  for (const key of keys) {
    if (dryRun) {
      log(`Would flag ${key}`);
      continue;
    }
    await raiseFlag(key, { jira, mapping });
    // A run again for the same commit, like a re-run of the deploy, does not repeat the comment.
    const comments = await jira.getAll(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {}, 'comments');
    if (!comments.some(({ body }) => adfText(body).startsWith(marker))) await jira.comment(key, text);
    log(`Flagged ${key}`);
  }
  return { ...decision, flagged: dryRun ? [] : keys };
}

// The facts decideAudit needs for commit `sha` on `branch`, read with a GitHub client, and the Epic key when the commit
// is the merge of a docs PR. `docs` ({ jira, passage }, a reading Jira client) reads the facts of a docs PR.
export async function readAuditFacts({ github, docs, sha, branch, gates, apps, space }) {
  const found = await github.get(`/commits/${sha}`);
  const commit = {
    author: found.author?.login ?? null,
    committer: found.committer?.login ?? null,
    parents: found.parents?.length ?? 0,
    files: found.files ?? [],
  };
  const listed = mergedPull(await github.getAll(`/commits/${sha}/pulls`), sha, branch);
  if (!listed) return { facts: { message: found.commit.message, commit, pull: null }, docsKey: null };
  // Only the PR itself says who merged it.
  const pull = await github.get(`/pulls/${listed.number}`);
  const files = await github.getAll(`/pulls/${pull.number}/files`);
  const docsKey = docsPullRequest({ pr: pull, files, gates, apps, space });
  const facts = {
    message: found.commit.message,
    commit,
    pull,
    files,
    reviews: await github.getAll(`/pulls/${pull.number}/reviews`),
    checks: await readChecks(github, pull.head.sha),
    docs: docsKey && docs ? { ...(await readDocsFacts({ github, jira: docs.jira, key: docsKey, branch: pull.head.ref })), passage: docs.passage } : undefined,
  };
  return { facts, docsKey };
}

const FULL_SHA = /^[0-9a-f]{40}$/;
const fullSha = (value) => {
  if (!FULL_SHA.test(value)) throw new Error(`${JSON.stringify(value)} is not a full commit hash`);
  return value;
};

// Audits every first-parent commit of `branch` after `since` up to `head`, oldest first, and stops at the first that
// fails (release-workflow spec 2.3 step 2): a commit pushed without a PR cannot hide under a valid one. When the
// history was rewritten, so that `since` is no longer under `head`, it starts again from the newest commit both share.
// `git(args)` runs git in the deployer's mirror and resolves to its output; it only ever gets full commit hashes, so no
// value can pass for an option. Returns { base, rewritten, audits }, each audit { sha, ok, pr, problems, keys, pull }, where
// pull is { number, head } of the PR the commit merged, or null.
export async function auditRange({ git, github, docs, since, head, branch, gates, apps, approvers, space }) {
  fullSha(since);
  fullSha(head);
  const base = fullSha((await git(['merge-base', since, head])).trim());
  const shas = (await git(['rev-list', '--first-parent', '--reverse', `${base}..${head}`])).split('\n').filter(Boolean).map(fullSha);
  const audits = [];
  for (const sha of shas) {
    const { facts } = await readAuditFacts({ github, docs, sha, branch, gates, apps, space });
    const decision = decideAudit({ sha, branch, ...facts, gates, apps, approvers, space });
    audits.push({ sha, ...decision, pull: facts.pull ? { number: facts.pull.number, head: facts.pull.head.ref } : null });
    if (!decision.ok) break;
  }
  return { base, rewritten: base !== since, audits };
}
