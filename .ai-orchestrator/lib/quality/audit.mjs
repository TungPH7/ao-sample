// audit (quality-gates spec section 2.6): before a deploy, checks that the commit came through the gates. decideAudit
// and mergedPull are pure; runAudit reads the facts with a GitHub client and, when the audit fails, flags the work item
// with the CI token, as the contract effect flag-needs-you does. scripts/audit.mjs only builds the clients.
import { extractKeys, parseBranch } from '../tracker/conventions.mjs';
import { adfText, readChecks } from '../tracker/facts.mjs';
import { raiseFlag } from '../tracker/sync.mjs';
import { docsPullRequest, readDocsFacts } from './docs-pr.mjs';
import { approved, docsUnmet, docsVerdict, protectedPaths, unmetConditions } from './merge-gate.mjs';

// The merged PR whose merge commit is `sha`, into `branch`; for a release branch also into develop, since a new
// release branch is cut from a commit of develop. A PR that only contains the commit is not its merge.
export function mergedPull(pulls, sha, branch) {
  const bases = branch.startsWith('release/') ? [branch, 'develop'] : [branch];
  return pulls.find((pr) => pr.merged_at && pr.merge_commit_sha === sha && bases.includes(pr.base.ref));
}

// facts: the commit `sha` and its `message`, the `branch` it is deployed from, `pull` (GET /pulls/{n} of the PR
// mergedPull found, or null), that PR's `files`, `reviews` and the `checks` of its head commit, the `gates`, the slugs
// of the two `apps`, your logins (`approvers`), and for a docs PR its `docs` facts as merge-gate reads them. Returns
// { ok, pr, problems, keys }: keys are the work items to flag, from the PR title, or from the commit header when there
// is no PR. A docs PR passes on the terms merge-gate merged it on (dev-workflow spec 2.4).
export function decideAudit({ sha, branch, message, pull, files = [], reviews = [], checks, gates, apps, approvers, docs, space }) {
  const short = sha.slice(0, 7);
  if (!pull) {
    return result(null, [`${short} on ${branch} is not the merge of a PR into ${branch}: it was pushed without one`], extractKeys(message.split('\n', 1)[0]));
  }
  const keys = extractKeys(pull.title ?? '');
  if (mergedPull([pull], sha, branch) !== pull) return result(pull.number, [`PR #${pull.number} was merged into ${pull.base.ref}, not ${branch}`], keys);

  const problems = [];
  let missing;
  if (parseBranch(pull.head.ref)?.kind === 'release') {
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

// Reads the facts of commit `sha` on `branch`, decides, and prints the outcome. When the audit fails, every work item
// of the project space it names is flagged, with a comment that says why, once per commit and branch. dryRun flags
// nothing. `docs` ({ jira, passage }, a reading Jira client) reads the facts of a docs PR. Returns the decision and the
// keys flagged.
export async function runAudit({ github, jira, docs, mapping, space, sha, branch, gates, apps, approvers, dryRun = false, log = console.log }) {
  const { commit } = await github.get(`/commits/${sha}`);
  const listed = mergedPull(await github.getAll(`/commits/${sha}/pulls`), sha, branch);
  let facts = { pull: null };
  let docsKey = null;
  if (listed) {
    // Only the PR itself says who merged it.
    const pull = await github.get(`/pulls/${listed.number}`);
    const files = await github.getAll(`/pulls/${pull.number}/files`);
    docsKey = docsPullRequest({ pr: pull, files, gates, apps, space });
    facts = {
      pull,
      files,
      reviews: await github.getAll(`/pulls/${pull.number}/reviews`),
      checks: await readChecks(github, pull.head.sha),
      docs: docsKey && docs ? { ...(await readDocsFacts({ github, jira: docs.jira, key: docsKey, branch: pull.head.ref })), passage: docs.passage } : undefined,
    };
  }
  const decision = decideAudit({ sha, branch, message: commit.message, ...facts, gates, apps, approvers, space });
  const short = sha.slice(0, 7);
  if (decision.ok) {
    log(`audit passed: ${short} on ${branch} is the merge of PR #${decision.pr}${docsKey ? `, the docs PR of ${docsKey}` : ''}, which met every gate`);
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
