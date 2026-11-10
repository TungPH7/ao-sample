// decideStep (dev-workflow spec 2.1, 2.2): from the facts of one command (lib/workflow/facts.mjs), GO with the runs to
// make, or STOP with the reason and the command to run instead. ao-step.mjs prints it; with --go its runner makes the
// first run, gathers the facts again and decides again, so the list after the first run is a forecast. Pure.
//
//   { go: true, runs, lines }                          runs: [{ role, key, effort, purpose, prompt, resume?, checkout? }]
//                                                      or [{ action: 'jira-sync', key }] for the second /ao-plan
//   { go: false, reason, next, lines, questions? }      questions: what an agent asked, for you to answer in the chat
//   { status: true, lines, next }                      /ao-status, which runs nothing
//
// options: { roster, contract, gates, mapping?, answers?, note? }. answers is your reply to the questions of the last run; note is what
// you wrote after the PR number of /ao-fix.
import { createHash } from 'node:crypto';
import { matchesGlob } from '../quality/glob.mjs';
import { nextMinor } from '../release/release-cut.mjs';
import { parseVersion } from '../release/versions.mjs';
import { checkBranch } from '../tracker/conventions.mjs';
import { answersPrompt, promptFor, resumePrompt } from './prompts.mjs';
import { openQuestions } from './runs.mjs';
import { fullReviewEffort, securityScope } from './security-scope.mjs';

const ASKING = ['ba', 'ux', 'sa'];
// A run that stopped before its end goes on in its session; one that failed counts towards the retry limit.
const STOPPED = ['unfinished', 'usage-limit'];
const FAILED = ['error', 'max-turns'];
// The purposes of the review runs, each on the head of a PR in a worktree.
const REVIEWS = ['review', 'review-delta'];
// sa's part of stage spec: the heading it adds under the SPEC's Objective (agents/prompts/sa.md).
const NFR = /^#{2,4}\s+Non-functional requirements\s*$/im;
// A SPEC that has screens names design.md, where ux writes them.
const SCREENS = /design\.md/;

export function decideStep(command, facts, options) {
  const decide = DECIDERS[command];
  if (!decide) throw new Error(`unknown command ${command}; use one of ${Object.keys(DECIDERS).join(', ')}`);
  return decide(facts, options);
}

const stop = (reason, next, extra = {}) => ({ go: false, reason, next, lines: [], ...extra });
const go = (runs, lines = []) => ({ go: true, runs, lines });

// A run of `role` for `purpose`, at the effort of the roster unless given.
function run(role, purpose, context, options, extra = {}) {
  return { role, key: context.key, effort: extra.effort ?? options.roster.roles[role].effort, purpose, prompt: promptFor(purpose, context), ...extra };
}

// What the run state of the item says first, for the same command: answers go to the newest run of `asker`, the role
// whose questions are open (the newest run when none is), a run that stopped goes on in its session, and a run that
// failed as many times as policies.yaml allows stops the command. null when the state says nothing.
function carryOn(command, facts, options, asker) {
  const runs = (facts.run?.runs ?? []).filter((r) => r.command === command);
  const last = runs.at(-1);
  const key = facts.item.key;
  if (options.answers !== undefined) {
    const asked = asker ? runs.filter((r) => r.role === asker).at(-1) : last;
    if (!asked || !ASKING.includes(asked.role) || !asked.session) return stop(`no run of ba, ux or sa on ${key} asked questions to answer`, `/ao-status ${key}`);
    const pr = facts.docs?.pr?.state === 'open' ? facts.docs.pr.number : undefined;
    return go([{ role: asked.role, key, effort: asked.effort, purpose: asked.purpose, resume: asked.session, prompt: answersPrompt(key, options.answers, { pr }), checkout: asked.checkout }]);
  }
  if (!last) return null;
  if (STOPPED.includes(last.outcome)) {
    // A run is on record from its start (lib/workflow/runner.mjs): one killed before the first line of its log has no
    // session, and is made afresh (reviewer of ao-pilot PR #23).
    if (!last.session) return null;
    // The head and the note stay on the record of the run: /ao-fix reads them to know a note is done.
    const goOn = { role: last.role, key, effort: last.effort, purpose: last.purpose, resume: last.session, prompt: resumePrompt(key), ...(last.head && { head: last.head }), ...(last.note && { note: last.note }) };
    if (REVIEWS.includes(last.purpose)) {
      // A review goes on only on the head it was reviewing, with its worktree back, while its report is not on that
      // head: on a new head, ao-pr would post what it wrote about the old one as the report of the new head.
      const { pr } = facts;
      if (!pr || !last.head || last.head !== pr.headSha || pr.reports?.[last.role]?.onHead) return null;
      return go([{ ...goOn, checkout: last.checkout, head: last.head, worktree: { name: `pr-${pr.number}`, sha: last.head } }]);
    }
    // A build goes on where its agent left the checkout, on the branch it made, as build-again does: the checkout of
    // its first run is develop.
    return go([{ ...goOn, checkout: last.purpose === 'build' ? undefined : last.checkout }]);
  }
  const limit = options.contract.retry.agent_failures_before_stop;
  let failures = 0;
  for (const r of [...runs].reverse()) {
    if (r.role !== last.role || r.purpose !== last.purpose || !FAILED.includes(r.outcome)) break;
    failures += 1;
  }
  if (failures >= limit) {
    return stop(`${last.role} failed ${failures} times in a row on ${key} (${last.outcome}); the contract stops after ${limit}`, `Read .ai/runs/${key}/last.md and the log of run ${last.n}, fix the cause, then run the command again`);
  }
  return null;
}

// Stops every command shares: a flagged item waits for you.
function flaggedStop(item) {
  if (!item.flagged) return null;
  const by = { 'merge-gate': 'merge-gate', audit: 'audit', rework: 'the rework limit' }[item.flag] ?? 'an agent or you';
  return stop(`${item.key} is flagged Needs you by ${by}`, `Read the newest flag comment on ${item.key}, act on it, then remove the flag and the needs-you label`);
}

function notAnEpic(item, command) {
  if (item.workType === 'epic') return null;
  return stop(`${item.key} is a ${item.type}: /ao-${command} takes an Epic`, item.workType === 'sub-task' ? `/ao-build ${item.parent?.key}` : `/ao-build ${item.key}`);
}

const questionsStop = (key, artifact, questions, asker) =>
  stop(`${asker} left ${questions.length} open question${questions.length > 1 ? 's' : ''} in docs/specs/${key}/${artifact}`, `Answer them in the chat; Claude writes your answers to .ai/runs/${key}/answers.md and runs the command again with --answers`, { questions, asker });

