// The facts ao-step.mjs decides on (dev-workflow spec 2.2): a work item and its Epic from Jira, the docs PR of the Epic
// and the newest PR of the item from GitHub, and the ledger and run state in .ai/. Every reader takes its clients:
// `jira` (lib/tracker/jira-client.mjs, the agent token), `github` (lib/tracker/github-client.mjs, the read-only token of
// ao-review) and `local` ({ ledger(key), runState(key), runStates() }, the files in .ai/). Nothing here writes.
// The contract guards come from lib/tracker/facts.mjs, not written again.
import { docsPullRequest, gatePassage } from '../quality/docs-pr.mjs';
import { docsRule } from '../quality/gates.mjs';
import { approved, botLogin, protectedPaths } from '../quality/merge-gate.mjs';
import { openFindings, readReviewReport } from '../quality/pull-request.mjs';
import { parseBranch } from '../tracker/conventions.mjs';
import { expectedOptions } from '../tracker/expected.mjs';
import { changesRequestedOn, githubGuards, jiraGuards, qaEnvironment, readChecks } from '../tracker/facts.mjs';
import { latestFlagComment } from '../tracker/flags.mjs';
import { countRework } from '../tracker/rework.mjs';
import { openRequests } from './requests.mjs';
import { cutPoint } from '../release/cut.mjs';
import { parseHistory } from '../release/release-cut.mjs';
import { regressionResult } from '../release/release-pr.mjs';
import { latestTag, nextPatch, nextRelease } from '../release/versions.mjs';

const GATES = ['spec-approval', 'plan-approval'];

// role → the value of the Agent field, such as { ba: 'Business Analyst' }.
export function agentNames(contract, mapping) {
  const values = contract.work_item_fields.find(({ id }) => id === 'agent').values;
  const names = expectedOptions(contract, mapping, 'agent');
  return Object.fromEntries(values.map(({ id }, i) => [id, names[i]]));
}

// The dev role and the effort a work item's labels name (tracker/jira.yaml, work_labels): ao-fe-dev → fe-dev,
// ao-effort-xhigh → xhigh. Only roles of the roster and efforts claude takes count; null when there is none.
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export function workLabels(labels, mapping, roster) {
  const { role_prefix: rolePrefix, effort_prefix: effortPrefix } = mapping.work_labels;
  const efforts = labels.filter((label) => label.startsWith(effortPrefix)).map((label) => label.slice(effortPrefix.length)).filter((e) => EFFORTS.includes(e));
  const roles = labels.filter((label) => label.startsWith(rolePrefix) && !label.startsWith(effortPrefix)).map((label) => label.slice(rolePrefix.length)).filter((r) => roster.roles[r]);
  return { role: roles[0] ?? null, roles, effort: efforts.sort((a, b) => EFFORTS.indexOf(b) - EFFORTS.indexOf(a))[0] ?? null };
}

// The contract work type and state of a Jira type and status, or nulls.
function locate(type, status, contract, mapping) {
  const workType = contract.work_types.find(({ jira_issue_type: name }) => name === type)?.id ?? null;
  const workflowId = workType && Object.keys(contract.workflows).find((id) => contract.workflows[id].applies_to.includes(workType));
  const states = workflowId ? mapping.workflows[workflowId].states : {};
  return { workType, state: Object.keys(states).find((id) => states[id].status === status) ?? null };
}

