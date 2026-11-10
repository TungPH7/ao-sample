// merge-gate (quality-gates spec section 2.5): decideMerge, the pure decision for one PR, and runMergeGate, which reads
// the open PRs with a GitHub client, decides each one and merges. scripts/merge-gate.mjs only builds the clients. CI
// and changes-requested are read as the tracker guards read them. It also merges the PR of a release branch into main,
// tags it and opens the merge back into develop, and merges those merges back (release-workflow spec 2.7).
import { checkBranch, checkPrTitle, parseBranch } from '../tracker/conventions.mjs';
import { adfText, changesRequestedOn, lastDecision, readChecks } from '../tracker/facts.mjs';
import { ciAccount, latestFlagComment, needsYouMarker } from '../tracker/flags.mjs';
import { raiseFlag } from '../tracker/sync.mjs';
import { docsConditions, docsPullRequest, readDocsFacts } from './docs-pr.mjs';
import { matchesGlob } from './glob.mjs';
import { checkDescription, openCounts, readReviewReport } from './pull-request.mjs';

const OPEN_PRS = { state: 'open', sort: 'created', direction: 'asc' };
// GitHub's answers to a merge it will not make now: 405, the PR cannot be merged; 409, the head moved.
const REFUSED = [405, 409];

// The account GitHub gives a GitHub App: its slug followed by [bot].
export const botLogin = (slug) => `${slug}[bot]`;

// Every open PR, oldest first: skipped, decided, and merged with the client `mergeClient()` gives when it meets every
// condition, one line each. dryRun only prints, and never calls mergeClient. A merge GitHub refuses for now is a wait;
// any other error is returned among the failures, and the run goes on. With `notify` ({ jira, mapping, space }), a PR
// you merge yourself is also said on the PR and on its item (dev-workflow spec 2.7).
export async function runMergeGate({ github, mergeClient, docs, notify, gates, apps, approvers, dryRun = false, log = console.log }) {
  const failures = [];
  const open = await github.getAll('/pulls', OPEN_PRS);
  if (open.length === 0) log('No open PR');
  let writer;
  const getWriter = async () => (writer ??= await mergeClient());
  for (const listed of open) {
    const { number } = listed;
    try {
      // The list already says whether merge-gate would skip it, before the reads.
      const reason = skipReason(listed, apps, gates);
      const facts = reason ? undefined : await readMergeFacts(github, number, { docs, gates, apps });
      const decision = reason ? skip(reason) : decideMerge({ ...facts, gates, apps, approvers });
      if (decision.action !== 'merge') {
        log(describe(number, decision, gates));
        if (decision.action === 'needs-you' && notify && onlyYou(decision.missing)) await tellYou({ pr: facts.pr, decision, github, getWriter, notify, apps, gates, dryRun, log });
        if (decision.action === 'conflict') await tellConflict({ pr: facts.pr, github, getWriter, apps, dryRun, log });
        continue;
      }
      const what = `${decision.title} (${decision.method} at ${decision.sha.slice(0, 7)})${decision.docs ? `, the docs PR of ${decision.docs}` : ''}`;
      if (dryRun) {
        const then = decision.release ? `, then tag ${decision.release.tag} and merge main back into ${decision.release.backMerge}` : '';
        log(`Would merge #${number}: ${what}${then}`);
        continue;
      }
      await getWriter();
      let merged;
      try {
        // With the head SHA, GitHub refuses the merge if a push came after the facts were read.
        const message = decision.body === undefined ? {} : { commit_message: decision.body };
        merged = await writer.request('PUT', `/pulls/${number}/merge`, {}, { sha: decision.sha, merge_method: decision.method, commit_title: decision.title, ...message });
        log(`Merged #${number}: ${what}`);
      } catch (error) {
        if (!REFUSED.includes(error.status)) throw error;
        log(`Waiting #${number}: GitHub refused the merge at ${decision.sha.slice(0, 7)} (${error.status}): ${error.message.replace(/^GitHub .*? returned \d+: /, '')}`);
      }
      if (merged && decision.release) await afterRelease({ writer, github, sha: merged.sha, ...decision.release, log });
    } catch (error) {
      failures.push({ number, error });
      log(`Failed #${number}: ${error.message}`);
    }
  }
  return { failures };
}