// /ao-spec <EPIC>: ba, ux when the SPEC has screens, sa, then ba opens the docs PR; it ends at gate ①.
function decideSpec(facts, options) {
  const { item: epic, docs } = facts;
  const key = epic.key;
  const lines = [epicLine(facts)];
  const early = notAnEpic(epic, 'spec');
  if (early) return { ...early, lines };
  const byState = {
    new: () => stop(`Epic ${key} is New: its spec has not started`, `Click Start spec on ${key}, then /ao-spec ${key}`),
    planning: () => stop(`${key} is past gate ① spec-approval`, `/ao-plan ${key}`),
  };
  if (epic.state !== 'specifying') return { ...(byState[epic.state]?.() ?? stop(`${key} is ${epic.status}: stage spec is over`, `/ao-status ${key}`)), lines };
  const blocked = flaggedStop(epic);
  if (blocked) return { ...blocked, lines };
  const { used, limit } = facts.wip.epicShaping;
  if (used > limit) return { ...stop(`${used} Epics are in Specifying or Planning, over the WIP limit epic-shaping of ${limit}`, 'Finish or cancel another Epic first'), lines };
  // Open questions come before the docs PR: questions left on an open docs PR still go to you, and to who asked them.
  const pending = specQuestions(facts);
  const carried = carryOn('spec', facts, options, pending?.asker);
  if (carried) return { ...carried, lines };
  if (pending) return { ...questionsStop(key, pending.artifact, pending.questions, pending.asker), lines };
  if (docs.pr?.state === 'open') {
    return { ...stop(`the docs PR #${docs.pr.number} of ${key} is open: stage spec is done and waits for you at gate ① spec-approval`, `Read the diff of PR #${docs.pr.number}, click Approve spec on ${key}, then /ao-plan ${key}`), lines };
  }
  const context = { key, branch: docs.branch };
  const checkout = { branch: docs.branch, from: 'develop' };
  const at = (role, purpose, extra) => run(role, purpose, context, options, { checkout, ...extra });
  if (!docs.spec) return go([at('ba', 'spec-write'), at('ux', 'design', { when: 'the SPEC has screens' }), at('sa', 'spec-nfr'), at('ba', 'docs-pr')], lines);
  const runs = [];
  if (SCREENS.test(docs.spec) && !docs.design) runs.push(at('ux', 'design'));
  if (!NFR.test(docs.spec)) runs.push(at('sa', 'spec-nfr'));
  runs.push(at('ba', 'docs-pr'));
  return go(runs, lines);
}

// The role among `roles` whose run of `command` came last: who to give the answers to.
const lastAsker = (facts, command, roles) => (facts.run?.runs ?? []).filter((r) => r.command === command && roles.includes(r.role)).at(-1)?.role;

// The open questions of stage spec, SPEC first, then design.md when the SPEC has screens: { artifact, questions, asker }
// or null.
function specQuestions(facts) {
  const { docs } = facts;
  if (!docs.spec) return null;
  const spec = openQuestions(docs.spec);
  if (spec.length > 0) return { artifact: 'spec.md', questions: spec, asker: lastAsker(facts, 'spec', ['ba', 'sa']) ?? 'ba' };
  const design = SCREENS.test(docs.spec) && docs.design ? openQuestions(docs.design) : [];
  return design.length > 0 ? { artifact: 'design.md', questions: design, asker: 'ux' } : null;
}

// /ao-plan <EPIC>: sa writes the plan, ba creates the items; it ends at gate ②. Once you approved the plan, the second
// run asks jira-sync to refine the items, and merge-gate then merges the docs PR.
function decidePlan(facts, options) {
  const { item: epic, docs } = facts;
  const key = epic.key;
  const lines = [epicLine(facts)];
  const early = notAnEpic(epic, 'plan');
  if (early) return { ...early, lines };
  if (epic.state === 'new') return { ...stop(`Epic ${key} is New: its spec has not started`, `Click Start spec on ${key}, then /ao-spec ${key}`), lines };
  if (epic.state === 'specifying') {
    const pr = docs.pr?.state === 'open' ? `Read the diff of the docs PR #${docs.pr.number}, click` : 'Run /ao-spec first; then click';
    return { ...stop(`${key} waits at gate ① spec-approval`, `${pr} Approve spec on ${key}, then /ao-plan ${key}`), lines };
  }
  const blocked = flaggedStop(epic);
  if (blocked) return { ...blocked, lines };
  if (epic.state === 'in-progress') return { ...afterPlanGate(facts), lines };
  if (epic.state !== 'planning') return { ...stop(`${key} is ${epic.status}: stage plan is over`, `/ao-status ${key}`), lines };
  const carried = carryOn('plan', facts, options, docs.plan && openQuestions(docs.plan).length > 0 ? 'sa' : undefined);
  if (carried) return { ...carried, lines };
  if (docs.pr?.state !== 'open') return { ...stop(`${key} has no open docs PR on ${docs.branch}`, `/ao-spec ${key} opens it; if it was closed, reopen it`), lines };
  // The day of gate ① in UTC, as the changelog of the Epic records it: sa writes it in the Status of the SPEC and design.
  const passed = epic.gates?.['spec-approval'];
  const context = { key, branch: docs.branch, pr: docs.pr.number, ...(passed && { approved: new Date(passed).toISOString().slice(0, 10) }) };
  const checkout = { branch: docs.branch, from: 'develop' };
  const at = (role, purpose) => run(role, purpose, context, options, { checkout });
  if (!docs.plan) return go([at('sa', 'plan-write'), at('ba', 'plan-items')], lines);
  const questions = openQuestions(docs.plan);
  if (questions.length > 0) return { ...questionsStop(key, 'plan.md', questions, 'sa'), lines };
  if (epic.children.length === 0) return go([at('ba', 'plan-items')], lines);
  // The Stories and Tasks of the Epic, and their Sub-tasks, which carry the labels when a Story is split.
  const items = epic.children.flatMap((child) => [child, ...(child.subtasks ?? [])]);
  const effort = items.filter(({ effort: e }) => e).length;
  return {
    ...stop(
      `the plan and the ${items.length} items of ${key} are done; ${effort > 0 ? `${effort} of them have an effort label` : 'none has an effort label'}. They wait for you at gate ② plan-approval`,
      `Read plan.md on the docs PR #${docs.pr.number}, click Approve plan on ${key}, then /ao-plan ${key} again`,
    ),
    lines,
  };
}

// The states in which an item has its PR merged (the `dependencies-merged` guard looks at the PR itself).
const MERGED_STATES = new Set(['ready-for-qa', 'in-qa', 'done']);

// Ready items that no unmerged item of the Epic blocks (Pilot 1, T9: the first Ready item was suggested, though its
// blocker was not merged). A blocker outside the Epic cannot be told from here: /ao-build checks it with its own guard.
function startable(children) {
  const blocked = ({ blockedBy = [] }) => blockedBy.some((key) => {
    const blocker = children.find((child) => child.key === key);
    return blocker && !MERGED_STATES.has(blocker.state);
  });
  return children.filter((child) => child.state === 'ready' && !blocked(child)).map(({ key }) => key);
}

