// The loop of `ao-step.mjs <command> <arg> --go` (dev-workflow spec 2.1, plan decision 3 and 7): decide, make the first
// run, write state.json, gather the facts again, decide again, until the decision is STOP. Every effect is a parameter,
// so tests run it without claude, git or the network:
//   gather()                      the facts of the command (lib/workflow/facts.mjs)
//   agent(run, { log })           starts ao-agent.mjs for one run and resolves { lines, stopped } when it ends; log is the
//                                 name of its stream-json log in .ai/runs/<KEY>/; stopped: it stayed alive after its
//                                 result and was stopped (lib/workflow/agent-process.mjs)
//   git(checkout)                 puts the checkout on a branch; resolves { ok, reason }
//   dispatch(action)              asks GitHub to run jira-sync for an item (the second /ao-plan)
//   pack(run, facts)              writes the context pack of a full review run; resolves its path, or null (optional)
//   worktree                      { add(spec), remove(spec) } for a run that has a worktree (a review: the code of its PR at
//                                 its head; qa: the release that runs, with its packages); add resolves { ok, path,
//                                 reason }, remove { ok, reason } (optional)
//   after(run, { tree, facts })   what ao-step does once a run ends and before its worktree goes (qa: the evidence to
//                                 Jira); resolves notes for state.json and last.md (optional)
//   act(step)                     a script step of a release command, such as cutting the release branch; resolves notes
//                                 for last.md. It is the one step of its command (optional)
//   store                         { readState(key), writeState(key, state), writeLast(key, text) }; a run is written when it
//                                 starts and again when it ends
//   sleep(ms), now(), log(line)
// Agents run one after another, never two at once.
import { packNote, qaWorktreeNote, worktreeNote } from './prompts.mjs';
import { readRun } from './runs.mjs';
import { decideStep } from './steps.mjs';

// ciStartMs: how long a PR head may wait for its first check run before the runner stops (SMP-2: GitHub started none).
export const LIMITS = { maxRuns: 8, ciWaitMs: 30 * 60 * 1000, ciStartMs: 5 * 60 * 1000, syncWaitMs: 15 * 60 * 1000, pollMs: 30 * 1000 };
// The most of an agent's answer state.json keeps; the whole answer stays in the run's log and in last.md.
const TEXT_MAX = 2000;
// Only a full review gets a pack: the pack holds the diff of the whole PR, and a review of the new part (review-delta)
// reads the diff since its last report (Pilot 1, review of ao-sample PR #6).
const PACKED = ['review'];

// The command that starts one run: ao-agent.mjs with the role, the prompt, stream-json output, and the effort both as a
// flag and as CLAUDE_CODE_EFFORT_LEVEL, which beats the flag and may be set in your environment (plan decision 6). It
// carries no token: ao-agent.mjs buys the session's own. A run's own variables, such as the URL qa tests, come last.
// CLAUDE_CODE_PROMPT_CACHE_TTL=5m: a run sends its requests seconds apart, so the five-minute cache is enough, and its
// writes cost less than those of the one-hour cache that claude -p asks for on a subscription (Pilot 1, review of PR #4).
export function agentCommand(run, kitDir) {
  const script = `${kitDir.replaceAll('\\', '/').replace(/\/+$/, '')}/scripts/ao-agent.mjs`;
  return {
    command: process.execPath,
    args: [script, run.role, '-p', run.prompt, '--output-format', 'stream-json', '--verbose', '--effort', run.effort, ...(run.resume ? ['--resume', run.resume] : [])],
    env: { CLAUDE_CODE_EFFORT_LEVEL: run.effort, CLAUDE_CODE_PROMPT_CACHE_TTL: '5m', ...run.env },
  };
}