// One work item with everything ao-step decides on. ctx: { contract, mapping, roster }.
export async function readWorkItem(jira, key, ctx) {
  const { contract, mapping, roster } = ctx;
  const path = `/rest/api/3/issue/${encodeURIComponent(key)}`;
  const agentField = await fieldId(jira, mapping.fields.agent.jira_field);
  const { key: found, fields } = await jira.get(path, { fields: ['summary', 'issuetype', 'status', 'labels', 'parent', 'subtasks', 'issuelinks', agentField].join(',') });
  const histories = await jira.getAll(`${path}/changelog`);
  const comments = await jira.getAll(`${path}/comment`, {}, 'comments');
  const { workType, state } = locate(fields.issuetype.name, fields.status.name, contract, mapping);
  const names = agentNames(contract, mapping);
  const labels = fields.labels ?? [];
  const flagged = labels.includes(mapping.needs_you_label);
  const subtasks = [];
  for (const { key: sub } of fields.subtasks ?? []) {
    const { fields: f } = await jira.get(`/rest/api/3/issue/${encodeURIComponent(sub)}`, { fields: 'summary,issuetype,status,labels' });
    subtasks.push({ key: sub, summary: f.summary, ...locate(f.issuetype.name, f.status.name, contract, mapping), status: f.status.name, labels: f.labels ?? [], flagged: (f.labels ?? []).includes(mapping.needs_you_label), ...workLabels(f.labels ?? [], mapping, roster) });
  }
  return {
    key: found,
    type: fields.issuetype.name,
    workType,
    state,
    status: fields.status.name,
    summary: fields.summary,
    labels,
    ...workLabels(labels, mapping, roster),
    agent: Object.keys(names).find((role) => names[role] === fields[agentField]?.value) ?? null,
    rework: workType ? countRework(histories, { contract, mapping, workType }) : 0,
    flagged,
    flag: flagged ? (latestFlagComment(comments)?.kind ?? 'other') : null,
    parent: fields.parent ? { key: fields.parent.key, type: fields.parent.fields.issuetype.name, status: fields.parent.fields.status.name } : null,
    subtasks,
    blockedBy: blockedByOf(fields),
    gates: workType === 'epic' ? gateTimes(histories, contract, mapping) : {},
    children: workType === 'epic' ? await readChildren(jira, found, ctx) : [],
    requests: openRequests(comments, names),
  };
}

// The keys of the items that block this one: the inward side of its "is blocked by" links.
const blockedByOf = (fields) => (fields.issuelinks ?? []).filter(({ type, inwardIssue }) => type?.inward === 'is blocked by' && inwardIssue).map(({ inwardIssue }) => inwardIssue.key);

// The Stories, Tasks and Bugs of an Epic, which ba creates in stage plan.
// Each comes with its Sub-tasks: a Story split into Sub-tasks carries its role and effort labels on them.
async function readChildren(jira, epic, { contract, mapping, roster, space }) {
  const item = ({ key, fields }) => ({ key, summary: fields.summary, ...locate(fields.issuetype.name, fields.status.name, contract, mapping), status: fields.status.name, labels: fields.labels ?? [], blockedBy: blockedByOf(fields), fixVersions: (fields.fixVersions ?? []).map(({ name, released }) => ({ name, released: Boolean(released) })), ...workLabels(fields.labels ?? [], mapping, roster) });
  const found = await jira.searchAll(`project = "${space}" AND parent = "${epic}"`, ['summary', 'issuetype', 'status', 'labels', 'issuelinks', 'fixVersions']);
  const keys = found.map(({ key }) => `"${key}"`);
  const subtasks = keys.length > 0 ? await jira.searchAll(`project = "${space}" AND parent in (${keys.join(', ')})`, ['summary', 'issuetype', 'status', 'labels', 'parent']) : [];
  return found.map((child) => ({ ...item(child), subtasks: subtasks.filter(({ fields }) => fields.parent?.key === child.key).map(item) }));
}