// Past gate ②: jira-sync refines the items (refine-children) and merge-gate merges the docs PR after it.
function afterPlanGate(facts) {
  const { item: epic, docs } = facts;
  const waiting = epic.children.filter(({ state }) => state === 'new');
  if (docs.pr?.merged && waiting.length === 0) {
    const ready = epic.children.filter(({ state }) => state === 'ready');
    const [first] = startable(epic.children);
    const why = `the docs PR #${docs.pr.number} of ${epic.key} is merged and its items are refined`;
    if (!first && ready.length > 0) return stop(`${why}; every Ready item waits for an item that is not merged yet`, `/ao-status ${epic.key}`);
    return stop(why, first ? `/ao-build ${first}` : `/ao-status ${epic.key}`);
  }
  if (!docs.pr) return stop(`${epic.key} is past gate ② but has no docs PR on ${docs.branch}`, `/ao-status ${epic.key}`);
  return go([{ action: 'jira-sync', key: epic.key, then: docs.pr.merged ? null : { mergeGate: docs.pr.number } }]);
}

// /ao-status: the item and what comes next, or every item of the space.
function decideStatus(facts) {
  if (!facts.item) return spaceStatus(facts);
  const lines = [facts.item.workType === 'epic' ? epicLine(facts) : itemLine(facts)];
  const cost = (facts.run?.runs ?? []).reduce((total, r) => total + (r.costUsd ?? 0), 0);
  if (facts.run?.runs?.length) lines.push(`Runs: ${facts.run.runs.length}, ${usd(cost)} in all; the last: ${describeRun(facts.run.runs.at(-1))}`);
  for (const request of facts.item.requests) lines.push(`Open request to ${request.to}${request.from ? ` from ${request.from}` : ''}: ${request.text}`);
  return { status: true, lines, next: nextFor(facts.item, facts.pr?.state === 'open' ? facts.pr.number : null) };
}

function spaceStatus(facts) {
  const prOf = new Map(facts.pulls.filter(({ draft }) => !draft).map(({ key, number }) => [key, number]));
  const costOf = new Map(facts.runs.map(({ key, runs = [] }) => [key, runs.reduce((total, r) => total + (r.costUsd ?? 0), 0)]));
  const lines = [];
  const yours = [];
  for (const item of facts.items.filter(({ workType }) => workType !== 'sub-task')) {
    const next = nextFor(item, prOf.get(item.key) ?? null);
    const cost = costOf.get(item.key);
    lines.push(`${item.key} ${item.type} "${item.summary}": ${item.status}${item.flagged ? ', flagged' : ''}${cost ? `, ${usd(cost)}` : ''} → ${next}`);
    if (item.flagged || /^Click|^Accept/.test(next)) yours.push(`${item.key}: ${next}`);
    for (const request of item.requests) lines.push(`  open request to ${request.to}${request.from ? ` from ${request.from}` : ''}: ${request.text}`);
  }
  // release-workflow spec 2.2: what runs where, the open release branch, what is Done but not in a release yet, and the
  // Release click left on Jira for the release on Production. Read with your gh login; without it these lines are left out.
  if (facts.release) {
    const { running, productionVersion: onProduction, releaseBranches, doneUnreleased } = facts.release;
    const where = (env) => {
      const sha = running[env]?.sha;
      if (!sha) return 'nothing';
      return env === 'production' && onProduction ? `${onProduction.name} (${eight(sha)})` : eight(sha);
    };
    lines.push(`Running: Development ${where('development')}, Staging ${where('staging')}, Production ${where('production')}`);
    if (releaseBranches.length > 0) lines.push(`Open release branch: ${releaseBranches.map(({ name }) => name).join(', ')}`);
    if (doneUnreleased.length > 0) lines.push(`Done, not released yet: ${doneUnreleased.join(', ')}`);
    if (onProduction && !onProduction.released) yours.push(`${onProduction.name}: click Release on it in Jira: it runs on Production`);
  }
  return { status: true, lines: [...(yours.length > 0 ? ['Waiting for you:', ...yours.map((line) => `  ${line}`), ''] : []), ...lines], next: yours[0] ?? lines.find((line) => line.includes('→ /ao-'))?.split('→ ')[1] ?? null };
}

// The guards of complete in contract/workflows.yaml: every item of the Epic Cancelled, or Done in a release on Production.
const closed = ({ state, fixVersions = [] }) => state === 'cancelled' || (state === 'done' && fixVersions.some(({ released }) => released));

// The command or click that moves an item on, from its state.
export function nextFor(item, prNumber) {
  if (item.flagged) return `read the flag comment on ${item.key} (Needs you)`;
  if (item.workType === 'epic' && item.state === 'in-progress' && item.children?.length > 0 && item.children.every(closed)) return `Click Complete on ${item.key}`;
  const epic = { new: `Click Start spec on ${item.key}`, specifying: `/ao-spec ${item.key}`, planning: `/ao-plan ${item.key}`, 'in-progress': 'its items move on', done: 'done', cancelled: 'cancelled' };
  if (item.workType === 'epic') return epic[item.state] ?? `/ao-status ${item.key}`;
  const work = {
    new: 'waits to be refined (jira-sync after Approve plan, or you)',
    ready: `/ao-build ${item.key}`,
    'in-progress': prNumber ? `/ao-review ${prNumber}` : `/ao-build ${item.key}`,
    'in-review': prNumber ? `/ao-review ${prNumber} or /ao-fix ${prNumber}` : 'its PR is closed: /ao-status',
    'ready-for-qa': `/ao-qa ${item.key}`,
    'in-qa': `Accept or QA fail on ${item.key} after the QA report`,
    done: 'done',
    cancelled: 'cancelled',
  };
  return work[item.state] ?? `/ao-status ${item.key}`;
}

export const usd = (value) => `${value.toFixed(2)} USD`;
const describeRun = (r) => `${r.role} ${r.purpose ?? ''} ${r.outcome}${r.costUsd !== undefined ? `, ${usd(r.costUsd)}` : ''}`.replace(/\s+/g, ' ');

function epicLine({ item, docs }) {
  const pr = docs?.pr ? `docs PR #${docs.pr.number} ${docs.pr.merged ? 'merged' : docs.pr.state}` : docs?.exists ? `branch ${docs.branch}, no PR` : 'no docs branch';
  const children = item.children?.length ? `; ${item.children.length} items` : '';
  return `${item.key} ${item.type} "${item.summary}": ${item.status}; ${pr}${children}`;
}