// After the merge of a release PR: the tag on the merge commit, then the PR that merges main back, unless one is open.
// A tag that already names the merge commit is fine, as when a run is repeated; one on another commit is an error.
async function afterRelease({ writer, github, sha, tag, backMerge, log }) {
  try {
    await writer.request('POST', '/git/refs', {}, { ref: `refs/tags/${tag}`, sha });
    log(`Tagged ${tag} at ${sha.slice(0, 7)}`);
  } catch (error) {
    if (error.status !== 422) throw error;
    const at = (await github.get(`/git/ref/tags/${tag}`)).object?.sha;
    if (at !== sha) throw new Error(`tag ${tag} is at ${String(at).slice(0, 7)}, not at the merge commit ${sha.slice(0, 7)}`);
    log(`Tag ${tag} is already at ${sha.slice(0, 7)}`);
  }
  const open = (await github.getAll('/pulls', { state: 'open', base: backMerge })).find((pr) => pr.head.ref === 'main');
  if (open) {
    log(`The merge back into ${backMerge} is open already: #${open.number}`);
    return;
  }
  const title = `Merge main into ${backMerge} after ${tag}`;
  const body = `merge-gate merges main back into ${backMerge} with a merge commit once CI is green and there is no conflict (release-workflow spec 2.7).`;
  const { number } = await writer.request('POST', '/pulls', {}, { title, head: 'main', base: backMerge, body });
  log(`Opened #${number}: ${title}`);
}

// A merge back with a conflict: one comment of the ao-dev App per head commit, and no merge.
async function tellConflict({ pr, github, getWriter, apps, dryRun, log }) {
  const marker = needsYouMarker(pr.head.sha, pr.number);
  if ((await github.getAll(`/issues/${pr.number}/comments`)).some(({ body, user }) => user?.login === botLogin(apps.dev) && body?.startsWith(marker))) return;
  if (dryRun) {
    log(`Would comment on #${pr.number}: ${marker}`);
    return;
  }
  const text = `${marker}. Merging main back into ${pr.base.ref} conflicts, so merge-gate does not merge it: resolve the conflicts as docs/quality-gates.md says (case 3).`;
  await (await getWriter()).request('POST', `/issues/${pr.number}/comments`, {}, { body: text });
  log(`Commented on #${pr.number}: ${marker}`);
}

// A PR you merge yourself waits only for you once an agent or CI owes nothing more: nothing is missing, or only your
// approval. merge-gate says so then, not earlier, so the notice and the flag mean you can act now.
const onlyYou = (missing) => missing.every((condition) => condition.startsWith('approval on head'));

// The protected paths a PR changes: up to MAX_LISTED by name; past that, with `gates`, a count under each protected path,
// so that a PR such as a kit copy (72 files) does not fill the comment.
const MAX_LISTED = 8;
export function changedPaths(paths, gates) {
  if (paths.length <= MAX_LISTED || !gates) return paths.join(', ');
  const counts = new Map();
  for (const name of paths) {
    const glob = gates.protected_paths.find(({ path }) => matchesGlob(path, name))?.path ?? name;
    counts.set(glob, (counts.get(glob) ?? 0) + 1);
  }
  return `${paths.length} protected files: ${[...counts].map(([glob, n]) => `${glob} (${n})`).join(', ')}`;
}

// The comment merge-gate leaves on the PR and on its item, starting with the marker of the head.
export function needsYouText({ pr, paths, missing, gates }) {
  const still = missing.length > 0 ? `. Still missing: ${missing.join('; ')}. Read the diff, approve the PR on its head commit, then` : '. You approved its head commit: read the diff, then';
  return `${needsYouMarker(pr.head.sha, pr.number)}. It changes ${changedPaths(paths, gates)}, which only you merge${still} Squash and merge it yourself: merge-gate does not merge it.`;
}