// When the Epic last passed each gate, from its changelog: { 'spec-approval': ms | null, 'plan-approval': ms | null }.
function gateTimes(histories, contract, mapping) {
  const times = {};
  for (const gate of GATES) {
    const passage = gatePassage(contract, mapping, gate);
    const moves = histories.filter(({ items }) => items.some((c) => c.field === 'status' && passage.from.includes(c.fromString) && c.toString === passage.to));
    times[gate] = moves.length > 0 ? Math.max(...moves.map(({ created }) => Date.parse(String(created).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')))) : null;
  }
  return times;
}

async function fieldId(jira, name) {
  const field = (await jira.get('/rest/api/3/field')).find((f) => f.name === name);
  if (!field) throw new Error(`Jira has no field ${name}`);
  return field.id;
}

// GET that answers null on 404.
async function maybe(read) {
  try {
    return await read();
  } catch (error) {
    if (error.status === 404 || /returned 404/.test(error.message)) return null;
    throw error;
  }
}

// The PRs of a work item's branches, newest first.
export async function pullsOf(github, key) {
  const all = await github.getAll('/pulls', { state: 'all', sort: 'created', direction: 'desc' });
  return all.filter(({ head }) => parseBranch(head.ref)?.key === key);
}

// The CI of a commit. The read-only token of ao-review has no Commit statuses permission (spec 2.3), so GitHub refuses
// the older commit statuses (T12): CI is then read from the check runs alone, where GitHub Actions reports. merge-gate
// and audit, with the workflow token, still read both.
function checksOf(github, sha) {
  const get = async (path, query) => {
    try {
      return await github.get(path, query);
    } catch (error) {
      if (path.endsWith('/status') && (error.status === 403 || /returned 403/.test(error.message))) return { state: null, total_count: 0, statuses: [] };
      throw error;
    }
  };
  return readChecks({ ...github, get }, sha);
}

// One PR with its CI, the review reports of the ao-review App and your decision. ctx: { gates, apps, approvers }.
export async function readPullRequest(github, number, { gates, apps, approvers = [], space }) {
  const pr = await github.get(`/pulls/${number}`);
  const head = pr.head.sha;
  const [reviews, files, checks] = [await github.getAll(`/pulls/${number}/reviews`), await github.getAll(`/pulls/${number}/files`), await checksOf(github, head)];
  const { reports, securityFull } = reviewReports(reviews, { roles: gates.github_apps.review.roles, bot: botLogin(apps.review), head });
  // From the newest full security report to the head, for a review of the new part only (spec 2.6).
  const since = reports.security && !reports.security.onHead ? securityFull?.sha : null;
  const compare = since ? await maybe(() => github.get(`/compare/${since}...${head}`)) : null;
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? '',
    state: pr.state,
    securityCompare: compare && { base: since, status: compare.status, files: (compare.files ?? []).map(({ filename, previous_filename: previous, additions, deletions }) => ({ filename, previous_filename: previous, additions, deletions })) },
    merged: Boolean(pr.merged_at),
    mergeCommit: pr.merged_at ? pr.merge_commit_sha : null,
    draft: Boolean(pr.draft),
    author: pr.user?.login ?? null,
    headRef: pr.head.ref,
    headSha: head,
    base: pr.base.ref,
    // A renamed file by both names, as protectedPaths counts it: moved out of a risky path, it is still risky.
    files: files.flatMap(({ filename, previous_filename: previous }) => (previous ? [previous, filename] : [filename])),
    protectedPaths: protectedPaths(files, gates),
    docsEpic: docsPullRequest({ pr, files, gates, apps, space }),
    ci: { green: checks.green, failed: checks.failed, pending: !checks.green && !checks.failed, started: checks.started },
    reports,
    securityFull,
    changesRequested: changesRequestedOn(reviews, head),
    approved: approved({ pr, reviews, approvers }),
  };
}

// The review reports the ao-review App (`bot`) posted among `reviews` (oldest first): the newest of each role, and the
// newest full security report, the one without a Scope line, that a review of the new part counts from (spec 2.6).
// Each is { sha, at, ok, blocking, state, onHead } or null.
export function reviewReports(reviews, { roles, bot, head }) {
  const all = reviews
    .filter((r) => r.user?.login === bot)
    .map((r) => ({ ...readReviewReport(r.body, roles), sha: r.commit_id, at: r.submitted_at, state: r.state }));
  // open: the Critical and High findings open after the report, with those a report of the new part carries
  // (openFindings), for the next review of the new part to check; blocking: how many.
  const after = new Map(roles.flatMap((role) => {
    const mine = all.filter((report) => report.role === role);
    return openFindings(mine).map((open, i) => [mine[i], open]);
  }));
  const named = (report) => (after.get(report) ?? []).map(({ severity, where, finding }) => ({ severity, where, finding }));
  const brief = (report) => (report ? { sha: report.sha, at: report.at, ok: report.ok, blocking: named(report).length, open: named(report), state: report.state, onHead: report.sha === head } : null);
  const reports = Object.fromEntries(roles.map((role) => [role, brief(all.filter((report) => report.role === role).at(-1))]));
  return { reports, securityFull: brief(all.filter((report) => report.role === 'security' && !report.scope).at(-1)) };
}

// The docs PR of an Epic: its branch, whether it is here or on GitHub, its newest PR, and the SPEC, design and plan on
// it. Stage spec commits on the docs branch of this checkout and pushes only with the docs PR (spec 2.4), so when the
// branch is here (`local`: { branch(name), file(branch, path) }), the documents are read from it, not from GitHub.
export async function readDocs(github, epic, { gates, apps, approvers, space }, local) {
  const { branch } = docsRule(gates, epic);
  const here = Boolean(local?.branch?.(branch));
  const exists = here || Boolean(await maybe(() => github.get(`/branches/${encodeURIComponent(branch)}`)));
  // A merged docs PR may have its branch deleted; its PR is still listed.
  const pulls = (await github.getAll('/pulls', { state: 'all', sort: 'created', direction: 'desc' })).filter(({ head }) => head.ref === branch);
  const file = async (name) => {
    if (here) return local.file(branch, `docs/specs/${epic}/${name}`);
    if (!exists) return null;
    const found = await maybe(() => github.get(`/contents/docs/specs/${epic}/${name}`, { ref: branch }));
    return found?.content ? Buffer.from(found.content, 'base64').toString('utf8') : null;
  };
  return {
    branch,
    exists,
    pr: pulls[0] ? await readPullRequest(github, pulls[0].number, { gates, apps, approvers, space }) : null,
    spec: await file('spec.md'),
    design: await file('design.md'),
    plan: await file('plan.md'),
  };
}

// The facts of one command. For a PR command (review, fix) `arg` is the PR number and the item is the one of its
// branch; for the others it is a work item key, or nothing for status. ctx: { contract, mapping, roster, gates, apps,
// approvers, space }.
export async function gatherFacts({ command, arg, jira, github, local, ...ctx }) {
  if (command === 'status' && !arg) return { command, space: ctx.space, ...(await readSpace({ jira, github, local, ...ctx })) };
  // A release command works on the release, not on one item (release-workflow spec 2.6, 2.7).
  if (command === 'release') return { command, arg, extra: ctx.extra, space: ctx.space, item: null, runKey: arg ?? 'release', release: await readCutFacts({ jira, ...ctx }) };
  // vX.Y.0 ships a release; vX.Y.Z with Z > 0 a hotfix (spec 2.7, 2.8).
  if (command === 'ship' && /\.0$/.test(arg)) return { command, arg, space: ctx.space, item: null, runKey: arg, ship: await readShipFacts({ jira, github, local, ...ctx, version: arg }) };
  if (command === 'ship') return { command, arg, space: ctx.space, item: null, runKey: arg, hotfix: await readHotfixFacts({ jira, github, ...ctx, version: arg }) };
  if (command === 'rollback') return { command, arg, extra: ctx.extra, space: ctx.space, item: null, runKey: `rollback-${arg}`, rollback: await readRollbackFacts({ ...ctx, environment: arg, extra: ctx.extra }) };
  let pr = null;
  let key = arg;
  if (['review', 'fix'].includes(command)) {
    pr = await readPullRequest(github, Number(arg), ctx);
    key = pr.docsEpic ?? parseBranch(pr.headRef)?.key ?? null;
    if (!key) return { command, arg, space: ctx.space, pr, item: null };
    // The agent token may read other spaces; ao-step works in its own (spec 2.2).
    if (!key.startsWith(`${ctx.space}-`)) return { command, arg, space: ctx.space, pr, item: null, outside: key };
  }
  const item = await readWorkItem(jira, key, ctx);
  const epicKey = item.workType === 'epic' ? item.key : item.parent?.type === epicType(ctx.contract) ? item.parent.key : null;
  const epic = epicKey === item.key ? item : epicKey ? await readWorkItem(jira, epicKey, ctx) : null;
  const docs = epicKey ? await readDocs(github, epicKey, ctx, local) : null;
  if (!pr && item.workType !== 'epic') {
    const [newest] = await pullsOf(github, item.key);
    pr = newest ? await readPullRequest(github, newest.number, ctx) : null;
  }
  // /ao-qa reads deployments with your gh login (`deploys`): the read token of ao-review may not (release-workflow T12).
  const qa = command === 'qa' && pr ? await readQaFacts(ctx.deploys, pr, ctx) : undefined;
  // A kit another project reviewed needs no agent (kit-copy-review spec 2.1). Only on an open PR with green CI, which
  // /ao-review would review, and while a report is missing on its head: the compare reads GitHub and renders the agents
  // (review of ao-pilot PR #24). ctx.kitCopy(pr) resolves to null when the PR claims no such thing.
  const missing = pr && ctx.gates.github_apps.review.roles.some((role) => !pr.reports[role]?.onHead);
  const reviewable = pr?.state === 'open' && pr.ci.green;
  const kitCopy = command === 'review' && reviewable && missing && ctx.kitCopy ? await ctx.kitCopy(pr) : null;
  const guards = item.workType && item.workType !== 'epic' ? await githubGuards(github, { item, needed: ['dependencies-merged'], contract: ctx.contract, mapping: ctx.mapping }) : [];
  return {
    command,
    arg,
    space: ctx.space,
    item,
    epic,
    docs,
    pr,
    dependenciesMerged: guards.includes('dependencies-merged'),
    ...(qa && { qa }),
    ...(kitCopy && { kitCopy }),
    wip: await readWip(jira, item, ctx),
    ledger: local.ledger(item.key),
    // The Sub-tasks with a ledger: the agents of a split Story keep one per Sub-task.
    subtaskLedgers: (item.subtasks ?? []).filter(({ key: sub }) => local.ledger(sub)).map(({ key: sub }) => sub),
    run: local.runState(item.key),
  };
}

const epicType = (contract) => contract.work_types.find(({ id }) => id === 'epic').jira_issue_type;

// Room under the WIP limits: Epics shaping (spec or plan) and each dev agent the item would start.
async function readWip(jira, item, { contract, mapping }) {
  const limit = (id) => contract.wip_limits.find((w) => w.id === id).limit;
  const [workflowId] = Object.entries(contract.workflows).find(([, w]) => w.applies_to.includes('epic'));
  const shaping = ['specifying', 'planning'].map((state) => mapping.workflows[workflowId].states[state].status);
  const space = item.key.slice(0, item.key.lastIndexOf('-'));
  const epics = await jira.searchAll(`project = "${space}" AND issuetype = "${epicType(contract)}" AND status in (${shaping.map((s) => `"${s}"`).join(', ')})`, ['status']);
  const devAgent = {};
  for (const role of new Set([item.role, ...item.subtasks.map(({ role }) => role)].filter(Boolean))) {
    devAgent[role] = (await jiraGuards(jira, { item, actor: role, needed: ['wip-available'], contract, mapping })).includes('wip-available');
  }
  return { epicShaping: { used: epics.length, limit: limit('epic-shaping') }, devAgent };
}

// /ao-status without a key: every item of the space not done, the open PRs, and the runs in .ai/runs/.
async function readSpace({ jira, github, deploys, local, contract, mapping, roster, space }) {
  const names = agentNames(contract, mapping);
  const found = await jira.searchAll(`project = "${space}" AND statusCategory != Done ORDER BY Rank ASC`, ['summary', 'issuetype', 'status', 'labels', 'parent', 'comment']);
  const items = found.map(({ key, fields }) => {
    const labels = fields.labels ?? [];
    const comments = fields.comment?.comments ?? [];
    const flagged = labels.includes(mapping.needs_you_label);
    return {
      key,
      type: fields.issuetype.name,
      ...locate(fields.issuetype.name, fields.status.name, contract, mapping),
      status: fields.status.name,
      summary: fields.summary,
      labels,
      ...workLabels(labels, mapping, roster),
      flagged,
      flag: flagged ? (latestFlagComment(comments)?.kind ?? 'other') : null,
      parent: fields.parent?.key ?? null,
      requests: openRequests(comments, names),
    };
  });
  // An Epic In Progress with its items: /ao-status says when it can be completed.
  for (const epic of items.filter(({ workType, state }) => workType === 'epic' && state === 'in-progress')) epic.children = await readChildren(jira, epic.key, { contract, mapping, roster, space });
  const pulls = (await github.getAll('/pulls', { state: 'open', sort: 'created', direction: 'asc' })).map((pr) => ({ number: pr.number, title: pr.title, headRef: pr.head.ref, key: parseBranch(pr.head.ref)?.key ?? null, draft: Boolean(pr.draft) }));
  // The release lines of /ao-status need deployments, which only your gh login reads (release-workflow T12, T16).
  const release = deploys ? await readStatusRelease({ jira, deploys, contract, mapping, space }) : undefined;
  return { items, pulls, runs: local.runStates(), ...(release && { release }) };
}

// The login of the deployer on GitHub: the bot of the App ao-deploy, whose slug is <owner>-ao-deploy (docs/github-apps-setup.md).
const DEPLOYER = /-ao-deploy\[bot\]$/;

// The release running in each environment of the mapping (release-workflow spec 2.5): the newest deployment whose
// latest status is success, as { sha, deployment, url }, or null. GitHub sets the older ones inactive when a new one
// succeeds, so a newer deploy that failed, or one still under way, leaves the one before running.
export async function readRunning(github, mapping) {
  const running = {};
  for (const [env, { github_environment: environment }] of Object.entries(mapping.environments)) {
    running[env] = null;
    for (const { id, sha } of await github.get('/deployments', { environment, per_page: 30 })) {
      const [latest] = await github.get(`/deployments/${id}/statuses`, { per_page: 1 });
      // Only the deployer's word counts: qa sends the basic auth to the URL of this status (security, ao-pilot PR #17).
      if (latest?.state !== 'success' || !DEPLOYER.test(latest.creator?.login ?? '')) continue;
      running[env] = { sha, deployment: id, url: latest.environment_url ?? null };
      break;
    }
  }
  return running;
}

// Whether the commit `running` holds `commit`: it is that commit, or comes after it.
export async function contains(github, running, commit) {
  if (running === commit) return true;
  return ['ahead', 'identical'].includes((await github.get(`/compare/${commit}...${running}`)).status);
}

// What the release commands decide on, besides the item (release-workflow spec 2.6 to 2.9): the release running in
// each environment, the release branches with commits main does not have yet, the tags, and the Fix Versions of the
// space on Jira.
export async function readReleaseFacts({ github, jira, mapping, space }) {
  const releaseBranches = [];
  for (const { ref, object } of (await maybe(() => github.getAll('/git/matching-refs/heads/release/'))) ?? []) {
    const name = ref.replace(/^refs\/heads\//, '');
    const branch = parseBranch(name);
    if (branch?.kind !== 'release') continue;
    if ((await github.get(`/compare/main...${object.sha}`)).ahead_by > 0) releaseBranches.push({ name, version: branch.version, sha: object.sha });
  }
  return {
    running: await readRunning(github, mapping),
    releaseBranches,
    tags: (await github.getAll('/tags')).map(({ name, commit }) => ({ name, sha: commit.sha })),
    versions: (await jira.get(`/rest/api/3/project/${encodeURIComponent(space)}/versions`)).map(({ name, released }) => ({ name, released: Boolean(released) })),
  };
}


// The QA facts of an item whose PR `pr` is merged (release-workflow spec 2.5): the QA environment of its route
// (routing.yaml, by the base branch of the PR), the release running there, and whether that release holds the merge.
export async function readQaFacts(deploys, pr, { contract, mapping }) {
  if (!deploys) throw new Error('/ao-qa reads deployments with your gh login: log in with gh auth login');
  const environment = qaEnvironment(contract, pr.base);
  const running = (await readRunning(deploys, mapping))[environment];
  return { environment, running, contains: Boolean(running && pr.mergeCommit && (await contains(deploys, running.sha, pr.mergeCommit))) };
}

// What /ao-release decides on (release-workflow spec 2.6): the release facts, and the cut point of develop since the
// newest tag. history(tag) resolves the first-parent history of develop after `tag` (all of it when tag is null), as
// `git log --first-parent --reverse --format=%H%x09%s` prints it. An item Jira does not answer for holds the cut point
// back like any item not Done.
export async function readCutFacts({ jira, deploys, history, contract, mapping, space }) {
  if (!deploys) throw new Error('/ao-release reads deployments with your gh login: log in with gh auth login');
  const facts = await readReleaseFacts({ github: deploys, jira, mapping, space });
  const tags = facts.tags.map(({ name }) => name);
  const newest = latestTag(tags);
  const commits = parseHistory(await history(newest), space);
  const epicType = contract.work_types.find(({ id }) => id === 'epic').jira_issue_type;
  const info = {};
  const epics = [];
  for (const key of new Set(commits.flatMap(({ keys }) => keys))) {
    const found = await maybe(() => jira.get(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: 'status,issuetype,fixVersions' }));
    if (found?.fields.issuetype.name === epicType) epics.push(key);
    info[key] = found
      ? { state: locate(found.fields.issuetype.name, found.fields.status.name, contract, mapping).state, status: found.fields.status.name, fixVersions: (found.fields.fixVersions ?? []).map(({ name }) => name) }
      : { state: null, status: 'not on Jira', fixVersions: [] };
  }
  const items = Object.fromEntries(Object.entries(info).map(([key, { state }]) => [key, state]));
  const { cut, included, after } = cutPoint({ commits, items, epics });
  const withInfo = (list) => list.map(({ key }) => ({ key, ...info[key] }));
  return { latestTag: newest, version: nextRelease(tags), commits: commits.length, cut, included: withInfo(included), after: withInfo(after), versions: facts.versions, releaseBranches: facts.releaseBranches };
}

const NOTES = ['changelog.md', 'pr-description.md', 'fix-version.md'];

// Notes of devops written before the newest regression: the release branch may hold more since, such as a Bug fixed on
// it (T21). With no run of release-notes on record, the files are taken as they are.
function notesStale(runs) {
  const last = (purpose) => runs.findLastIndex((r) => r.purpose === purpose && r.outcome === 'done');
  const notes = last('release-notes');
  return notes >= 0 && last('regression') > notes;
}

// What /ao-ship vX.Y.0 decides on (release-workflow spec 2.7): its release branch, the release Staging runs, the Bugs
// Critical and High still open with its Fix Version, the newest regression on record in .ai/runs/<version>/ (the
// commit it ran on, from state.json, and the Result line of its report), the files the branch changed since that
// commit, whether devops wrote its notes, and the open release PR. local: { runState(key), runFile(key, name) }.
export async function readShipFacts({ jira, github, deploys, local, contract, mapping, space, version }) {
  if (!deploys) throw new Error('/ao-ship reads deployments with your gh login: log in with gh auth login');
  const release = await readReleaseFacts({ github: deploys, jira, mapping, space });
  const branch = release.releaseBranches.find(({ name }) => name === `release/${version}`) ?? null;
  const bugType = contract.work_types.find(({ id }) => id === 'bug').jira_issue_type;
  const severityField = mapping.fields.severity.jira_field;
  const bugs = [];
  for (const { name } of contract.work_item_fields.find(({ id }) => id === 'severity').values.filter(({ id }) => ['critical', 'high'].includes(id))) {
    const found = await jira.searchAll(`project = "${space}" AND issuetype = "${bugType}" AND fixVersion = "${version}" AND statusCategory != Done AND "${severityField}" = "${name}"`, ['status']);
    bugs.push(...found.map(({ key }) => ({ key, severity: name })));
  }
  const last = (local.runState(version)?.runs ?? []).filter(({ purpose }) => purpose === 'regression').at(-1);
  const regression = last?.qa?.sha ? { sha: last.qa.sha, result: last.outcome === 'done' ? regressionResult(local.runFile(version, 'regression-report.md')) : null } : null;
  let changedSinceRegression = null;
  if (regression && branch) {
    const files = regression.sha === branch.sha ? [] : ((await github.get(`/compare/${regression.sha}...${branch.sha}`)).files ?? []);
    changedSinceRegression = [...new Set(files.flatMap(({ filename, previous_filename: previous }) => (previous ? [previous, filename] : [filename])))].sort();
  }
  const pr = (await github.getAll('/pulls', { state: 'open', base: 'main' })).find(({ head }) => head.ref === `release/${version}`);
  return {
    version,
    branch,
    staging: release.running.staging,
    bugs,
    regression,
    changedSinceRegression,
    notes: NOTES.every((name) => local.runFile(version, name) !== null) && !notesStale(local.runState(version)?.runs ?? []),
    pr: pr ? { number: pr.number, headSha: pr.head.sha } : null,
  };
}

// What /ao-ship vX.Y.(Z+1) decides on (release-workflow spec 2.8): the release on Production (the tag of the commit that
// runs there) and its next patch, the merge at the head of main and the Bug of its hotfix branch, what Staging runs,
// the tag of the version, a deployment request for the head of main, and the open release branches.
export async function readHotfixFacts({ jira, github, deploys, contract, mapping, space, version }) {
  if (!deploys) throw new Error('/ao-ship reads deployments with your gh login: log in with gh auth login');
  const release = await readReleaseFacts({ github: deploys, jira, mapping, space });
  const names = release.tags.map(({ name }) => name);
  const onProduction = release.running.production;
  const tagged = onProduction ? release.tags.find(({ sha }) => sha === onProduction.sha)?.name : null;
  const production = tagged ? { sha: onProduction.sha, version: tagged } : null;
  const head = (await github.get('/git/ref/heads/main')).object.sha;
  const merged = (await github.getAll(`/commits/${head}/pulls`)).find((pr) => pr.merged_at && pr.merge_commit_sha === head);
  const pull = merged ? { number: merged.number, head: merged.head.ref, key: parseBranch(merged.head.ref)?.key ?? null } : null;
  let bug = null;
  if (pull?.key) {
    const found = await maybe(() => jira.get(`/rest/api/3/issue/${encodeURIComponent(pull.key)}`, { fields: 'status,issuetype,fixVersions' }));
    if (found) bug = { key: pull.key, state: locate(found.fields.issuetype.name, found.fields.status.name, contract, mapping).state, status: found.fields.status.name, fixVersions: (found.fields.fixVersions ?? []).map(({ name }) => name) };
  }
  const requests = await deploys.get('/deployments', { environment: mapping.environments.production.github_environment, per_page: 30 });
  const request = requests.find(({ sha, payload }) => payload?.ao === 'request' && sha === head);
  return {
    version,
    production,
    expected: production ? nextPatch(names, production.version) : null,
    main: { sha: head, pull },
    bug,
    staging: release.running.staging,
    tag: release.tags.find(({ name }) => name === version) ?? null,
    request: request ? { id: request.id, sha: request.sha } : null,
    releaseBranches: release.releaseBranches,
  };
}

// What /ao-rollback <environment> [<sha>] decides on (release-workflow spec 2.9): the release that runs there, the
// releases that ran there before (a status success once, now inactive), newest first, the commit `extra` names, and a
// deployment request the deployer has not answered yet.
export async function readRollbackFacts({ deploys, mapping, environment, extra }) {
  if (!deploys) throw new Error('/ao-rollback reads deployments with your gh login: log in with gh auth login');
  let running = null;
  let requested = null;
  const earlier = [];
  for (const { id, sha, payload } of await deploys.get('/deployments', { environment: mapping.environments[environment].github_environment, per_page: 30 })) {
    const statuses = await deploys.get(`/deployments/${id}/statuses`, { per_page: 30 });
    if (statuses.length === 0 && payload?.ao === 'request' && !requested) requested = { id, sha };
    if (!statuses.some(({ state }) => state === 'success')) continue;
    if (!running && statuses[0].state === 'success') running = { sha, deployment: id };
    else if (running && sha !== running.sha && !earlier.some((e) => e.sha === sha)) earlier.push({ sha, deployment: id });
  }
  const resolved = extra ? await maybe(() => deploys.get(`/commits/${extra}`)) : null;
  return { environment, running, earlier, target: resolved ? { sha: resolved.sha } : null, requested };
}

// The release lines of /ao-status (release-workflow spec 2.2): what runs where, the release on Production and whether
// its Fix Version is Released on Jira, the open release branches, and the Stories, Tasks and Bugs Done but in no
// released Fix Version yet.
async function readStatusRelease({ jira, deploys, contract, mapping, space }) {
  const release = await readReleaseFacts({ github: deploys, jira, mapping, space });
  const onProduction = release.running.production;
  const name = onProduction ? release.tags.find(({ sha }) => sha === onProduction.sha)?.name : null;
  const version = name ? release.versions.find((v) => v.name === name) : null;
  const [workflowId] = Object.entries(contract.workflows).find(([, w]) => w.applies_to.includes('story'));
  const done = mapping.workflows[workflowId].states.done.status;
  const types = contract.work_types.filter(({ id }) => ['story', 'task', 'bug'].includes(id)).map(({ jira_issue_type: type }) => `"${type}"`).join(', ');
  const found = await jira.searchAll(`project = "${space}" AND issuetype in (${types}) AND status = "${done}" AND (fixVersion is EMPTY OR fixVersion in unreleasedVersions())`, ['status']);
  return { running: release.running, productionVersion: version ? { name, released: version.released } : null, releaseBranches: release.releaseBranches, doneUnreleased: found.map(({ key }) => key) };
}