export function itemLine({ item, pr }) {
  const subs = item.subtasks.length > 0 ? `; Sub-task ${item.subtasks.map(({ key, role }) => `${key} (${role ? `ao-${role}` : 'no role label'})`).join(', ')}` : '';
  const labels = item.subtasks.length === 0 ? `; ${item.role ? `ao-${item.role}` : 'no role label'}${item.effort ? `, ao-effort-${item.effort}` : ''}` : '';
  const state = pr ? `; PR #${pr.number} ${pr.merged ? 'merged' : pr.state}${pr.state === 'open' ? `, CI ${pr.ci.green ? 'green' : pr.ci.failed ? 'red' : 'running'}` : ''}` : '; no PR';
  return `${item.key} ${item.type} "${item.summary}": ${item.status}${subs}${labels}${state}`;
}

// The order the dev agents of a Story's Sub-tasks work in: BE first (the contract's rule for a Story with FE and BE).
const DEV_ORDER = ['be-dev', 'fe-dev', 'devops'];
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const atLeast = (effort, floor) => (EFFORT_ORDER.indexOf(effort) >= EFFORT_ORDER.indexOf(floor) ? effort : floor);
// At the second request for changes (Rework 2 or more), the dev agent works at xhigh at least (spec 2.5).
const REWORK_FLOOR = { count: 2, effort: 'xhigh' };

// /ao-build <KEY>: the dev agent of each Sub-task, BE before FE, or of the item's role label, up to an open PR.
function decideBuild(facts, options) {
  const { item, pr, docs } = facts;
  const lines = [itemLine(facts)];
  const key = item.key;
  const out = (decision) => ({ ...decision, lines: [...lines, ...(decision.lines ?? [])] });
  if (item.workType === 'epic') return out(stop(`${key} is an Epic: /ao-build takes its Stories and Tasks`, `/ao-plan ${key}`));
  if (item.workType === 'sub-task') return out(stop(`${key} is a Sub-task: /ao-build takes its Story, which runs every Sub-task in order`, `/ao-build ${item.parent?.key}`));
  const blocked = flaggedStop(item);
  if (blocked) return out(blocked);
  // A Sub-task still to build that its agent flagged waits for you: jira-guard refuses its moves until the flag is off.
  const held = item.subtasks.find(({ state, flagged }) => state !== 'done' && flagged);
  if (held) {
    return out(stop(`Sub-task ${held.key} of ${key} is flagged Needs you`, `Read the newest comment on ${held.key} and answer it there, remove the flag and the needs-you label, then /ao-build ${key}`));
  }
  if (pr?.state === 'open') return out(stop(`PR #${pr.number} of ${key} is open: the build is done`, pr.ci.failed || pr.changesRequested ? `/ao-fix ${pr.number}` : `/ao-review ${pr.number}`));
  // A Story split into Sub-tasks goes on through them: their agents keep the ledgers, one per Sub-task. Any other item
  // In Progress goes on from its own ledger.
  const subtaskLedgers = facts.subtaskLedgers ?? [];
  const split = item.subtasks.length > 0;
  const again = item.state === 'in-progress' && (split ? subtaskLedgers.length > 0 : facts.ledger);
  if (item.state !== 'ready' && !again) {
    const why = item.state === 'in-progress' ? `${key} is In Progress but has no ledger in .ai/ledger/: its run did not come from an agent of the kit` : `${key} is ${item.status}, not Ready`;
    return out(stop(why, nextFor(item, pr?.state === 'open' ? pr.number : null)));
  }
  if (!facts.dependenciesMerged) return out(stop(`an item ${key} depends on (${item.blockedBy.join(', ')}) is not merged yet`, `/ao-status ${item.blockedBy[0]}`));
  if (item.parent && docs && !docs.pr?.merged) {
    return out(stop(`the docs PR of Epic ${item.parent.key} is not merged yet`, `/ao-plan ${item.parent.key} after you approve its plan`));
  }
  const carried = carryOn('build', facts, options);
  if (carried) return out(carried);

  // Who builds what: the Sub-tasks still to do, in order, or the item itself.
  const todo = item.subtasks.filter(({ state }) => state !== 'done').sort((a, b) => DEV_ORDER.indexOf(a.role) - DEV_ORDER.indexOf(b.role) || a.key.localeCompare(b.key, undefined, { numeric: true }));
  const unlabelled = item.subtasks.length > 0 ? todo.filter(({ roles }) => roles.length !== 1) : item.roles.length !== 1 ? [item] : [];
  if (unlabelled.length > 0) {
    const which = unlabelled.map(({ key: k, roles }) => `${k} ${roles.length === 0 ? 'has no role label' : `has ${roles.length} role labels`}`).join('; ');
    return out(stop(`${which}: /ao-build does not guess who builds it`, `Ask ba to label it ${options.mapping?.work_labels?.role_prefix ?? 'ao-'}<role> (be-dev, fe-dev or devops), then /ao-build ${key}`));
  }
  if (item.subtasks.length > 0 && todo.length === 0) return out(stop(`every Sub-task of ${key} is done, and it has no open PR`, `/ao-status ${key}`));
  const effortOf = (work) => work.effort ?? item.effort ?? options.roster.roles[work.role].effort;
  if (item.state === 'ready') {
    for (const role of new Set((todo.length > 0 ? todo : [item]).map(({ role: r }) => r))) {
      if (facts.wip.devAgent[role] === false) return out(stop(`${role} is at its WIP limit dev-agent: it has an item In Progress already`, `/ao-status`));
    }
  }
  if (again && !split) return out(go([{ role: item.agent && DEV_ORDER.includes(item.agent) ? item.agent : item.role, key, effort: effortOf(item), purpose: 'build', prompt: promptFor('build-again', { key, status: item.status }) }]));
  if (item.subtasks.length === 0) {
    return out(go([{ role: item.role, key, effort: effortOf(item), purpose: 'build', prompt: promptFor('build', { key, type: item.type, status: item.status }), checkout: { branch: 'develop', pull: true } }]));
  }
  const done = item.subtasks.filter(({ state }) => state === 'done');
  const runs = todo.map((sub, i) => {
    const previous = i === 0 ? done.at(-1)?.key : todo[i - 1].key;
    const last = i === todo.length - 1;
    const first = i === 0 && !previous;
    const context = { key: sub.key, story: key, role: sub.role, status: item.status, previous, last };
    // A Sub-task its agent started and left a ledger for goes on from that ledger, on the branch it is on.
    if (sub.state === 'in-progress' && subtaskLedgers.includes(sub.key)) {
      return { role: sub.role, key: sub.key, story: key, effort: effortOf(sub), purpose: 'build', prompt: promptFor('build-again', { key: sub.key, status: sub.status }) };
    }
    return { role: sub.role, key: sub.key, story: key, effort: effortOf(sub), purpose: 'build', prompt: promptFor(first ? 'build-first' : 'build-next', context), ...(first && { checkout: { branch: 'develop', pull: true } }) };
  });
  return out(go(runs));
}