export async function runGo({ command, arg, options, gather, decide = decideStep, agent, git, dispatch, pack, worktree, after, act, store, sleep, now = Date.now, log = () => {}, limits: given = {} }) {
  const limits = { ...LIMITS, ...given };
  let facts = await gather();
  let decision = decide(command, facts, options);
  // A release command has no work item: its report goes under the release, such as .ai/runs/v0.1.0/.
  const key = facts.item?.key ?? facts.runKey;
  const made = [];
  let reason = null;
  let previous = null;
  while (decision.go && !reason) {
    const [next] = decision.runs;
    if (made.length >= limits.maxRuns) {
      reason = `${made.length} runs in one command, the most the runner makes; run the command again to go on`;
      break;
    }
    if (next.action === 'jira-sync') {
      log(`jira-sync for ${next.key}`);
      await dispatch(next);
      made.push({ action: 'jira-sync', key: next.key });
      ({ facts, decision } = await waitFor(() => gather(), (f) => decide(command, f, { ...options, answers: undefined, note: undefined }), (d) => !(d.go && d.runs[0]?.action === 'jira-sync'), limits.syncWaitMs, { sleep, now, limits }));
      if (decision.go && decision.runs[0]?.action === 'jira-sync') reason = `jira-sync ran, but ${next.key} is not done after ${Math.round(limits.syncWaitMs / 60000)} minutes: see the jira-sync and merge-gate runs on GitHub`;
      break;
    }
    if (next.action) {
      log(`${next.action} ${next.key}`);
      made.push({ action: next.action, key: next.key, notes: await act(next) });
      facts = await gather();
      decision = decide(command, facts, { ...options, answers: undefined, note: undefined });
      break;
    }
    // The same run again right after it ended well means the agent did not do what the facts look for.
    if (previous && previous.outcome === 'done' && same(previous, next)) {
      reason = `${next.role} ran ${next.purpose} on ${next.key} and it still has to run: read its answer in .ai/runs/${key}/last.md`;
      break;
    }
    if (next.checkout) {
      const ready = await git(next.checkout);
      if (!ready.ok) {
        reason = ready.reason;
        break;
      }
    }
    const state = store.readState(key) ?? { key, runs: [] };
    const n = (state.runs.at(-1)?.n ?? 0) + 1;
    const logName = `${n}-${next.role}.jsonl`;
    const resumed = next.resume ? state.runs.findLast((r) => r.session === next.resume) : undefined;
    log(`${n}. ${next.role} ${next.key} ${next.purpose}, effort ${next.effort}${next.resume ? ', resumes its session' : ''}`);
    const startedAt = new Date(now()).toISOString();
    // A review starts from the context pack of its PR (Pilot 1, review cost, option 2), written from the facts it was
    // decided on; without one the agent fetches what it needs itself.
    const file = pack && PACKED.includes(next.purpose) ? await pack(next, facts) : null;
    // The worktree of the PR is added just before the run and removed when it ends, whatever way it ends.
    const tree = next.worktree && worktree ? await worktree.add(next.worktree) : null;
    if (tree && !tree.ok) {
      reason = tree.reason;
      break;
    }
    const treeNote = tree && (next.worktree.kind === 'qa' ? qaWorktreeNote : worktreeNote)(tree.path, next.worktree.sha);
    const notes = [file && packNote(file), treeNote].filter(Boolean);
    const run = {
      n,
      command,
      role: next.role,
      key: next.key,
      purpose: next.purpose,
      effort: next.effort,
      log: logName,
      startedAt,
      ...(next.resume && { resumed: true }),
      ...(next.checkout && { checkout: next.checkout }),
      ...(next.head && { head: next.head }),
      ...(next.note && { note: next.note }),
      // The release a qa run tested: /ao-ship checks its regression still holds for the head (release-workflow T15).
      ...(next.qa && { qa: { environment: next.qa.environment, sha: next.qa.sha } }),
    };
    // On record from its start: a shell killed during the run leaves it unfinished, and the next command goes on in the
    // session of its log (release-workflow T22). What its session cost so far stays, for the run that resumes it.
    store.writeState(key, { ...state, runs: [...state.runs, { ...run, session: next.resume ?? null, outcome: 'unfinished', turns: 0, durationMs: 0, costUsd: 0, ...(resumed?.cumulative && { cumulative: resumed.cumulative }) }] });
    let lines;
    let stopped;
    let runNotes = [];
    try {
      ({ lines, stopped } = await agent(notes.length > 0 ? { ...next, prompt: [next.prompt, ...notes].join('\n\n') } : next, { log: logName }));
      if (after) runNotes = await after(next, { tree, facts });
    } finally {
      if (tree) {
        const removed = await worktree.remove(next.worktree);
        if (!removed.ok) log(`the worktree of ${next.worktree.name} stays: ${removed.reason}`);
      }
    }
    if (stopped) log(`${next.role} stayed alive after its result and was stopped with what it left running`);
    const read = readRun(lines, resumed);
    const record = {
      ...run,
      session: read.session,
      outcome: read.outcome,
      turns: read.turns,
      durationMs: read.durationMs,
      costUsd: read.costUsd,
      tokens: read.tokens,
      cumulative: read.cumulative,
      denials: read.denials.length,
      endedAt: new Date(now()).toISOString(),
      ...(stopped && { stoppedAfterResult: true }),
      ...(runNotes.length > 0 && { notes: runNotes }),
      text: read.text.length > TEXT_MAX ? `${read.text.slice(0, TEXT_MAX)} … [cut at ${TEXT_MAX} characters; the whole answer is in ${logName}]` : read.text,
    };
    // state.json is written before anything else, so a stopped shell can go on from here.
    store.writeState(key, { ...state, runs: [...state.runs, record] });
    // last.md gets the whole answer: it is what Claude reads to tell you what the agent said (Pilot 1, SMP-2).
    made.push({ ...record, text: read.text });
    previous = { ...record, purpose: next.purpose };
    if (read.outcome === 'usage-limit') {
      reason = `${next.role} hit the usage limit: ${read.text}. Run the same command again after it resets; the run goes on in its session`;
      break;
    }
    if (read.outcome === 'unfinished') {
      reason = `${next.role} stopped without a result: run the same command again; the run goes on in its session`;
      break;
    }
    // After a run that may have pushed, wait for CI before deciding again, but not for a CI that never starts.
    const since = now();
    const startMs = Math.min(limits.ciStartMs, limits.ciWaitMs);
    ({ facts, decision } = await waitFor(() => gather(), (f) => decide(command, f, { ...options, answers: undefined }), (_, f) => !ciPending(f) || (ciIdle(f) && now() - since >= startMs), limits.ciWaitMs, { sleep, now, limits }));
    const idle = ciIdle(facts);
    if (idle) reason = `no CI run started on PR #${idle.number} after ${Math.round(startMs / 60000)} minutes: GitHub Actions did not start the workflows. Open the Actions tab of the repo; on a new repo, push a commit that touches .github/workflows/, then run the command again`;
    else if (ciPending(facts)) reason = `CI is still running after ${Math.round(limits.ciWaitMs / 60000)} minutes: run the command again once it is done`;
  }
  const final = reason ? { go: false, reason, next: `/ao-${command} ${arg ?? ''}`.trim(), lines: decision.lines ?? [] } : decision;
  if (key) store.writeLast(key, lastReport({ command, key, made, decision: final, state: store.readState(key) }));
  // facts: what the last decision was made on, so ao-step can put the checkout on the base of the PR.
  return { decision: final, made, facts };
}