// Comments on the PR with the ao-dev App and flags its item with the CI token, each once per head: a comment of that
// App, or of the CI account on the item, that starts with the marker is already there. An item another gate flagged is left alone, so that jira-sync, which clears
// merge-gate's flag when the PR closes, never clears someone else's.
async function tellYou({ pr, decision, github, getWriter, notify, apps, gates, dryRun, log }) {
  const marker = needsYouMarker(pr.head.sha, pr.number);
  const text = needsYouText({ pr, ...decision, gates });
  const onPr = (await github.getAll(`/issues/${pr.number}/comments`)).some(({ body, user }) => user?.login === botLogin(apps.dev) && body?.startsWith(marker));
  if (!onPr) {
    if (dryRun) log(`Would comment on #${pr.number}: ${marker}`);
    else {
      await (await getWriter()).request('POST', `/issues/${pr.number}/comments`, {}, { body: text });
      log(`Commented on #${pr.number}: ${marker}`);
    }
  }
  const key = parseBranch(pr.head.ref)?.key;
  if (!key?.startsWith(`${notify.space}-`)) return;
  const { jira, mapping } = notify;
  if (!jira) {
    log(`No JIRA_CI_TOKEN: ${key} is not flagged`);
    return;
  }
  const path = `/rest/api/3/issue/${encodeURIComponent(key)}`;
  const author = ciAccount(mapping);
  const comments = await jira.getAll(`${path}/comment`, {}, 'comments');
  if (comments.some(({ body, author: by }) => by?.accountId === author && adfText(body).trim().startsWith(marker))) return;
  const { fields } = await jira.get(path, { fields: 'labels' });
  if ((fields.labels ?? []).includes(mapping.needs_you_label) && latestFlagComment(comments, { author })?.kind !== 'merge-gate') {
    log(`Left ${key} as it is: it is already flagged Needs you, and not by merge-gate`);
    return;
  }
  if (dryRun) {
    log(`Would flag ${key}: ${marker}`);
    return;
  }
  await raiseFlag(key, { jira, mapping });
  await jira.comment(key, text);
  log(`Flagged ${key}: ${marker}`);
}

// The facts decideMerge needs for PR `number`. The PR itself is read again: only that answer says if it can merge.
// For a docs PR, `docs` ({ jira, passage }) also reads its Epic and the CI runs of its branch; without it there are none.
async function readMergeFacts(github, number, { docs, gates, apps }) {
  const pr = await github.get(`/pulls/${number}`);
  const files = await github.getAll(`/pulls/${number}/files`);
  const space = docs?.space;
  const key = docsPullRequest({ pr, files, gates, apps, space });
  return {
    pr,
    space,
    commits: await github.getAll(`/pulls/${number}/commits`),
    files,
    reviews: await github.getAll(`/pulls/${number}/reviews`),
    checks: await readChecks(github, pr.head.sha),
    docs: key && docs ? { ...(await readDocsFacts({ github, jira: docs.jira, key, branch: pr.head.ref })), passage: docs.passage } : undefined,
  };
}

function describe(number, { action, reason, missing, paths, docs, note, base }, gates) {
  if (action === 'skip') return `Skipped #${number}: ${reason}`;
  if (action === 'conflict') return `Needs you #${number}: merging main back into ${base} conflicts, so merge-gate does not merge it`;
  if (action === 'wait') return `Waiting #${number}: ${docs ? `the docs PR of ${docs}: ` : ''}${missing.join('; ')}${note ? ` (${note})` : ''}`;
  const still = missing.length > 0 ? ` (still missing: ${missing.join('; ')})` : '';
  return `Needs you #${number}: it changes ${changedPaths(paths, gates)}, so read the diff and merge it yourself${still}`;
}

// The PR of a release branch into main.
const isReleasePr = (pr) => parseBranch(pr.head.ref)?.kind === 'release' && pr.base.ref === 'main';

// A PR that merges main back: its head is main of this very repository, not a branch of that name in a fork.
export const isBackMerge = (pr) => pr.head.ref === 'main' && Boolean(pr.head.repo?.full_name) && pr.head.repo.full_name === pr.base.repo?.full_name;

// Why merge-gate leaves a PR alone, from what the list of open PRs gives too; undefined when it does not.
function skipReason(pr, apps, gates) {
  if (pr.state !== 'open') return 'the PR is not open';
  if (pr.user?.login !== botLogin(apps.dev)) return `opened by ${pr.user?.login}, not by ${apps.dev}: whoever opened it merges it`;
  if (pr.draft) return 'the PR is a draft';
  if (isReleasePr(pr)) return undefined;
  if (isBackMerge(pr)) {
    const bases = gates.release_pull_requests.back_merge_bases;
    return bases.some((glob) => matchesGlob(glob, pr.base.ref)) ? undefined : `main merges back only into ${bases.join(' or ')}`;
  }
  const branch = parseBranch(pr.head.ref);
  if (!branch || branch.kind === 'release') return `${pr.head.ref} is not the branch of a work item`;
  return undefined;
}