// The review runs a PR still needs on its head: reviewer always on the whole PR, security on the whole PR or on the
// new part only (spec 2.6). Each starts on the base branch of the PR, a protected one (baseStop): what steers an agent
// (.claude/, CLAUDE.md, hooks) is read from the checkout. The code of the PR is in a worktree at its head, without the
// instruction files Claude Code loads (Pilot 1, T10 and the reviews of ao-sample PR #13). ao-step itself and the kit are
// those of the branch checked out when the command starts; ao-step starts a review or a fix only on a protected branch,
// and goes back to the base of the PR when a command ends with the PR open (checkoutStop, homeBranch in ao-step.mjs).
function reviewRuns(facts, options) {
  const { pr, item } = facts;
  const runs = [];
  // head: kept in state.json, so a stopped review goes on only on the head it was reviewing (carryOn).
  const place = { checkout: { branch: pr.base, pull: true }, worktree: { name: `pr-${pr.number}`, sha: pr.headSha }, head: pr.headSha };
  if (!pr.reports.reviewer?.onHead) runs.push({ role: 'reviewer', key: item.key, effort: options.roster.roles.reviewer.effort, purpose: 'review', prompt: promptFor('review', { pr: pr.number }), ...place });
  const scope = securityScope({ report: pr.reports.security, full: pr.securityFull, compare: pr.securityCompare, gates: options.gates });
  if (scope.mode === 'full') {
    const { effort, reason } = fullReviewEffort({ files: pr.files ?? [], protectedPaths: pr.protectedPaths, item, gates: options.gates, rosterEffort: options.roster.roles.security.effort });
    runs.push({ role: 'security', key: item.key, effort, purpose: 'review', prompt: promptFor('review', { pr: pr.number }), ...place, scope: scope.reason, effortWhy: reason });
  }
  if (scope.mode === 'delta') {
    // high, or the roster's effort when the new part is on a protected path (Pilot 1, second review of ao-sample PR #13).
    const effort = scope.protected ? options.roster.roles.security.effort : 'high';
    runs.push({ role: 'security', key: item.key, effort, purpose: 'review-delta', prompt: promptFor('review-delta', { pr: pr.number, since: scope.since, at: scope.at, earlier: scope.earlier }), ...place, scope: scope.reason });
  }
  return runs;
}

// Why a PR command cannot run on this PR, or null.
function prStop(facts, command, { gates }) {
  const { pr } = facts;
  if (!pr) return stop(`PR #${facts.arg} was not found`, '/ao-status');
  if (pr.state !== 'open') return stop(`PR #${pr.number} is ${pr.merged ? 'merged' : 'closed'}`, facts.item ? `/ao-status ${facts.item.key}` : '/ao-status');
  if (pr.docsEpic) return stop(`PR #${pr.number} is the docs PR of ${pr.docsEpic}: merge-gate merges it after gate ②, with no review`, `/ao-plan ${pr.docsEpic}`);
  if (facts.outside) return stop(`PR #${pr.number} is on ${pr.headRef}, whose item ${facts.outside} is not in ${facts.space}: ao-step works in ${facts.space} only`, '/ao-status');
  if (!facts.item) return stop(`PR #${pr.number} is on ${pr.headRef}, which is not the branch of a work item`, '/ao-status');
  return baseStop(pr, gates) ?? flaggedStop(facts.item) ?? (command === 'review' && pr.ci.pending ? stop(`CI is still running on the head ${pr.headSha.slice(0, 7)} of PR #${pr.number}`, `/ao-review ${pr.number} once CI is done`) : null);
}

// The reviews run on a checkout of the PR's base, whose .claude/ and kit steer the agents. Its author chooses the base
// and can change it after CI has run, so it must be a protected branch, and the one its branch is cut from (Pilot 1,
// review of ao-sample PR #13).
function baseStop(pr, gates) {
  const next = `/ao-review ${pr.number} once its base on GitHub is the branch it was cut from`;
  if (!gates.protected_branches.some((pattern) => matchesGlob(pattern, pr.base))) {
    return stop(`PR #${pr.number} goes into ${pr.base}, which is not a protected branch (${gates.protected_branches.join(', ')}): its review would run on a branch the PR author controls`, next);
  }
  const branch = checkBranch(pr.headRef, { base: pr.base });
  return branch.ok ? null : stop(`PR #${pr.number} goes into ${pr.base}, but ${branch.reason.replace(/, not .*$/, '')}`, next);
}

// /ao-review <PR>: reviewer, then security; it ends at gate ③ with both reports on the head.
function decideReview(facts, options) {
  const lines = facts.item ? [itemLine(facts)] : [];
  const early = prStop(facts, 'review', options);
  if (early) return { ...early, lines };
  const { pr } = facts;
  if (pr.ci.failed) return { ...stop(`CI is red on the head ${pr.headSha.slice(0, 7)} of PR #${pr.number}`, `/ao-fix ${pr.number}`), lines };
  const carried = carryOn('review', facts, options);
  if (carried) return { ...carried, lines };
  // A kit another project reviewed in full: ao-step posts the reports, with no agent (kit-copy-review spec 2.1). A report
  // an agent already put on the head stays. Any doubt falls through to the review by the agents.
  const { kitCopy } = facts;
  // Its report is a full one, which would clear the findings still open: those go to /ao-fix and the review of the new
  // part, as on any PR (review of ao-pilot PR #24).
  const open = Object.entries(pr.reports).filter(([, report]) => report?.blocking > 0).map(([role, report]) => `${role} ${report.blocking}`);
  if (kitCopy && !kitCopy.ok) lines.push(`Kit review: ${kitCopy.reason}, so the agents review the PR`);
  else if (kitCopy && open.length > 0) lines.push(`Kit review: PR #${pr.number} still has Critical or High findings open (${open.join(', ')}), so the agents review the PR`);
  if (kitCopy?.ok && open.length === 0) {
    const roles = options.gates.github_apps.review.roles.filter((role) => !pr.reports[role]?.onHead);
    if (roles.length > 0) return go([{ action: 'kit-copy-reports', key: facts.item.key, number: pr.number, title: pr.title, sha: pr.headSha, roles, reference: kitCopy.reference, compared: kitCopy.compared }], lines);
  }
  const runs = reviewRuns(facts, options);
  if (runs.length > 0) return go(runs, lines);
  return { ...afterReviews(facts), lines };
}