const same = (a, b) => a.role === b.role && a.purpose === b.purpose && a.key === b.key && !b.resume;

const ciPending = (facts) => Boolean((facts.pr?.state === 'open' && facts.pr.ci.pending) || (facts.docs?.pr?.state === 'open' && facts.docs.pr.ci.pending));
// The open PR whose head has no check run or status yet; null when CI started everywhere.
const ciIdle = (facts) => [facts.pr, facts.docs?.pr].find((pr) => pr?.state === 'open' && pr.ci.pending && pr.ci.started === false) ?? null;

// Gathers and decides until `done(decision, facts)` or the time is up.
async function waitFor(gatherFacts, decideOn, done, waitMs, { sleep, now, limits }) {
  const until = now() + waitMs;
  for (;;) {
    const facts = await gatherFacts();
    const decision = decideOn(facts);
    if (done(decision, facts) || now() >= until) return { facts, decision };
    await sleep(limits.pollMs);
  }
}

const usd = (value) => `${(value ?? 0).toFixed(2)} USD`;
const minutes = (ms) => `${Math.round((ms ?? 0) / 6000) / 10} min`;

// The printout of a decision (spec section 6): the facts, then GO with the runs, STOP with the reason, or the status.
export function formatDecision(decision) {
  const out = [...(decision.lines ?? [])];
  if (decision.status) {
    if (decision.next) out.push(`Next: ${decision.next}`);
    return out.join('\n');
  }
  if (decision.go) {
    out.push('GO');
    decision.runs.forEach((run, i) => {
      if (run.action === 'jira-sync') {
        out.push(`${i + 1}. jira-sync for ${run.key}, with your gh login${run.then?.mergeGate ? `; then merge-gate merges the docs PR #${run.then.mergeGate}` : ''}`);
        return;
      }
      if (run.action) {
        out.push(`${i + 1}. ${run.action} for ${run.key}, a script: no agent runs`);
        return;
      }
      const extras = [run.resume && 'resumes its session', run.when && `when ${run.when}`, run.scope, run.effortWhy && `effort ${run.effort}: ${run.effortWhy}`].filter(Boolean);
      out.push(`${i + 1}. ${run.role} ${run.key}, ${run.purpose}, effort ${run.effort}${extras.length ? ` (${extras.join('; ')})` : ''}`);
    });
    return out.join('\n');
  }
  out.push(`STOP: ${decision.reason}`);
  if (decision.questions?.length) out.push('Questions:', ...decision.questions.map((q) => `- ${q}`));
  if (decision.next) out.push(`Next: ${decision.next}`);
  return out.join('\n');
}

// .ai/runs/<KEY>/last.md: what this command did, run by run, and what comes next.
export function lastReport({ command, key, made, decision, state }) {
  const all = state?.runs ?? [];
  const total = all.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const rows = made.map((r) => (r.action ? `| - | ${r.action} | ${r.key} | | | | | |` : `| ${r.n} | ${r.role} | ${r.key} | ${r.purpose} | ${r.effort} | ${r.outcome} | ${r.turns} turns, ${minutes(r.durationMs)} | ${usd(r.costUsd)} |`));
  const text = [
    `# ${command} ${key}`,
    '',
    made.length > 0 ? '| # | Role | Item | Step | Effort | Outcome | Turns, time | Cost |\n|---|---|---|---|---|---|---|---|' : 'No run was made.',
    ...rows,
    '',
    `Cost of every run on ${key} so far: ${usd(total)}.`,
    '',
    ...made.filter((r) => r.text || r.notes?.length).flatMap((r) => [
      ...(r.text ? [`## ${r.n}. ${r.role}: its answer`, '', r.text, ''] : []),
      ...(r.notes?.length ? [r.action ? `## ${r.action}` : `## ${r.n}. ${r.role}: notes of the orchestrator`, '', ...r.notes.map((note) => `- ${note}`), ''] : []),
    ]),
    decision.go ? '## Next' : '## Stopped',
    '',
    decision.go ? formatDecision(decision) : `${decision.reason}.`,
    ...(decision.questions?.length ? ['', '## Questions', '', ...decision.questions.map((q) => `- ${q}`)] : []),
    ...(decision.next ? ['', `Next: ${decision.next}`] : []),
    '',
  ];
  return text.join('\n');
}
