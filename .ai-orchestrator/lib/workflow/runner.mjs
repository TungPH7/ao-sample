// The loop of `ao-step.mjs <command> <arg> --go` (dev-workflow spec 2.1, plan decision 3 and 7): decide, make the first
// run, write state.json, gather the facts again, decide again, until the decision is STOP. Every effect is a parameter,
// so tests run it without claude, git or the network:
//   gather()                      the facts of the command (lib/workflow/facts.mjs)
//   agent(run, { log })           starts ao-agent.mjs for one run and resolves { lines } when it ends; log is the name
//                                 of its stream-json log in .ai/runs/<KEY>/
//   git(checkout)                 puts the checkout on a branch; resolves { ok, reason }
//   dispatch(action)              asks GitHub to run jira-sync for an item (the second /ao-plan)
//   store                         { readState(key), writeState(key, state), writeLast(key, text) }
//   sleep(ms), now(), log(line)
// Agents run one after another, never two at once.
import { readRun } from './runs.mjs';
import { decideStep } from './steps.mjs';

export const LIMITS = { maxRuns: 8, ciWaitMs: 30 * 60 * 1000, syncWaitMs: 15 * 60 * 1000, pollMs: 30 * 1000 };

// The command that starts one run: ao-agent.mjs with the role, the prompt, stream-json output, and the effort both as a
// flag and as CLAUDE_CODE_EFFORT_LEVEL, which beats the flag and may be set in your environment (plan decision 6). It
// carries no token: ao-agent.mjs buys the session's own.
export function agentCommand(run, kitDir) {
  const script = `${kitDir.replaceAll('\\', '/').replace(/\/+$/, '')}/scripts/ao-agent.mjs`;
  return {
    command: process.execPath,
    args: [script, run.role, '-p', run.prompt, '--output-format', 'stream-json', '--verbose', '--effort', run.effort, ...(run.resume ? ['--resume', run.resume] : [])],
    env: { CLAUDE_CODE_EFFORT_LEVEL: run.effort },
  };
}

export async function runGo({ command, arg, options, gather, decide = decideStep, agent, git, dispatch, store, sleep, now = Date.now, log = () => {}, limits = LIMITS }) {
  let facts = await gather();
  let decision = decide(command, facts, options);
  const key = facts.item?.key;
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
    const { lines } = await agent(next, { log: logName });
    const read = readRun(lines, resumed);
    const record = {
      n,
      command,
      role: next.role,
      key: next.key,
      purpose: next.purpose,
      effort: next.effort,
      session: read.session,
      outcome: read.outcome,
      turns: read.turns,
      durationMs: read.durationMs,
      costUsd: read.costUsd,
      tokens: read.tokens,
      cumulative: read.cumulative,
      denials: read.denials.length,
      log: logName,
      startedAt,
      endedAt: new Date(now()).toISOString(),
      ...(next.resume && { resumed: true }),
      ...(next.checkout && { checkout: next.checkout }),
      ...(next.head && { head: next.head }),
      text: read.text.slice(0, 2000),
    };
    // state.json is written before anything else, so a stopped shell can go on from here.
    store.writeState(key, { ...state, runs: [...state.runs, record] });
    made.push(record);
    previous = { ...record, purpose: next.purpose };
    if (read.outcome === 'usage-limit') {
      reason = `${next.role} hit the usage limit: ${read.text}. Run the same command again after it resets; the run goes on in its session`;
      break;
    }
    if (read.outcome === 'unfinished') {
      reason = `${next.role} stopped without a result: run the same command again; the run goes on in its session`;
      break;
    }
    // After a run that may have pushed, wait for CI before deciding again.
    ({ facts, decision } = await waitFor(() => gather(), (f) => decide(command, f, { ...options, answers: undefined }), (_, f) => !ciPending(f), limits.ciWaitMs, { sleep, now, limits }));
    if (ciPending(facts)) reason = `CI is still running after ${Math.round(limits.ciWaitMs / 60000)} minutes: run the command again once it is done`;
  }
  const final = reason ? { go: false, reason, next: `/ao-${command} ${arg ?? ''}`.trim(), lines: decision.lines ?? [] } : decision;
  if (key) store.writeLast(key, lastReport({ command, key, made, decision: final, state: store.readState(key) }));
  return { decision: final, made };
}

const same = (a, b) => a.role === b.role && a.purpose === b.purpose && a.key === b.key && !b.resume;

const ciPending = (facts) => Boolean((facts.pr?.state === 'open' && facts.pr.ci.pending) || (facts.docs?.pr?.state === 'open' && facts.docs.pr.ci.pending));

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
      const extras = [run.resume && 'resumes its session', run.when && `when ${run.when}`, run.scope].filter(Boolean);
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
  const rows = made.map((r) => (r.action ? `| - | jira-sync | ${r.key} | | | | | |` : `| ${r.n} | ${r.role} | ${r.key} | ${r.purpose} | ${r.effort} | ${r.outcome} | ${r.turns} turns, ${minutes(r.durationMs)} | ${usd(r.costUsd)} |`));
  const text = [
    `# ${command} ${key}`,
    '',
    made.length > 0 ? '| # | Role | Item | Step | Effort | Outcome | Turns, time | Cost |\n|---|---|---|---|---|---|---|---|' : 'No run was made.',
    ...rows,
    '',
    `Cost of every run on ${key} so far: ${usd(total)}.`,
    '',
    ...made.filter((r) => r.text).flatMap((r) => [`## ${r.n}. ${r.role}: its answer`, '', r.text, '']),
    decision.go ? '## Next' : '## Stopped',
    '',
    decision.go ? formatDecision(decision) : `${decision.reason}.`,
    ...(decision.questions?.length ? ['', '## Questions', '', ...decision.questions.map((q) => `- ${q}`)] : []),
    ...(decision.next ? ['', `Next: ${decision.next}`] : []),
    '',
  ];
  return text.join('\n');
}