// Both reports are on the head: a blocking finding goes back to the dev agent, otherwise you approve.
function afterReviews({ pr }) {
  const blocking = Object.entries(pr.reports).filter(([, report]) => report?.blocking > 0).map(([role, report]) => `${role} ${report.blocking}`);
  if (blocking.length > 0 || pr.changesRequested) return stop(`the reports on the head of PR #${pr.number} ask for changes${blocking.length ? ` (Critical or High: ${blocking.join(', ')})` : ''}`, `/ao-fix ${pr.number}`);
  const yours = pr.protectedPaths.length > 0 ? `, then Squash and merge it yourself: it changes ${pr.protectedPaths.join(', ')}` : '; merge-gate merges it';
  return stop(`both reports are on the head ${pr.headSha.slice(0, 7)} of PR #${pr.number}: it waits for you at gate ③ merge-approval`, `Read the reports and the diff of PR #${pr.number}, approve it${yours}`);
}

// /ao-fix <PR> [what to fix]: the dev agent of the item, then the reviews again.
function decideFix(facts, options) {
  const lines = facts.item ? [itemLine(facts)] : [];
  const early = prStop(facts, 'fix', options);
  if (early) return { ...early, lines };
  const { pr, item } = facts;
  const carried = carryOn('fix', facts, { ...options, answers: undefined });
  if (carried) return { ...carried, lines };
  // A fix of the same note pushed already: what is left is the reviews of the new head. The newest fix run with a note
  // counts, not the newest run of the command, which is a review once the reviewer ran (Pilot 1, PR #4 of ao-sample), nor
  // the newest fix run, which has no note when it fixed a finding (review test of 2026-11-07).
  const asked = options.note?.trim() || undefined;
  const lastNoted = (facts.run?.runs ?? []).filter((r) => r.command === 'fix' && r.purpose === 'fix' && r.note).at(-1);
  const fixed = Boolean(asked) && lastNoted?.outcome === 'done' && lastNoted.head !== pr.headSha && lastNoted.note === noteKey(asked);
  const reasons = [];
  if (pr.changesRequested) reasons.push(`the changes requested on ${pr.headSha.slice(0, 7)}`);
  if (pr.ci.failed) reasons.push(`the red CI on ${pr.headSha.slice(0, 7)}`);
  for (const [role, report] of Object.entries(pr.reports)) if (report?.onHead && report.blocking > 0) reasons.push(`the ${report.blocking} Critical or High findings of the ${role} report`);
  const note = fixed ? undefined : asked;
  if (note) reasons.push('what the human asks below');
  if (reasons.length === 0) {
    if (pr.ci.pending) return { ...stop(`CI is still running on the head ${pr.headSha.slice(0, 7)} of PR #${pr.number}`, `/ao-fix ${pr.number} once CI is done`), lines };
    const runs = reviewRuns(facts, options);
    if (runs.length > 0) return go(runs, lines);
    return { ...stop(`PR #${pr.number} has nothing to fix: no request for changes, no red CI, no blocking finding`, afterReviews(facts).next), lines };
  }
  const role = DEV_ORDER.includes(item.agent) ? item.agent : (item.role ?? [...item.subtasks].sort((a, b) => DEV_ORDER.indexOf(a.role) - DEV_ORDER.indexOf(b.role)).at(-1)?.role);
  if (!role) return { ...stop(`${item.key} has no dev agent: no Agent value of a dev role, and no role label`, `Ask ba to label ${item.key}, then /ao-fix ${pr.number}`), lines };
  let effort = item.effort ?? options.roster.roles[role].effort;
  if (item.rework >= REWORK_FLOOR.count) effort = atLeast(effort, REWORK_FLOOR.effort);
  const dev = { role, key: item.key, effort, purpose: 'fix', prompt: promptFor('fix', { pr: pr.number, key: item.key, branch: pr.headRef, reasons, note }), checkout: { branch: pr.headRef, pull: true }, head: pr.headSha, ...(note && { note: noteKey(note) }) };
  const reviews = [
    { role: 'reviewer', key: item.key, effort: options.roster.roles.reviewer.effort, purpose: 'review', prompt: promptFor('review', { pr: pr.number }), when: 'the fix is pushed and CI is green' },
    { role: 'security', key: item.key, effort: 'high or max', purpose: 'review', prompt: '(decided after the fix: the new part only, or the whole PR)', when: 'the fix is pushed and CI is green' },
  ];
  return go([dev, ...reviews], lines);
}

// Which note a fix run was for, kept in state.json: the first 12 hex digits of its SHA-256.
const title = (env) => `${env[0].toUpperCase()}${env.slice(1)}`;
const eight = (sha) => sha.slice(0, 8);
// The deployer gives every deployment the URL of its environment; one without came from another tool (Checkpoint 2:
// the fake deploy.yml of ao-pilot), and qa would test no URL.
const noUrl = (sha, env) => `the deployment of ${eight(sha)} on ${env} has no URL: only the deployer of the kit deploys there with one (spec 2.3)`;

// /ao-qa <KEY> (release-workflow spec 2.2, 2.5): qa on the QA environment of the item's route, which must run a release
// that holds the merge of its PR. qa tests the URL of that environment and runs the E2E in a worktree at the commit that
// runs, writes its report and moves the item; Accept stays yours. facts.qa: { environment, running, contains }.
function decideQa(facts, options) {
  const { item, pr, qa } = facts;
  if (item.workType === 'epic') return stop(`${item.key} is an Epic: /ao-qa takes a Story, Task or Bug`, `/ao-status ${item.key}`);
  const flagged = flaggedStop(item);
  if (flagged) return flagged;
  // A qa run the usage limit stopped may have picked the item up already: it goes on from In QA too.
  const last = (facts.run?.runs ?? []).filter((r) => r.command === 'qa').at(-1);
  const stopped = last && STOPPED.includes(last.outcome) && last.session ? last : null;
  const states = stopped ? ['ready-for-qa', 'in-qa'] : ['ready-for-qa'];
  if (!states.includes(item.state)) return stop(`${item.key} is ${item.status}, not Ready for QA`, nextFor(item, pr?.number));
  if (!pr?.merged || !pr.mergeCommit) return stop(`PR #${pr?.number ?? '?'} of ${item.key} is not merged`, `/ao-status ${item.key}`);
  const env = title(qa.environment);
  if (!qa.running) return stop(`${env} runs no release yet`, 'Wait for the deployer to run one; its deployments are on GitHub');
  if (!qa.contains) {
    return stop(`${env} runs ${eight(qa.running.sha)}, which does not hold the merge of PR #${pr.number} (${eight(pr.mergeCommit)}) yet`, `Wait a minute for the deployer, then run /ao-qa ${item.key} again; if its deployment failed, read why on GitHub`);
  }
  if (!qa.running.url) return stop(noUrl(qa.running.sha, env), `/ao-status ${item.key}`);
  const auth = qa.environment !== 'production';
  const qaRun = run('qa', 'qa', { key: item.key, type: item.type, environment: env, sha: qa.running.sha, url: qa.running.url, pr: pr.number, auth }, options, {
    worktree: { kind: 'qa', name: `${item.key}-qa`, sha: qa.running.sha, install: true },
    env: { E2E_BASE_URL: qa.running.url },
    qa: { environment: qa.environment, sha: qa.running.sha, auth },
  });
  const lines = [`${env} runs ${eight(qa.running.sha)}, which holds the merge of PR #${pr.number}`];
  // The run goes on in its session, in a new worktree with the same URL and basic auth: carryOn would drop them.
  if (stopped) return go([{ ...qaRun, effort: stopped.effort ?? qaRun.effort, resume: stopped.session, prompt: resumePrompt(item.key) }], lines);
  const resumed = carryOn('qa', facts, options);
  if (resumed) return resumed;
  return go([qaRun], lines);
}

