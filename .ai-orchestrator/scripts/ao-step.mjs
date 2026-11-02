// The step behind the /ao-* commands (dev-workflow spec 2.1, 2.2): gathers the facts of a command from Jira, GitHub and
// .ai/, decides, and prints GO with the runs or STOP with the reason. With --go it then makes the runs, one agent at a
// time, and writes .ai/runs/<KEY>/state.json, a stream-json log per run, and last.md. It never moves a Jira item,
// approves or merges a PR; the second /ao-plan only asks GitHub to run jira-sync, with your gh login.
// Usage: node .ai-orchestrator/scripts/ao-step.mjs <status|spec|plan|build|review|fix> [<KEY>|<PR>] [--go]
//        [--answers <file>] [--note <file>]
// It exits 0 on GO and on STOP, and 1 only when it cannot run: a token missing, Jira or GitHub not answering.
// Jira is read with ATLASSIAN_AGENT_TOKEN, GitHub with a read-only token of the ao-review App. Run it from the project
// root; the kit is in AO_KIT_DIR when set.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { READ_PERMISSIONS } from '../lib/agents/launch.mjs';
import { mergeLocal, readRoster } from '../lib/agents/roster.mjs';
import { readContract } from '../lib/contract.mjs';
import { projectSettings, setting } from '../lib/project-settings.mjs';
import { readGates } from '../lib/quality/gates.mjs';
import { appCredentials, githubRepoOf, installationToken, userVariable } from '../lib/quality/github-app.mjs';
import { createGitHubClient } from '../lib/tracker/github-client.mjs';
import { bearerAuth, createJiraClient } from '../lib/tracker/jira-client.mjs';
import { readMapping } from '../lib/tracker/mapping.mjs';
import { gatherFacts } from '../lib/workflow/facts.mjs';
import { adfText, buildReviewPack } from '../lib/workflow/review-pack.mjs';
import { agentCommand, formatDecision, runGo } from '../lib/workflow/runner.mjs';
import { decideStep } from '../lib/workflow/steps.mjs';

const COMMANDS = ['status', 'spec', 'plan', 'build', 'review', 'fix'];
const USAGE = 'usage: node .ai-orchestrator/scripts/ao-step.mjs <status|spec|plan|build|review|fix> [<KEY>|<PR>] [--go] [--answers <file>] [--note <file>]';
const kitDir = resolve(process.env.AO_KIT_DIR ?? fileURLToPath(new URL('..', import.meta.url)));
const projectDir = process.cwd();
const runsDir = join(projectDir, '.ai', 'runs');
const git = (...args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });

// The argument of a command, checked before it reaches anything: a key of the project space, or a PR number. The
// skill passes only this word, which Claude Code puts in the shell line as it is (T1).
export function checkArgument(command, arg, space) {
  if (!COMMANDS.includes(command)) return `unknown command ${command ?? '(none)'}; ${USAGE}`;
  if (['review', 'fix'].includes(command)) return /^\d{1,7}$/.test(arg ?? '') ? null : `/ao-${command} takes a PR number, not ${arg ?? 'nothing'}`;
  if (command === 'status' && arg === undefined) return null;
  if (!/^[A-Z][A-Z0-9]*-\d{1,7}$/.test(arg ?? '')) return `/ao-${command} takes a Jira key such as ${space ?? 'DEMO'}-12, not ${arg ?? 'nothing'}`;
  if (space && !arg.startsWith(`${space}-`)) return `${arg} is not in the space ${space} of this project`;
  return null;
}

const secret = (name) => process.env[name] || userVariable(name);

// The file of --note or --answers, which the skills write in .ai/runs/<KEY>/. Its text goes to the agent as the human's
// words, so a file anywhere else is refused.
export function runsFile(projectDir, file) {
  const path = resolve(projectDir, file);
  const inside = relative(join(projectDir, '.ai', 'runs'), path);
  if (inside === '' || inside.startsWith('..') || resolve(inside) === inside) throw new Error(`--note and --answers read only a file in .ai/runs/, not ${file}`);
  return path;
}