// facts: `pr` as GET /pulls/{n} gives it; its `commits`, `files` and `reviews` (oldest first, as GitHub lists them);
// `checks` of the head commit as readChecks gives them; the `gates`; `apps`, the slugs of the two Apps; `approvers`,
// your logins (AO_APPROVERS); and for a docs PR (lib/quality/docs-pr.mjs) `docs`, its Epic, the pull_request workflow
// runs of its branch and the gate passage, when merge-gate could read them. Returns one of:
//   { action: 'merge', method, sha, title, body, docs? }   merge at head commit `sha`, with this commit title and body;
//                                                           docs is the Epic of a docs PR
//   { action: 'wait', missing, docs?, note? }               the conditions not met yet; note says why a docs PR is
//                                                           reviewed like any PR
//   { action: 'needs-you', paths, missing }                 the PR touches protected paths: you read the diff and merge it
//   { action: 'conflict', base }                            a merge back from main conflicts with its base: yours to resolve
//   { action: 'skip', reason }                              not a PR merge-gate merges
// The merge of a release PR also carries `release: { tag, backMerge }`, what merge-gate does after it.
// `space`, when given, is the project space: the docs branch of an Epic outside it is reviewed like any PR.
export function decideMerge({ pr, commits, files, checks, reviews, gates, apps, approvers, docs, space }) {
  const reason = skipReason(pr, apps, gates);
  if (reason) return skip(reason);
  // null means GitHub has not worked it out yet; the merge call itself refuses a conflict.
  const conflicts = pr.mergeable === false ? [`conflicts with ${pr.base.ref} resolved`] : [];
  const at = `on head ${pr.head.sha.slice(0, 7)}`;
  const release = gates.release_pull_requests;
  const keep = { action: 'merge', method: release.merge_method, sha: pr.head.sha, title: `${pr.title} (#${pr.number})` };

  // Every change in a release passed its own gates, protected paths included: CI and your approval are enough.
  if (isReleasePr(pr)) {
    const missing = [...(checks.green ? [] : [`CI green ${at}`]), ...(approved({ pr, reviews, approvers }) ? [] : [`approval ${at}`]), ...conflicts];
    if (missing.length > 0) return { action: 'wait', missing };
    return { ...keep, release: { tag: release.tag.replace('<VERSION>', parseBranch(pr.head.ref).version), backMerge: release.back_merge_after_release } };
  }
  // Every commit of main passed gate ③ or gate ⑤ already.
  if (isBackMerge(pr)) {
    if (pr.mergeable === false) return { action: 'conflict', base: pr.base.ref };
    return checks.green ? keep : { action: 'wait', missing: [`CI green ${at}`] };
  }
  const merge = { action: 'merge', method: gates.merge_method[parseBranch(pr.head.ref).kind], sha: pr.head.sha, title: pr.title, body: squashBody(commits) };

  const verdict = docsVerdict({ pr, files, gates, apps, docs, space });
  if (verdict?.docs) {
    const missing = [...docsUnmet({ pr, checks, reviews, verdict }), ...conflicts];
    return missing.length > 0 ? { action: 'wait', missing, docs: verdict.key } : { ...merge, docs: verdict.key };
  }
  const note = verdict ? { note: verdict.reason } : {};
  const missing = [...unmetConditions({ pr, checks, reviews, gates, apps, approvers }), ...conflicts];
  const paths = protectedPaths(files, gates);
  if (paths.length > 0) return { action: 'needs-you', paths, missing };
  if (missing.length > 0) return { action: 'wait', missing, ...note };
  return merge;
}

const skip = (reason) => ({ action: 'skip', reason });

// For a docs PR, docsConditions with its Epic key; without the facts (no Jira token), it waits for them. undefined
// for any other PR.
export function docsVerdict({ pr, files, gates, apps, docs, space }) {
  const key = docsPullRequest({ pr, files, gates, apps, space });
  if (!key) return undefined;
  if (!docs) return { key, docs: true, missing: [`JIRA_CI_TOKEN, for merge-gate to read ${key}`] };
  return { key, ...docsConditions({ pr, key, ...docs }) };
}