// /ao-release and /ao-release <vX.Y.0> <sha> (release-workflow spec 2.2, 2.6, 6). Without arguments it prints the cut
// point, the items and the release, and stops at gate ④; with the release and the cut point you read, it cuts the
// release branch with a script, as ao-dev, and sets the Fix Versions with the CI token: no agent. The major is yours to
// raise. facts.release: { latestTag, version, commits, cut, included, after, versions, releaseBranches }.
function decideRelease(facts) {
  const r = facts.release;
  const [open] = r.releaseBranches;
  if (open) {
    if (facts.arg && open.name === `release/${facts.arg}`) return stop(`${open.name} is open at ${eight(open.sha)}: the deployer puts it on Staging within a minute or two`, `/ao-ship v${open.version}`);
    return stop(`${r.releaseBranches.map(({ name }) => name).join(' and ')} ${r.releaseBranches.length > 1 ? 'are' : 'is'} open: ship it before you cut the next release`, `/ao-ship v${open.version}`);
  }
  const since = r.latestTag ?? 'its start';
  if (r.commits === 0) return stop(`no commit on develop since ${since}`, '/ao-status');
  if (!r.cut) {
    const holder = r.after.find(({ state }) => state !== 'done');
    const why = holder ? `${holder.key} (${holder.status}) is not Done, and the items after it wait for it` : 'no item of the space is Done';
    return stop(`no cut point on develop since ${since}: ${why}`, '/ao-status');
  }
  const version = facts.arg ?? r.version;
  const nextVersion = nextMinor(version);
  const short = r.cut.sha.slice(0, 7);
  const moved = r.after.filter(({ fixVersions }) => fixVersions.includes(version)).map(({ key }) => key);
  const known = (name) => r.versions.find((v) => v.name === name);
  const lines = [
    `develop: ${r.commits} commits since ${since}; cut point ${short} "${r.cut.subject}"`,
    `In ${version}: ${r.included.map(({ key }) => key).join(', ')} (Done)`,
    ...(r.after.length > 0 ? [`After the cut point, for ${nextVersion} or later: ${r.after.map(({ key, status }) => `${key} (${status})`).join(', ')}`] : []),
    ...(moved.length > 0 ? [`Moves from ${version} to ${nextVersion} on Jira: ${moved.join(', ')}`] : []),
    `Fix Versions on Jira: ${[version, nextVersion].map((name) => `${name} (${!known(name) ? 'missing' : known(name).released ? 'released' : 'unreleased'})`).join(', ')}`,
  ];
  const lacking = [version, nextVersion].filter((name) => !known(name) || known(name).released);
  if (facts.arg && facts.arg !== r.version && !isNewMajor(facts.arg, r.version)) return stop(`${facts.arg} is not the next release: that is ${r.version}, or a new major`, `/ao-release ${r.version} ${short}`, { lines });
  if (facts.arg && !(facts.extra?.length >= 7 && r.cut.sha.startsWith(facts.extra))) return stop(`${facts.extra} is not the cut point ${short}: read the list again`, `/ao-release ${version} ${short}`, { lines });
  if (lacking.length > 0) {
    const released = lacking.some((name) => known(name)) ? ', unreleased' : '';
    return stop(`gate ④ waits for the Fix Version${lacking.length > 1 ? 's' : ''} ${lacking.join(' and ')} on Jira${released}`, `Create ${lacking.join(' and ')} in Jira (Releases, then Create version), then run /ao-release again`, { lines });
  }
  if (!facts.arg) return stop(`gate ④. Read the list, then run /ao-release ${version} ${short}`, `/ao-release ${version} ${short}`, { lines });
  return go([{ action: 'release-cut', key: version, version, nextVersion, sha: r.cut.sha, included: r.included, after: r.after }], lines);
}

// /ao-ship vX.Y.0 (release-workflow spec 2.7): the full regression of the release on Staging, the notes of devops, then
// a script commits the report and the changelog on the release branch as ao-dev and opens the release PR; it ends at
// gate ⑤, your approval of that PR. Each run of the command goes on from the step still missing. A regression holds for
// a newer head only when the branch changed nothing but those two files since; otherwise it runs again.
// facts.ship: { version, branch, staging, bugs, regression, changedSinceRegression, notes, pr }.
function decideShip(facts, options) {
  if (facts.hotfix) return decideHotfix(facts);
  const s = facts.ship;
  const v = s.version;
  if (!s.branch) return stop(`release/${v} is not open`, '/ao-release');
  if (s.bugs.length > 0) {
    return stop(`${s.bugs.length} Bug${s.bugs.length > 1 ? 's' : ''} Critical or High ${s.bugs.length > 1 ? 'are' : 'is'} open with Fix Version ${v}: ${s.bugs.map(({ key, severity }) => `${key} (${severity})`).join(', ')}`, `Fix them on bugfix/<BUG> branches into ${s.branch.name}, through review and gate ③, then run /ao-ship ${v} again`);
  }
  const allowed = [`docs/releases/${v}.md`, 'CHANGELOG.md'];
  const beyond = (s.changedSinceRegression ?? []).filter((file) => !allowed.includes(file));
  const holds = s.regression?.result === 'PASS' && s.changedSinceRegression !== null && beyond.length === 0;
  // The report of this regression is on the branch once the branch changed it since: a regression run again on the
  // head of a branch whose PR is open still needs its report, notes and CHANGELOG committed (T21).
  const reported = (s.changedSinceRegression ?? []).includes(`docs/releases/${v}.md`);
  if (s.pr && holds && reported && s.notes) {
    return stop(`gate ⑤: PR #${s.pr.number} of ${s.branch.name} waits for your approval on its head ${eight(s.pr.headSha)}`, `Approve PR #${s.pr.number} on GitHub, without merging it: merge-gate merges it with a merge commit, tags ${v} and merges main back into develop`);
  }
  if (!s.staging) return stop('Staging runs no release yet: wait for the deployer', `/ao-ship ${v}`);
  if (s.staging.sha !== s.branch.sha) return stop(`Staging runs ${eight(s.staging.sha)}, not the head ${eight(s.branch.sha)} of ${s.branch.name}: wait for the deployer`, `/ao-ship ${v}`);
  if (!s.staging.url) return stop(noUrl(s.staging.sha, 'Staging'), '/ao-status');
  if (s.regression?.result === 'FAIL' && s.regression.sha === s.staging.sha) {
    return stop(`the regression of ${v} failed on ${eight(s.regression.sha)}`, `Read the draft Bugs in .ai/runs/${v}/regression-report.md, triage and create the Bugs; once they are fixed on ${s.branch.name}, run /ao-ship ${v} again`);
  }
  const context = { version: v, sha: s.staging.sha, url: s.staging.url, branch: s.branch.name };
  const notes = run('devops', 'release-notes', { key: v, ...context }, options);
  const pr = { action: 'release-pr', key: v, version: v, branch: s.branch.name, regression: holds ? s.regression.sha : s.staging.sha };
  if (!holds) {
    const regression = run('qa', 'regression', { key: v, ...context }, options, {
      worktree: { kind: 'qa', name: `${v}-regression`, sha: s.staging.sha, install: true },
      env: { E2E_BASE_URL: s.staging.url },
      qa: { environment: 'staging', sha: s.staging.sha, auth: true },
    });
    const why = beyond.length > 0 ? [`${s.branch.name} changed ${beyond.join(', ')} after the regression on ${eight(s.regression.sha)}, so the regression runs again`] : [];
    return go([regression, notes, pr], why);
  }
  if (!s.notes) return go([notes, pr]);
  return go([pr]);
}