// Takes the lock of the runs (one agent at a time) for `holder`, or returns the live holder that has it. The file is
// created only if it is not there, so two runs started at once cannot both take it; a holder whose process is gone is
// replaced.
export function takeLock(lock, holder, alive) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lock, JSON.stringify(holder), { flag: 'wx' });
      return null;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = readJson(lock);
      if (current && alive(current.pid)) return current;
      rmSync(lock, { force: true });
    }
  }
  throw new Error(`cannot take the lock ${lock}`);
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { go: { type: 'boolean', default: false }, answers: { type: 'string' }, note: { type: 'string' } } });
  const [command, arg] = positionals;
  const settings = projectSettings(projectDir);
  const space = setting('AO_JIRA_SPACE', settings);
  const wrong = checkArgument(command, arg, space);
  if (wrong) {
    console.log(`STOP: ${wrong}`);
    return;
  }
  if (!space) throw new Error('AO_JIRA_SPACE is not set in .claude/settings.json');
  const apps = { dev: setting('AO_DEV_APP', settings), review: setting('AO_REVIEW_APP', settings) };
  if (!apps.dev || !apps.review) throw new Error('AO_DEV_APP and AO_REVIEW_APP are not set in .claude/settings.json');
  const approvers = (setting('AO_APPROVERS', settings) ?? '').split(',').map((login) => login.trim()).filter(Boolean);

  const contract = readContract(join(kitDir, 'contract'));
  const mapping = readMapping(join(kitDir, 'tracker'));
  const gates = readGates(join(kitDir, 'quality'));
  const localFile = join(kitDir, 'roster.local.yaml');
  const local = existsSync(localFile) ? parse(readFileSync(localFile, 'utf8')) : undefined;
  const { roster, errors } = mergeLocal(readRoster(join(kitDir, 'agents')), local, { skillExists: (name) => existsSync(join(projectDir, '.claude', 'skills', name, 'SKILL.md')) });
  if (errors.length > 0) throw new Error(errors.join('\n'));

  const jiraToken = secret('ATLASSIAN_AGENT_TOKEN');
  if (!jiraToken) throw new Error('ATLASSIAN_AGENT_TOKEN is not set');
  const jira = createJiraClient({ cloudId: mapping.cloud_id, authorization: bearerAuth(jiraToken) });
  const repo = githubRepoOf(git('remote', 'get-url', 'origin').stdout?.trim() ?? '');
  const appEnv = { ...process.env, AO_REVIEW_APP: apps.review, AO_REVIEW_APP_ID: setting('AO_REVIEW_APP_ID', settings) };
  const { token } = await installationToken({ ...appCredentials('review', { env: appEnv }), repo, permissions: READ_PERMISSIONS });
  const github = createGitHubClient({ repo, token });
  const files = {
    ledger: (key) => existsSync(join(projectDir, '.ai', 'ledger', `${key}.md`)),
    runState: (key) => readJson(join(runsDir, key, 'state.json')),
    runStates: () => (existsSync(runsDir) ? readdirSync(runsDir).map((key) => readJson(join(runsDir, key, 'state.json'))).filter(Boolean) : []),
    // The docs branch of an Epic on this checkout, where stage spec commits before it pushes.
    branch: (name) => git('rev-parse', '--verify', '--quiet', `refs/heads/${name}`).status === 0,
    file: (branch, path) => {
      const shown = git('show', `refs/heads/${branch}:${path}`);
      return shown.status === 0 ? shown.stdout : null;
    },
  };
  const gather = () => gatherFacts({ command, arg, jira, github, local: files, contract, mapping, roster, gates, apps, approvers, space });
  const read = (file) => readFileSync(runsFile(projectDir, file), 'utf8');
  const options = { roster, contract, gates, mapping, ...(values.answers && { answers: read(values.answers) }), ...(values.note && { note: read(values.note) }) };

  const facts = await gather();
  const decision = decideStep(command, facts, options);
  console.log(formatDecision(decision));
  if (!values.go || !decision.go) return;

  const key = facts.item.key;
  const lock = join(runsDir, 'active.json');
  mkdirSync(join(runsDir, key), { recursive: true });
  const holder = takeLock(lock, { pid: process.pid, command, arg, startedAt: new Date().toISOString() }, alive);
  if (holder) {
    console.log(`STOP: ao-step is already running ${holder.command} ${holder.arg} (process ${holder.pid}); agents run one at a time`);
    return;
  }
  try {
    console.log('');
    const { decision: final } = await runGo({
      command,
      arg,
      options,
      gather,
      agent: (run, { log }) => startAgent(run, join(runsDir, key, log)),
      git: (checkout) => prepareCheckout(checkout),
      dispatch: (action) => dispatchJiraSync(action.key),
      pack: reviewPackWriter({ github, jira }),
      store: {
        readState: (k) => readJson(join(runsDir, k, 'state.json')),
        writeState: (k, state) => writeFileSync(join(runsDir, k, 'state.json'), `${JSON.stringify(state, null, 2)}\n`),
        writeLast: (k, text) => writeFileSync(join(runsDir, k, 'last.md'), text),
      },
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      log: (line) => console.log(line),
    });
    console.log(`\n${formatDecision(final)}\nReport: .ai/runs/${key}/last.md`);
  } finally {
    rmSync(lock, { force: true });
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// One run: ao-agent.mjs with its stream-json output appended to the log as it comes; resolves with the lines.
function startAgent(run, logFile) {
  const { command, args, env } = agentCommand(run, kitDir);
  return new Promise((done) => {
    const lines = [];
    let rest = '';
    const child = spawn(command, args, { cwd: projectDir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => {
      appendFileSync(logFile, chunk);
      const text = rest + chunk.toString('utf8');
      const parts = text.split('\n');
      rest = parts.pop();
      lines.push(...parts);
    });
    child.stderr.on('data', (chunk) => appendFileSync(`${logFile}.stderr`, chunk));
    child.on('error', (error) => {
      appendFileSync(`${logFile}.stderr`, `cannot start the agent: ${error.message}\n`);
      done({ lines });
    });
    child.on('close', () => done({ lines: rest ? [...lines, rest] : lines }));
  });
}

// Puts the checkout on `branch` before a run: from origin when it is there, else new from origin/<from>. A checkout with
// changes is left alone.
// The context pack of a review run (Pilot 1, review cost, option 2): read from git, GitHub and Jira at the PR head and
// written to .ai/reviews/<PR>-context.md. Any failure leaves the run without a pack: the agent then fetches what it
// needs itself, as before.
export function reviewPackWriter({ github, jira }) {
  return async (run, facts) => {
    const { pr, item } = facts;
    try {
      git('fetch', '--quiet', 'origin', pr.base, pr.headRef);
      const head = pr.headSha;
      const baseSha = git('merge-base', `origin/${pr.base}`, head).stdout.trim();
      if (!baseSha) throw new Error(`no merge base of origin/${pr.base} and ${head.slice(0, 7)}`);
      const show = (path) => {
        const shown = git('show', `${head}:${path}`);
        return shown.status === 0 ? shown.stdout : null;
      };
      const range = `${baseSha}...${head}`;
      const files = git('diff', '--name-status', range).stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [status, ...paths] = line.split('\t');
        return { status, path: paths.at(-1) };
      });
      const modified = files.filter(({ status }) => status.startsWith('M')).map(({ path }) => ({ path, text: show(path) ?? '' }));
      const epic = item.parent && /epic/i.test(item.parent.type) ? item.parent.key : null;
      const adrs = git('ls-tree', '--name-only', head, 'docs/adr/').stdout.trim().split('\n').filter((name) => name.endsWith('.md'));
      const docs = epic && {
        epic,
        plan: show(`docs/specs/${epic}/plan.md`),
        spec: show(`docs/specs/${epic}/spec.md`),
        design: show(`docs/specs/${epic}/design.md`),
        adrs: adrs.map((path) => ({ name: path.split('/').at(-1), text: show(path) ?? '' })),
      };
      const runs = await github.get(`/commits/${head}/check-runs`, { per_page: 100 });
      const issue = await jira.get(`/rest/api/3/issue/${encodeURIComponent(item.key)}`, { fields: 'description' });
      const text = buildReviewPack({
        pr: { ...pr, baseSha },
        checks: (runs.check_runs ?? []).map(({ name, status, conclusion }) => `${name}: ${conclusion ?? status}`),
        item: { ...item, parent: item.parent?.key ?? null, links: (item.blockedBy ?? []).map((key) => `is blocked by ${key}`), description: adfText(issue.fields?.description) },
        docs,
        template: readFileSync(join(kitDir, 'templates', 'review-report.md'), 'utf8'),
        files,
        modified,
        diff: git('diff', range).stdout,
        stat: git('diff', '--stat', range).stdout,
      });
      const name = `.ai/reviews/${pr.number}-context.md`;
      mkdirSync(join(projectDir, '.ai', 'reviews'), { recursive: true });
      writeFileSync(join(projectDir, name), text);
      console.log(`context pack ${name}: ${text.length} characters`);
      return name;
    } catch (error) {
      console.log(`no context pack for PR #${pr.number} (${error.message}); the agent fetches what it needs itself`);
      return null;
    }
  };
}

