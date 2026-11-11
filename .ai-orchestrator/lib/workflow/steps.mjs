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
import { checkBranch, parseBranch } from '../tracker/conventions.mjs';
import { splitNote } from './notes.mjs';
import { PREVIEW_FILE, PREVIEW_SAMPLE } from './preview.mjs';
import { answersPrompt, promptFor, resumePrompt } from './prompts.mjs';
import { openQuestions } from './runs.mjs';
import { fullReviewEffort, securityScope } from './security-scope.mjs';

const ASKING = ['ba', 'ux', 'sa'];
// The roles /ao-request runs on a "Cần <role>:" comment (human-loop spec 3.3): those of stage spec and plan. The dev
// roles and qa have their own commands.
const ADVISERS = ASKING;
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
    const goOn = { role: last.role, key, effort: last.effort, purpose: last.purpose, resume: last.session, prompt: resumePrompt(key), ...(last.head && { head: last.head }), ...(last.note && { note: last.note }), ...(last.rebuild && { rebuild: last.rebuild }) };
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

// The run of the oldest open request to ba, ux or sa on the item, or null (human-loop spec 3.3). On an Epic in stage spec
// or plan the role works on the docs branch, and pushes once the docs PR is open; anywhere else it works on Jira only,
// from develop. `request` is the time of the comment: two requests to one role are two runs, not the same one again.
function requestRun(facts, options) {
  const { item, docs } = facts;
  const [asked] = (item.requests ?? []).filter(({ to }) => ADVISERS.includes(to));
  if (!asked) return null;
  const shaping = item.workType === 'epic' && ['specifying', 'planning'].includes(item.state) && docs;
  const pr = shaping && docs.pr?.state === 'open' ? docs.pr.number : undefined;
  const context = { key: item.key, role: asked.to, from: asked.from, at: asked.at, ...(shaping && { branch: docs.branch }), ...(pr && { pr }) };
  const checkout = shaping ? { branch: docs.branch, from: 'develop' } : { branch: 'develop', pull: true };
  return run(asked.to, 'request', context, options, { checkout, request: asked.at });
}

// /ao-request <KEY>: the open requests to ba, ux or sa on the item, one run each, oldest first (human-loop spec 3.3).
function decideRequest(facts, options) {
  const { item } = facts;
  const lines = [item.workType === 'epic' ? epicLine(facts) : itemLine(facts)];
  const blocked = flaggedStop(item);
  if (blocked) return { ...blocked, lines };
  const carried = carryOn('request', facts, { ...options, answers: undefined });
  if (carried) return { ...carried, lines };
  const next = requestRun(facts, options);
  if (next) return go([next], lines);
  const others = (item.requests ?? []).filter(({ to }) => !ADVISERS.includes(to));
  const rest = others.length === 0 ? '' : `; ${others.length} open request${others.length > 1 ? 's go to other roles' : ' goes to another role'} (${[...new Set(others.map(({ to }) => to))].join(', ')})`;
  return { ...stop(`${item.key} has no open request to ba, ux or sa${rest}`, `/ao-status ${item.key}`), lines };
}

// A change asked for after its gate goes into a new Epic (human-loop spec 3.2; Lượt 111).
const pastGate = (key, gate, what) => stop(`${key} is past gate ${gate}: its ${what} no longer changes before the gate`, '/ao-intake with the change, for a new Epic');