// /ao-ship vX.Y.(Z+1), a hotfix (release-workflow spec 2.8): its Bug is Done after QA on Staging, and Staging runs its
// merge on main. A script with your gh login then tags it, asks for it on Production (gate ⑤), and opens the merges of
// main back into develop and the open release branch. No regression: that is the shorter stage hotfix.
// facts.hotfix: { version, production, expected, main, bug, staging, tag, request, releaseBranches }.
function decideHotfix(facts) {
  const h = facts.hotfix;
  const v = h.version;
  if (!h.production) return stop('Production runs no tagged release, so there is nothing to patch', '/ao-status');
  // Production runs the newest commit of main: the hotfix, once it went live; right after a release, its merge, no hotfix.
  if (h.production.sha === h.main.sha && h.main.pull?.head?.startsWith('hotfix/')) return stop(`Production runs ${h.production.version} (${eight(h.main.sha)}), the hotfix: nothing is left to ship`, '/ao-status');
  // Its own tag moved the next patch on, so the request comes first (T22).
  if (h.tag?.sha === h.main.sha && h.request?.sha === h.main.sha) return stop(`${v} is tagged and deployment request #${h.request.id} asks for it on Production: the deployer takes it within a minute or two`, '/ao-status');
  if (v !== h.expected) return stop(`${v} is not the next patch of ${h.production.version} on Production: that is ${h.expected}`, `/ao-ship ${h.expected}`);
  const { pull } = h.main;
  if (!pull?.key || !pull.head.startsWith('hotfix/')) return stop(`main ends with ${eight(h.main.sha)}, ${pull ? `the merge of PR #${pull.number} from ${pull.head}` : 'a commit without a PR'}, not of a hotfix`, '/ao-status');
  if (!h.bug || h.bug.state !== 'done') return stop(`${pull.key} is ${h.bug?.status ?? 'not on Jira'}, not Done: QA it on Staging with /ao-qa ${pull.key}, then Accept it`, `/ao-qa ${pull.key}`);
  if (!h.bug.fixVersions.includes(v)) return stop(`${pull.key} does not carry the Fix Version ${v}`, `Set the Fix Version of ${pull.key} to ${v} in Jira, then run /ao-ship ${v} again`);
  if (h.tag && h.tag.sha !== h.main.sha) return stop(`the tag ${v} is at ${eight(h.tag.sha)}, not at the hotfix ${eight(h.main.sha)}`, '/ao-status');
  if (h.staging?.sha !== h.main.sha) return stop(`Staging runs ${h.staging ? eight(h.staging.sha) : 'nothing'}, not the hotfix ${eight(h.main.sha)}: wait for the deployer`, `/ao-ship ${v}`);
  return go(
    [{ action: 'hotfix-ship', key: v, version: v, sha: h.main.sha, backMerges: ['develop', ...h.releaseBranches.map(({ name }) => name)] }],
    [`Production runs ${h.production.version}; ${v} is the hotfix of ${pull.key}, merged as ${eight(h.main.sha)} by PR #${pull.number}, which Staging runs`],
  );
}

// /ao-rollback <environment> [<sha>] (release-workflow spec 2.9, plan decision 5): a deployment request with your gh
// login, for the release that ran there before, or for the commit you name. The deployer checks it again: a rollback
// only to a release that ran there, and on Production the two conditions of spec 2.4.
// facts.rollback: { environment, running, earlier, target, requested }.
function decideRollback(facts) {
  const r = facts.rollback;
  const env = title(r.environment);
  const given = facts.extra !== undefined;
  const target = given ? r.target : r.earlier[0];
  if (!target) return stop(given ? `${facts.extra} is not a commit of the repository` : `${env} has no earlier release that ran there`, '/ao-status');
  if (r.running?.sha === target.sha) return stop(`${env} runs ${eight(target.sha)} already`, '/ao-status');
  if (r.requested?.sha === target.sha) return stop(`deployment request #${r.requested.id} asks for ${eight(target.sha)} on ${env}: the deployer takes it within a minute or two`, '/ao-status');
  const what = given ? 'the commit you named. The deployer takes the history up to it as read by you' : `the release that ran there before`;
  return go(
    [{ action: 'deploy-request', key: facts.runKey, environment: r.environment, sha: target.sha, rollback: !given }],
    [`${env} runs ${r.running ? eight(r.running.sha) : 'nothing'}; the request asks for ${eight(target.sha)}, ${what}`],
  );
}

// v(M+1).0.0 when the next release would be vM.N.0.
const isNewMajor = (tag, next) => {
  const [given, expected] = [parseVersion(tag), parseVersion(next)];
  return Boolean(given && expected) && given.major === expected.major + 1 && given.minor === 0 && given.patch === 0;
};

export function noteKey(note) {
  return createHash('sha256').update(note.trim()).digest('hex').slice(0, 12);
}

const DECIDERS = { status: decideStatus, spec: decideSpec, plan: decidePlan, build: decideBuild, review: decideReview, fix: decideFix, qa: decideQa, release: decideRelease, ship: decideShip, rollback: decideRollback };
export { DECIDERS };