function prepareCheckout({ branch, from, pull }) {
  const dirty = git('status', '--porcelain', '--untracked-files=no').stdout.trim();
  if (dirty) return { ok: false, reason: `the checkout has changes not committed (${dirty.split('\n').length} files): commit or stash them, then run the command again` };
  const fetched = git('fetch', '--quiet', 'origin');
  if (fetched.status !== 0) return { ok: false, reason: `git fetch failed: ${fetched.stderr.trim()}` };
  const onOrigin = git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`).status === 0;
  const local = git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status === 0;
  let result;
  if (local) result = git('switch', '--quiet', branch);
  else if (onOrigin) result = git('switch', '--quiet', '--track', `origin/${branch}`);
  // --no-track: the new branch must not take origin/develop as its upstream, or the agent's push would go there.
  else result = git('switch', '--quiet', '--no-track', '-c', branch, `origin/${from ?? 'develop'}`);
  if (result.status !== 0) return { ok: false, reason: `git could not switch to ${branch}: ${result.stderr.trim()}` };
  if ((pull || local) && onOrigin) {
    const merged = git('merge', '--ff-only', '--quiet', `origin/${branch}`);
    if (merged.status !== 0) return { ok: false, reason: `${branch} has commits that are not on origin/${branch}: ${merged.stderr.trim()}` };
  }
  return { ok: true };
}

// The second /ao-plan: jira-sync for the Epic, with your gh login, since this is your session, not an agent's.
function dispatchJiraSync(key) {
  const result = spawnSync('gh', ['workflow', 'run', 'jira-sync.yml', '-f', `item=${key}`], { cwd: projectDir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`gh workflow run jira-sync.yml failed: ${(result.stderr || result.stdout).trim()}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ao-step: ${error.message}`);
    process.exit(1);
  });
}