// What a docs PR still misses: the conditions every PR meets, a request for changes, and its own.
export function docsUnmet({ pr, checks, reviews, verdict }) {
  const missing = baseConditions({ pr, checks });
  if (changesRequestedOn(reviews, pr.head.sha)) missing.push(`answer to the changes requested on head ${pr.head.sha.slice(0, 7)}`);
  return [...missing, ...verdict.missing];
}

// The conditions of section 2.5 a PR does not meet at its head commit, besides who opened it, conflicts and protected
// paths, as phrases of what it waits for. audit checks a merged PR against them too, and passes authorApproves: a PR
// one of your logins opened counts as approved, since GitHub does not let you approve your own PR.
export function unmetConditions({ pr, checks, reviews, gates, apps, approvers, authorApproves = false }) {
  const head = pr.head.sha;
  const at = `on head ${head.slice(0, 7)}`;
  const missing = baseConditions({ pr, checks });
  missing.push(...reportGaps(reviews, head, at, gates.github_apps.review.roles, botLogin(apps.review)));
  if (changesRequestedOn(reviews, head)) missing.push(`answer to the changes requested ${at}`);
  if (!approved({ pr, reviews, approvers, authorApproves })) missing.push(`approval ${at}`);
  return missing;
}

// The conditions of every PR, the docs PR included: branch, title, description and CI on the head commit.
function baseConditions({ pr, checks }) {
  const missing = [];
  const placed = checkBranch(pr.head.ref, { base: pr.base.ref });
  if (!placed.ok) missing.push(`valid branch (${placed.reason})`);
  const title = checkPrTitle(pr.title ?? '');
  if (!title.ok) missing.push(`valid title (${title.reason})`);
  const described = checkDescription(pr.body);
  if (described.length > 0) missing.push(`complete description (${described.join('; ')})`);
  // A failed check is also half of changes-requested; this line already says it.
  if (!checks.green) missing.push(`CI green on head ${pr.head.sha.slice(0, 7)}`);
  return missing;
}

// Each role of the review App needs a report posted by that App on the head commit; the latest one of each role must
// be readable and leave no Critical or High finding open. A security report of the new part counts with the reports
// before it, whatever their commit: the earlier findings it does not list as Fixed stay open (openFindings).
export function reportGaps(reviews, head, at, roles, bot) {
  const reports = reviews.filter((r) => r.user?.login === bot).map((r) => ({ ...readReviewReport(r.body, roles), sha: r.commit_id }));
  return roles.flatMap((role) => {
    const mine = reports.filter((report) => report.role === role);
    const index = mine.findLastIndex((report) => report.sha === head);
    const latest = mine[index];
    if (!latest) return [`${role} report ${at}`];
    if (!latest.ok) return [`readable ${role} report ${at} (${latest.problems.join('; ')})`];
    const open = openCounts(mine.slice(0, index + 1)).at(-1);
    if (open > 0) return [`${role} report ${at} without Critical or High findings (${open} open)`];
    return [];
  });
}

// An approval as merge-gate needs it: the latest deciding review of one of your logins approves the head commit, so a
// push after it needs a new approval. With authorApproves, a PR you opened is approved.
export function approved({ pr, reviews, approvers, authorApproves = false }) {
  if (authorApproves && approvers.includes(pr.user?.login)) return true;
  return approvers.some((login) => {
    const last = lastDecision(reviews, login);
    return last?.state === 'APPROVED' && last.commit_id === pr.head.sha;
  });
}

// The protected paths among the PR's files; a renamed file counts by its old name too.
export function protectedPaths(files, gates) {
  const names = files.flatMap(({ filename, previous_filename: previous }) => (previous ? [previous, filename] : [filename]));
  return [...new Set(names.filter((name) => gates.protected_paths.some(({ path }) => matchesGlob(path, name))))];
}

// The body of the squash commit: the header of each commit of the PR, merge commits left out, so the Sub-task keys
// stay on the base branch.
function squashBody(commits) {
  return commits
    .filter(({ parents }) => parents.length < 2)
    .map(({ commit }) => `- ${commit.message.split('\n', 1)[0]}`)
    .join('\n');
}