// Whether `note` was made already, for /ao-spec and /ao-plan: the newest run of `command` for `purpose` that had a note
// had this one, and ended done. `moved(run)` adds a condition. /ao-fix counts by dev agent instead (human-loop spec 4.4).
function noteDone(facts, command, purpose, note, moved = () => true) {
  const lastNoted = (facts.run?.runs ?? []).filter((r) => r.command === command && r.purpose === purpose && r.note).at(-1);
  return Boolean(note) && lastNoted?.outcome === 'done' && lastNoted.note === noteKey(note) && moved(lastNoted);
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
  const note = options.note?.trim() || undefined;
  if (note && !['new', 'specifying'].includes(epic.state)) return { ...pastGate(key, '① spec-approval', 'SPEC'), lines };
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
  // A change you ask for before gate ① (human-loop spec 3.2), unless the same one was made already.
  const revise = note && !noteDone(facts, 'spec', 'spec-revise', note) ? note : undefined;
  if (revise && !docs.spec) return { ...stop(`${key} has no SPEC yet: a change waits for stage spec to write one`, `/ao-spec ${key}`), lines };
  const context = { key, branch: docs.branch };
  const checkout = { branch: docs.branch, from: 'develop' };
  const at = (role, purpose, extra) => run(role, purpose, context, options, { checkout, ...extra });
  const pr = docs.pr?.state === 'open' ? docs.pr.number : undefined;
  // Your change first, then a request between ba, ux and sa on the Epic, before the rest of the stage and gate ① (3.3).
  const asked = requestRun(facts, options);
  const runs = [...(revise ? [run('ba', 'spec-revise', { ...context, pr, note: revise }, options, { checkout, note: noteKey(revise) })] : []), ...(asked ? [asked] : [])];
  if (pr) {
    if (runs.length > 0) return go(runs, lines);
    return { ...stop(`the docs PR #${pr} of ${key} is open: stage spec is done and waits for you at gate ① spec-approval`, `Read the diff of PR #${pr}, click Approve spec on ${key}, then /ao-plan ${key}`), lines };
  }
  if (!docs.spec) return go([...runs, at('ba', 'spec-write'), at('ux', 'design', { when: 'the SPEC has screens' }), at('sa', 'spec-nfr'), at('ba', 'docs-pr')], lines);
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
  const note = options.note?.trim() || undefined;
  if (note && ['in-progress', 'done', 'cancelled'].includes(epic.state)) return { ...pastGate(key, '② plan-approval', 'plan'), lines };
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
  // A request between ba, ux and sa on the Epic runs before the rest of the stage, and before gate ② (human-loop 3.3).
  const asked = requestRun(facts, options);
  const first = asked ? [asked] : [];
  // A change you ask for before gate ② (human-loop spec 3.2), unless the same one was made already.
  const revise = note && !noteDone(facts, 'plan', 'plan-revise', note) ? note : undefined;
  if (revise && !docs.plan) return { ...stop(`${key} has no plan yet: a change waits for stage plan to write one`, `/ao-plan ${key}`), lines };
  if (!docs.plan) return go([...first, at('sa', 'plan-write'), at('ba', 'plan-items')], lines);
  const questions = openQuestions(docs.plan);
  if (questions.length > 0) return { ...questionsStop(key, 'plan.md', questions, 'sa'), lines };
  const lead = [...(revise ? [run('sa', 'plan-revise', { ...context, note: revise }, options, { checkout, note: noteKey(revise) })] : []), ...first];
  if (epic.children.length === 0) return go([...lead, at('ba', 'plan-items')], lines);
  if (lead.length > 0) return go(lead, lines);
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

// The command that runs an open request, after its text: /ao-request for ba, ux and sa (human-loop spec 3.3).
const runsRequest = ({ to }, key) => (ADVISERS.includes(to) ? ` → /ao-request ${key}` : '');

// /ao-status: the item and what comes next, or every item of the space.
function decideStatus(facts) {
  if (!facts.item) return spaceStatus(facts);
  const lines = [facts.item.workType === 'epic' ? epicLine(facts) : itemLine(facts)];
  const cost = (facts.run?.runs ?? []).reduce((total, r) => total + (r.costUsd ?? 0), 0);
  if (facts.run?.runs?.length) lines.push(`Runs: ${facts.run.runs.length}, ${usd(cost)} in all; the last: ${describeRun(facts.run.runs.at(-1))}`);
  for (const request of facts.item.requests) lines.push(`Open request to ${request.to}${request.from ? ` from ${request.from}` : ''}: ${request.text}${runsRequest(request, facts.item.key)}`);
  return { status: true, lines, next: nextFor(facts.item, facts.pr?.state === 'open' ? facts.pr.number : null, facts.pr?.draft) };
}

function spaceStatus(facts) {
  // A draft PR counts too: it waits for your preview (human-loop spec 4.7).
  const prOf = new Map(facts.pulls.map(({ key, number, draft }) => [key, { number, draft }]));
  const costOf = new Map(facts.runs.map(({ key, runs = [] }) => [key, runs.reduce((total, r) => total + (r.costUsd ?? 0), 0)]));
  const lines = [];
  const yours = [];
  for (const item of facts.items.filter(({ workType }) => workType !== 'sub-task')) {
    const pull = prOf.get(item.key);
    const next = nextFor(item, pull?.number ?? null, pull?.draft);
    const cost = costOf.get(item.key);
    lines.push(`${item.key} ${item.type} "${item.summary}": ${item.status}${pull?.draft ? `, draft PR #${pull.number}` : ''}${item.flagged ? ', flagged' : ''}${cost ? `, ${usd(cost)}` : ''} → ${next}`);
    if (item.flagged || /^Click|^Accept|^\/ao-preview /.test(next)) yours.push(`${item.key}: ${next}`);
    for (const request of item.requests) lines.push(`  open request to ${request.to}${request.from ? ` from ${request.from}` : ''}: ${request.text}${runsRequest(request, item.key)}`);
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
export function nextFor(item, prNumber, draft = false) {
  if (item.flagged) return `read the flag comment on ${item.key} (Needs you)`;
  if (item.workType === 'epic' && item.state === 'in-progress' && item.children?.length > 0 && item.children.every(closed)) return `Click Complete on ${item.key}`;
  const epic = { new: `Click Start spec on ${item.key}`, specifying: `/ao-spec ${item.key}`, planning: `/ao-plan ${item.key}`, 'in-progress': 'its items move on', done: 'done', cancelled: 'cancelled' };
  if (item.workType === 'epic') return epic[item.state] ?? `/ao-status ${item.key}`;
  const work = {
    new: 'waits to be refined (jira-sync after Approve plan, or you)',
    ready: `/ao-build ${item.key}`,
    // A draft PR waits for your preview, which you may skip (human-loop spec 4.2).
    'in-progress': prNumber ? (draft ? `/ao-preview ${item.key} or /ao-review ${prNumber}` : `/ao-review ${prNumber}`) : `/ao-build ${item.key}`,
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
  // The draft PR of a build waits for your preview (human-loop spec 4.2); red CI goes to /ao-fix first.
  if (pr?.state === 'open' && pr.draft) {
    if (pr.ci.failed) return out(stop(`CI is red on the draft PR #${pr.number} of ${key}`, `/ao-fix ${pr.number}`));
    return out(stop(`the draft PR #${pr.number} of ${key} waits for your preview${pr.ci.pending ? ' (CI still running)' : ''}: the screenshots and API samples of its dev agents are in .ai/runs/${key}/preview/`, `/ao-preview ${key}, or /ao-review ${pr.number} to skip the preview`));
  }
  if (pr?.state === 'open') return out(stop(`PR #${pr.number} of ${key} is open: the build is done`, pr.ci.failed || pr.changesRequested ? `/ao-fix ${pr.number}` : `/ao-review ${pr.number}`));
  // A Story split into Sub-tasks goes on through them: their agents keep the ledgers, one per Sub-task. Any other item
  // In Progress goes on from its own ledger.
  const subtaskLedgers = facts.subtaskLedgers ?? [];
  const split = item.subtasks.length > 0;
  const again = item.state === 'in-progress' && (split ? subtaskLedgers.length > 0 : facts.ledger);
  // After QA fail: the PR of the item is merged and its newest QA report is FAIL (human-loop spec 5.2).
  const afterQaFail = item.state === 'in-progress' && Boolean(pr?.merged) && facts.qaReport?.result === 'FAIL';
  if (item.state !== 'ready' && !again && !afterQaFail) {
    const why = item.state === 'in-progress' ? `${key} is In Progress but has no ledger in .ai/ledger/: its run did not come from an agent of the kit` : `${key} is ${item.status}, not Ready`;
    return out(stop(why, nextFor(item, pr?.state === 'open' ? pr.number : null)));
  }
  if (!facts.dependenciesMerged) return out(stop(`an item ${key} depends on (${item.blockedBy.join(', ')}) is not merged yet`, `/ao-status ${item.blockedBy[0]}`));
  if (item.parent && docs && !docs.pr?.merged) {
    return out(stop(`the docs PR of Epic ${item.parent.key} is not merged yet`, `/ao-plan ${item.parent.key} after you approve its plan`));
  }
  const carried = carryOn('build', facts, options);
  if (carried) return out(carried);
  if (afterQaFail) return out(rebuild(facts, options));

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

// The next branch of an item after QA fail: the same kind, key and slug, with -r2, -r3… (tracker-integration spec 2.5).
const nextRound = (headRef) => {
  const branch = parseBranch(headRef);
  return branch && branch.kind !== 'release' ? `${branch.kind}/${branch.key}-${branch.slug}-r${branch.round + 1}` : null;
};

// /ao-build after QA fail (human-loop spec 5.2): a new branch from develop, then ba when the criteria changed on Jira
// after the merge (spec-sync), then one dev agent per side with defects, BE first, at the level of the item: the
// Sub-tasks of a Story are done, and a Sub-task cannot be opened again. The runs of one rebuild carry the time of the
// QA report they answer, so a later QA fail is a rebuild of its own. For a Story with a BE and an FE Sub-task you split
// the defects with be: and fe:, as for /ao-fix.
function rebuild(facts, options) {
  const { item, pr, qaReport } = facts;
  const key = item.key;
  const branch = nextRound(pr.headRef);
  if (!branch) return stop(`PR #${pr.number} of ${key} is on ${pr.headRef}, not the branch of a work item`, `/ao-status ${key}`);
  const runs = facts.run?.runs ?? [];
  const mine = runs.filter((r) => r.command === 'build' && r.rebuild === qaReport.at);
  const done = (role, purpose) => mine.some((r) => r.role === role && r.purpose === purpose && r.outcome === 'done');
  const sides = item.subtasks.length > 0 ? [...new Set(item.subtasks.map(({ role }) => role))] : [item.role].filter(Boolean);
  if (sides.length === 0) return stop(`${key} has no role label: /ao-build does not guess who fixes it`, `Ask ba to label it ${options.mapping?.work_labels?.role_prefix ?? 'ao-'}<role>, then /ao-build ${key}`);
  const note = options.note?.trim() || undefined;
  let parts = { [sides[0]]: note };
  if (sides.length > 1) {
    const split = note ? splitNote(note) : null;
    if (!split?.prefixed) return stop(`${key} failed QA and has a BE and an FE Sub-task: say which defects of its QA report go to whom`, `/ao-build ${key} with the defects split by be: and fe:`);
    parts = split.parts;
  }
  const epic = item.parent && /epic/i.test(item.parent.type) ? item.parent.key : null;
  const merged = Date.parse(pr.mergedAt ?? 0);
  const acChanged = runs.some((r) => r.command === 'qa' && r.purpose === 'ac-add' && r.outcome === 'done' && Date.parse(r.endedAt ?? r.startedAt ?? 0) > merged);
  const checkout = { branch, from: 'develop' };
  const list = [];
  if (acChanged && epic && !done('ba', 'spec-sync')) list.push(run('ba', 'spec-sync', { key, epic, branch }, options, { checkout, rebuild: qaReport.at }));
  const roles = DEV_ORDER.filter((role) => Object.hasOwn(parts, role) && !done(role, 'build'));
  roles.forEach((role, i) => {
    let effort = item.effort ?? options.roster.roles[role].effort;
    if (item.rework >= REWORK_FLOOR.count) effort = atLeast(effort, REWORK_FLOOR.effort);
    const others = roles.filter((other) => other !== role).map((other) => ({ role: other, text: parts[other] }));
    const prompt = promptFor('rebuild', { key, at: qaReport.at, branch, pr: pr.number, part: parts[role], others, next: roles[i + 1] });
    list.push({ role, key, effort, purpose: 'build', prompt, checkout, rebuild: qaReport.at });
  });
  if (list.length === 0) return stop(`the fix of ${key} after QA fail is built on ${branch}, but no PR of it is open`, `/ao-status ${key}`);
  return go(list, [`QA fail on ${qaReport.at.slice(0, 16).replace('T', ' ')} UTC: the fix goes on ${branch}, new from develop`]);
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
  // A draft PR is marked ready first, a script as ao-dev with no agent, and the reviews go on in the same command: you
  // previewed it, or skip the preview by typing /ao-review (human-loop spec 4.6). jira-sync then moves the item.
  if (pr.draft) return go([{ action: 'pr-ready', key: facts.item.key, number: pr.number, continue: true }, ...reviewRuns(facts, options)], lines);
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
  const asked = options.note?.trim() || undefined;
  const reasons = [];
  if (pr.changesRequested) reasons.push(`the changes requested on ${pr.headSha.slice(0, 7)}`);
  if (pr.ci.failed) reasons.push(`the red CI on ${pr.headSha.slice(0, 7)}`);
  for (const [role, report] of Object.entries(pr.reports)) if (report?.onHead && report.blocking > 0) reasons.push(`the ${report.blocking} Critical or High findings of the ${role} report`);
  // Who fixes what is not yours to say: the dev agent of the item, or the last one of a split Story.
  const own = DEV_ORDER.includes(item.agent) ? item.agent : (item.role ?? [...item.subtasks].sort((a, b) => DEV_ORDER.indexOf(a.role) - DEV_ORDER.indexOf(b.role)).at(-1)?.role);
  // Your request, split by be: and fe: (human-loop spec 4.4). Without a prefix it goes to the item's dev agent, unless
  // the Story has a BE and an FE Sub-task: then it stops, since /ao-fix does not guess.
  let parts = {};
  if (asked) {
    const split = splitNote(asked);
    const sides = new Set(item.subtasks.length > 0 ? item.subtasks.map(({ role }) => role) : [item.role]);
    if (!split.prefixed && sides.has('be-dev') && sides.has('fe-dev')) {
      return { ...stop(`your request has no be: or fe:, and ${item.key} has a BE and an FE Sub-task: /ao-fix does not guess who does it`, `Start each part of your request with be: or fe:, then /ao-fix ${pr.number} again`), lines };
    }
    parts = split.prefixed ? split.parts : own ? { [own]: split.text } : {};
  }
  // A part pushed already is not sent again: the done runs of this request since the last one of another request, a fix
  // only when the head moved on since (Pilot 1, PR #4 of ao-sample; review test of 2026-11-07; human-loop spec 4.4).
  const done = new Set();
  if (asked) {
    for (const r of [...(facts.run?.runs ?? [])].reverse().filter((r) => r.command === 'fix' && r.note && (r.purpose === 'fix' || CHANGE_RUNS[r.purpose]))) {
      if (r.note !== noteKey(asked)) break;
      if (r.outcome === 'done' && (r.purpose !== 'fix' || r.head !== pr.headSha)) done.add(`${r.role} ${r.purpose}`);
    }
  }
  const todo = Object.fromEntries(Object.entries(parts).filter(([role]) => !done.has(`${role} fix`)));
  // What the request changes, as you answered (human-loop spec 4.5): ba or sa change the documents first, on the PR.
  const change = asked ? (options.change ?? 'none') : 'none';
  const epic = item.parent && /epic/i.test(item.parent.type) ? item.parent.key : null;
  if (change === 'story' && item.workType !== 'task') return { ...stop(`${item.key} is a ${item.type}: only a Task becomes a Story`, `/ao-fix ${pr.number} with what your request really changes`), lines };
  if (change === 'story' && !epic) return { ...stop(`Task ${item.key} has no Epic, and a Story needs one with an approved plan`, '/ao-intake with your request, for a small Epic'), lines };
  if (['api', 'epic'].includes(change) && !epic) return { ...stop(`${item.key} has no Epic, so no plan or SPEC to change`, `/ao-fix ${pr.number} with --change none, or /ao-intake with your request`), lines };
  const [changer, purpose] = Object.entries(CHANGE_RUNS).map(([p, { role, change: c }]) => (c === change ? [role, p] : null)).find(Boolean) ?? [];
  const first = changer && !done.has(`${changer} ${purpose}`)
    ? [{ role: changer, key: item.key, effort: options.roster.roles[changer].effort, purpose, prompt: promptFor(purpose, { pr: pr.number, key: item.key, branch: pr.headRef, epic, note: asked }), checkout: { branch: pr.headRef, pull: true }, head: pr.headSha, note: noteKey(asked) }]
    : [];
  const roles = DEV_ORDER.filter((role) => todo[role] !== undefined || (reasons.length > 0 && role === own));
  if (roles.length === 0) {
    if (reasons.length > 0 && !own) return { ...stop(`${item.key} has no dev agent: no Agent value of a dev role, and no role label`, `Ask ba to label ${item.key}, then /ao-fix ${pr.number}`), lines };
    if (pr.ci.pending) return { ...stop(`CI is still running on the head ${pr.headSha.slice(0, 7)} of PR #${pr.number}`, `/ao-fix ${pr.number} once CI is done`), lines };
    // A draft PR has no review yet: you look at it again, or review it (human-loop spec 4.4).
    if (pr.draft) return { ...stop(`the draft PR #${pr.number} of ${item.key} has nothing left to fix${asked ? ': your request is pushed' : ''}`, `/ao-preview ${item.key} to look at it again, or /ao-review ${pr.number}`), lines };
    const runs = reviewRuns(facts, options);
    if (runs.length > 0) return go(runs, lines);
    return { ...stop(`PR #${pr.number} has nothing to fix: no request for changes, no red CI, no blocking finding`, afterReviews(facts).next), lines };
  }
  const devs = roles.map((role) => {
    let effort = item.effort ?? options.roster.roles[role].effort;
    if (item.rework >= REWORK_FLOOR.count) effort = atLeast(effort, REWORK_FLOOR.effort);
    const note = todo[role];
    const mine = [...(role === own ? reasons : []), ...(note !== undefined ? ['what the human asks below'] : [])];
    const others = Object.entries(todo).filter(([who]) => who !== role).map(([who, text]) => ({ role: who, text }));
    const criteria = note !== undefined && ['ac', 'story'].includes(change);
    const prompt = promptFor('fix', { pr: pr.number, key: item.key, branch: pr.headRef, reasons: mine, note, others, draft: pr.draft, criteria });
    return { role, key: item.key, effort, purpose: 'fix', prompt, checkout: { branch: pr.headRef, pull: true }, head: pr.headSha, ...(note !== undefined && { note: noteKey(asked) }) };
  });
  if (pr.draft) return go([...first, ...devs], lines);
  const reviews = [
    { role: 'reviewer', key: item.key, effort: options.roster.roles.reviewer.effort, purpose: 'review', prompt: promptFor('review', { pr: pr.number }), when: 'the fix is pushed and CI is green' },
    { role: 'security', key: item.key, effort: 'high or max', purpose: 'review', prompt: '(decided after the fix: the new part only, or the whole PR)', when: 'the fix is pushed and CI is green' },
  ];
  return go([...first, ...devs, ...reviews], lines);
}

// The run before the dev agents for each answer to "what does your request change?" (human-loop spec 4.5): its purpose,
// its role and the --change word. `none` has no such run.
const CHANGE_RUNS = {
  'ac-revise': { role: 'ba', change: 'ac' },
  'api-revise': { role: 'sa', change: 'api' },
  'epic-revise': { role: 'sa', change: 'epic' },
  'to-story': { role: 'ba', change: 'story' },
};
export const CHANGES = ['none', ...Object.values(CHANGE_RUNS).map(({ change }) => change)];

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
  const last = (facts.run?.runs ?? []).filter((r) => r.command === 'qa' && r.role === 'qa').at(-1);
  const stopped = last && STOPPED.includes(last.outcome) && last.session ? last : null;
  // A defect you found (human-loop spec 5.1): before qa runs, and until you Accept after its PASS.
  const asked = options.note?.trim() || undefined;
  const defect = asked && !noteDone(facts, 'qa', 'qa-defect', asked) ? asked : undefined;
  const states = stopped || defect ? ['ready-for-qa', 'in-qa'] : ['ready-for-qa'];
  if (!states.includes(item.state)) return stop(`${item.key} is ${item.status}, not Ready for QA`, nextFor(item, pr?.number));
  if (!pr?.merged || !pr.mergeCommit) return stop(`PR #${pr?.number ?? '?'} of ${item.key} is not merged`, `/ao-status ${item.key}`);
  const env = title(qa.environment);
  if (!qa.running) return stop(`${env} runs no release yet`, 'Wait for the deployer to run one; its deployments are on GitHub');
  if (!qa.contains) {
    return stop(`${env} runs ${eight(qa.running.sha)}, which does not hold the merge of PR #${pr.number} (${eight(pr.mergeCommit)}) yet`, `Wait a minute for the deployer, then run /ao-qa ${item.key} again; if its deployment failed, read why on GitHub`);
  }
  if (!qa.running.url) return stop(noUrl(qa.running.sha, env), `/ao-status ${item.key}`);
  const auth = qa.environment !== 'production';
  const context = { key: item.key, type: item.type, environment: env, sha: qa.running.sha, url: qa.running.url, pr: pr.number, auth, ...(defect && { note: defect, picked: item.state === 'in-qa' }) };
  const qaRun = run('qa', defect ? 'qa-defect' : 'qa', context, options, {
    worktree: { kind: 'qa', name: `${item.key}-qa`, sha: qa.running.sha, install: true },
    env: { E2E_BASE_URL: qa.running.url },
    qa: { environment: qa.environment, sha: qa.running.sha, auth },
    ...(defect && { note: noteKey(defect) }),
  });
  const lines = [`${env} runs ${eight(qa.running.sha)}, which holds the merge of PR #${pr.number}`];
  // The run goes on in its session, in a new worktree with the same URL and basic auth: carryOn would drop them.
  if (stopped) return go([{ ...qaRun, effort: stopped.effort ?? qaRun.effort, resume: stopped.session, prompt: resumePrompt(item.key) }], lines);
  const resumed = carryOn('qa', facts, options);
  if (resumed) return resumed;
  // A new expectation: ba adds the criterion on Jira first, and qa then fails it (human-loop spec 5.1). The SPEC follows
  // on the next branch of the item (spec-sync, 5.2).
  if (defect && options.change === 'ac' && !noteDone(facts, 'qa', 'ac-add', defect)) {
    const epic = item.parent && /epic/i.test(item.parent.type) ? item.parent.key : null;
    return go([run('ba', 'ac-add', { key: item.key, epic, note: defect }, options, { checkout: { branch: 'develop', pull: true }, note: noteKey(defect) }), qaRun], lines);
  }
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
  const cancelled = r.cancelled ?? [];
  const lines = [
    `develop: ${r.commits} commits since ${since}; cut point ${short} "${r.cut.subject}"`,
    `In ${version}: ${r.included.map(({ key }) => key).join(', ')} (Done)`,
    // A Cancelled item does not hold the cut point (lib/release/cut.mjs): you approve its code here, at gate ④.
    ...(cancelled.length > 0 ? [`Cancelled, with code in ${version} and no Fix Version: ${cancelled.map(({ key }) => key).join(', ')}. Revert it on develop first if it should not ship`] : []),
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
  return go([{ action: 'release-cut', key: version, version, nextVersion, sha: r.cut.sha, included: r.included, after: r.after, ...(cancelled.length > 0 && { cancelled }) }], lines);
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

// /ao-preview <KEY> [--stop] (human-loop spec 4.3): no agent. ao-step switches the project folder to the PR branch and
// starts the apps of preview.yaml, or stops them and goes back to develop. facts.preview: { stop, config, configError,
// active, agentRunning, dirty, busy, install }, read by ao-step from this machine.
function decidePreview(facts) {
  const { item, pr, preview: p } = facts;
  const urls = (apps) => apps.map(({ name, url }) => `${name} ${url}`).join(', ');
  if (p.stop) {
    if (!p.active) return stop('no preview runs', '/ao-status');
    return go([{ action: 'preview-stop', key: p.active.key }], [`The preview of ${p.active.key} runs on ${p.active.branch}: ${urls(p.active.apps)}`]);
  }
  const lines = [itemLine(facts)];
  const key = item.key;
  const out = (decision) => ({ ...decision, lines: [...lines, ...(decision.lines ?? [])] });
  if (item.workType === 'epic' || item.workType === 'sub-task') return out(stop(`${key} is ${item.workType === 'epic' ? 'an Epic' : 'a Sub-task'}: /ao-preview takes the item of a PR`, '/ao-status'));
  if (p.active) {
    const runs = p.active.key === key ? `the preview of ${key} runs already: ${urls(p.active.apps)}` : `the preview of ${p.active.key} runs`;
    return out(stop(runs, `/ao-preview ${p.active.key} --stop, when you are done with it`));
  }
  if (pr?.state !== 'open') return out(stop(`${key} has no open PR to preview`, nextFor(item, null)));
  if (pr.protectedPaths.length > 0) {
    return out(stop(`PR #${pr.number} changes ${pr.protectedPaths.join(', ')}, which steer the kit and the agents: during a preview every /ao-* command would run them. Read those changes in the diff instead`, `/ao-review ${pr.number}`));
  }
  if (p.agentRunning) return out(stop(`ao-step is running ${p.agentRunning.command} ${p.agentRunning.arg}: the project folder is busy`, `Wait for it to end, then /ao-preview ${key}`));
  if (p.dirty > 0) return out(stop(`the project folder has changes not committed (${p.dirty} files)`, `Commit them, or put them aside with git stash, then /ao-preview ${key}`));
  if (p.configError) return out(stop(p.configError, `Fix ${PREVIEW_FILE}, then /ao-preview ${key}`));
  if (!p.config) return out(stop(`the project has no ${PREVIEW_FILE}, which says the apps to start`, `Add it, as below, then /ao-preview ${key}`, { lines: PREVIEW_SAMPLE.split('\n') }));
  if (p.busy.length > 0) return out(stop(`port ${p.busy.join(', ')} is in use: a server runs there already`, `Stop it, then /ao-preview ${key}`));
  const install = p.install ? 'npm ci first, since package-lock.json differs from the one installed' : 'the packages installed are those of the head';
  return out(go([{ action: 'preview-start', key, number: pr.number, branch: pr.headRef, head: pr.headSha, install: p.install }], [`Preview of PR #${pr.number}${pr.draft ? ' (draft)' : ''}: ${pr.headRef} at ${eight(pr.headSha)}; ${install}; apps ${urls(p.config)}`]));
}

// /ao-intake (human-loop spec 3.1): no run. The main session interviews you and creates the item itself; the check gives
// it the Epics not done, to see work that is there already, the WIP of epic-shaping, the contract's rule to pick a type,
// and the Jira ids of the Bug fields it fills. facts.intake: { epics, epicShaping, bugFields }.
function decideIntake(facts, { contract }) {
  const { epics, epicShaping: { used, limit }, bugFields = {} } = facts.intake;
  const values = (id) => contract.work_item_fields.find((field) => field.id === id);
  const fieldLine = (id) => `${values(id).name} = ${bugFields[id] ?? 'not found on Jira'} (${values(id).values.map(({ name }) => name).join(', ')})`;
  const lines = [
    `Space ${facts.space}. Epics not done: ${epics.length || 'none'}`,
    ...epics.map(({ key, summary, status }) => `  ${key} "${summary}": ${status}`),
    `WIP epic-shaping: ${used} of ${limit} Epics in Specifying or Planning${used >= limit ? '; Start spec on a new Epic waits until one leaves them' : ''}`,
    `How to pick a type: ${contract.work_type_selection}`,
    ...contract.work_item_conventions.map((rule) => `- ${rule}`),
    'Intake makes an Epic, a Task or a Bug, never a Story: a Story needs acceptance criteria in a SPEC, screens and an API contract, which stage spec and plan write. Work the size of one Story is a small Epic',
    `Bug fields: ${fieldLine('found-in')}; ${fieldLine('severity')}`,
  ];
  return { status: true, lines, next: 'Interview the human, write the draft in .ai/intake/, and create the item once they say OK' };
}

// v(M+1).0.0 when the next release would be vM.N.0.
const isNewMajor = (tag, next) => {
  const [given, expected] = [parseVersion(tag), parseVersion(next)];
  return Boolean(given && expected) && given.major === expected.major + 1 && given.minor === 0 && given.patch === 0;
};

export function noteKey(note) {
  return createHash('sha256').update(note.trim()).digest('hex').slice(0, 12);
}

const DECIDERS = { status: decideStatus, intake: decideIntake, preview: decidePreview, spec: decideSpec, plan: decidePlan, request: decideRequest, build: decideBuild, review: decideReview, fix: decideFix, qa: decideQa, release: decideRelease, ship: decideShip, rollback: decideRollback };
export { DECIDERS };
