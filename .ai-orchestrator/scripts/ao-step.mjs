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
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { CLEARED_ENV, READ_PERMISSIONS } from '../lib/agents/launch.mjs';
import { mergeLocal, readRoster } from '../lib/agents/roster.mjs';
import { readContract } from '../lib/contract.mjs';
import { projectSettings, setting } from '../lib/project-settings.mjs';
import { unquotePath } from '../lib/quality/diff-paths.mjs';
import { readGates } from '../lib/quality/gates.mjs';
import { matchesGlob } from '../lib/quality/glob.mjs';
import { appCredentials, botIdentity, githubRepoOf, installationToken, userVariable } from '../lib/quality/github-app.mjs';
import { runNpm } from '../lib/quality/npm.mjs';
import { attachEvidence } from '../lib/tracker/attachments.mjs';
import { createGitHubClient, readGitHubToken } from '../lib/tracker/github-client.mjs';
import { bearerAuth, createJiraClient } from '../lib/tracker/jira-client.mjs';
import { readMapping } from '../lib/tracker/mapping.mjs';
import { startAgentProcess, killTree } from '../lib/workflow/agent-process.mjs';
import { withLoggedSession } from '../lib/workflow/runs.mjs';
import { gatherFacts, readRunning } from '../lib/workflow/facts.mjs';
import { basicAuthEnv, qaFollowUp } from '../lib/workflow/qa.mjs';
import { releaseCutChanges } from '../lib/release/release-cut.mjs';
import { changelogWith } from '../lib/release/release-pr.mjs';
import { requestDeploy } from '../lib/release/deploy-request.mjs';
import { adfText, buildReviewPack, filesToQuote } from '../lib/workflow/review-pack.mjs';
import { postKitCopyReports, readKitCopy, renderedReason } from '../lib/workflow/kit-copy.mjs';
import { removeInstructions } from '../lib/workflow/review-tree.mjs';
import { agentCommand, formatDecision, runGo } from '../lib/workflow/runner.mjs';
import { decideStep } from '../lib/workflow/steps.mjs';

const COMMANDS = ['status', 'spec', 'plan', 'build', 'review', 'fix', 'qa', 'release', 'ship', 'rollback'];
const USAGE = 'usage: node .ai-orchestrator/scripts/ao-step.mjs <status|spec|plan|build|review|fix|qa|release|ship|rollback> [<KEY>|<PR>|<vX.Y.0> <sha>|<vX.Y.Z>|<environment> [<sha>]] [--go] [--answers <file>] [--note <file>]';
const ENVIRONMENTS = ['development', 'staging', 'production'];
// The commands that read deployments with your gh login (release-workflow T12).
const RELEASE_COMMANDS = ['qa', 'release', 'ship', 'rollback', 'status'];
const kitDir = resolve(process.env.AO_KIT_DIR ?? fileURLToPath(new URL('..', import.meta.url)));
const projectDir = process.cwd();
const runsDir = join(projectDir, '.ai', 'runs');
// maxBuffer: the full text of a file or a diff may pass the 1 MiB default, which ends git with ENOBUFS and no output.
const git = (...args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// The argument of a command, checked before it reaches anything: a key of the project space, or a PR number. The
// skill passes only this word, which Claude Code puts in the shell line as it is (T1).
export function checkArgument(command, arg, space, extra) {
  if (!COMMANDS.includes(command)) return `unknown command ${command ?? '(none)'}; ${USAGE}`;
  if (command === 'ship') return /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(arg ?? '') && extra === undefined ? null : `/ao-ship takes a release such as v0.1.0, not ${[arg, extra].filter(Boolean).join(' ') || 'nothing'}`;
  if (command === 'rollback') {
    const ok = ENVIRONMENTS.includes(arg) && (extra === undefined || /^[0-9a-f]{7,40}$/.test(extra));
    return ok ? null : `/ao-rollback takes an environment (${ENVIRONMENTS.join(', ')}) and maybe a commit, not ${[arg, extra].filter(Boolean).join(' ') || 'nothing'}`;
  }
  if (command === 'release') {
    const ok = (arg === undefined && extra === undefined) || (/^v\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(arg ?? '') && /^[0-9a-f]{7,40}$/.test(extra ?? ''));
    return ok ? null : `/ao-release takes nothing, or a release such as v0.1.0 and the cut point it printed, not ${[arg, extra].filter(Boolean).join(' ') || 'that'}`;
  }
  if (extra !== undefined) return `/ao-${command} takes one argument`;
  if (['review', 'fix'].includes(command)) return /^\d{1,7}$/.test(arg ?? '') ? null : `/ao-${command} takes a PR number, not ${arg ?? 'nothing'}`;
  if (command === 'status' && arg === undefined) return null;
  if (!/^[A-Z][A-Z0-9]*-\d{1,7}$/.test(arg ?? '')) return `/ao-${command} takes a Jira key such as ${space ?? 'DEMO'}-12, not ${arg ?? 'nothing'}`;
  if (space && !arg.startsWith(`${space}-`)) return `${arg} is not in the space ${space} of this project`;
  return null;
}

// ao-step, the kit and the instructions of the agents are read from the checkout, so a review or a fix starts only on a
// protected branch: on the branch of a PR it would run that PR's code (second review of ao-sample PR #13). This
// catches a slip; what keeps the checkout there is homeBranch below, run by the code the command started with.
const isProtected = (branch, protectedBranches) => protectedBranches.some((pattern) => matchesGlob(pattern, branch));
export function checkoutStop(command, branch, protectedBranches) {
  if (!['review', 'fix'].includes(command) || isProtected(branch, protectedBranches)) return null;
  return `the checkout is on ${branch || 'a detached HEAD'}, not a protected branch (${protectedBranches.join(', ')}): ao-step, the kit and the instructions of the agents would come from it. Switch it to the base of the PR (git switch develop), then run /ao-${command} again`;
}

// The branch the checkout goes back to when a command ends: the base of the item's open PR, so the next /ao-review or
// /ao-fix starts on approved code. A build whose PR is not open yet stays on its branch, where the next run goes on.
export function homeBranch(command, facts, protectedBranches) {
  const pr = facts?.pr;
  if (!['build', 'review', 'fix'].includes(command) || pr?.state !== 'open') return null;
  return isProtected(pr.base, protectedBranches) ? pr.base : null;
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
  const [command, arg, extra] = positionals;
  const settings = projectSettings(projectDir);
  const space = setting('AO_JIRA_SPACE', settings);
  const wrong = checkArgument(command, arg, space, extra);
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
  const onBranch = () => git('branch', '--show-current').stdout?.trim() ?? '';
  const wrongCheckout = checkoutStop(command, onBranch(), gates.protected_branches);
  if (wrongCheckout) {
    console.log(`STOP: ${wrongCheckout}`);
    return;
  }
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
    runState: readRunState,
    runStates: () => (existsSync(runsDir) ? readdirSync(runsDir).map(readRunState).filter(Boolean) : []),
    // The docs branch of an Epic on this checkout, where stage spec commits before it pushes.
    branch: (name) => git('rev-parse', '--verify', '--quiet', `refs/heads/${name}`).status === 0,
    file: (branch, path) => {
      const shown = git('show', `refs/heads/${branch}:${path}`);
      return shown.status === 0 ? shown.stdout : null;
    },
    // A file the agents of a release command wrote in .ai/runs/<release>/ (release-workflow T15).
    runFile: (k, name) => readRunFile(k, name),
  };
  // The release commands read deployments with your gh login: the read token of ao-review may not (release-workflow T12).
  const userToken = RELEASE_COMMANDS.includes(command) ? readGitHubToken() : null;
  const deploys = userToken ? createGitHubClient({ repo, token: userToken }) : undefined;
  // A kit copy is compared with a head of another project, which your gh login reads (kit-copy-review spec 2.5).
  const peers = (setting('AO_KIT_PEERS', settings) ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  const kitCopy = (pr) => readKitCopy({ pr, github, peer: (name) => createGitHubClient({ repo: name, token: readGitHubToken() }), peers, gates, apps, approvers, render: (sha, paths) => renderCheck(pr.number, sha, paths) });
  const gather = () => gatherFacts({ command, arg, extra, jira, github, deploys, history: developHistory, local: files, contract, mapping, roster, gates, apps, approvers, space, kitCopy });
  const read = (file) => readFileSync(runsFile(projectDir, file), 'utf8');
  const options = { roster, contract, gates, mapping, ...(values.answers && { answers: read(values.answers) }), ...(values.note && { note: read(values.note) }) };

  const facts = await gather();
  const decision = decideStep(command, facts, options);
  console.log(formatDecision(decision));
  if (!values.go || !decision.go) return;

  // A release command has no work item: its runs and report go under the release (.ai/runs/v0.1.0/).
  const key = facts.item?.key ?? facts.runKey;
  const lock = join(runsDir, 'active.json');
  mkdirSync(join(runsDir, key), { recursive: true });
  const holder = takeLock(lock, { pid: process.pid, command, arg, startedAt: new Date().toISOString() }, alive);
  if (holder) {
    console.log(`STOP: ao-step is already running ${holder.command} ${holder.arg} (process ${holder.pid}); agents run one at a time`);
    return;
  }
  try {
    console.log('');
    const { decision: final, facts: last } = await runGo({
      command,
      arg,
      options,
      gather,
      // qa on Development or Staging gets the basic auth from AO_ENV_AUTH, as variables, never as arguments.
      agent: (run, { log }) => startAgent(run.qa?.auth ? { ...run, env: { ...run.env, ...basicAuthEnv(secret('AO_ENV_AUTH')) } } : run, join(runsDir, key, log)),
      after: (run, { tree }) => (run.purpose === 'qa' ? afterQa(run, tree, { deploys, mapping }) : []),
      act: (step) => {
        if (step.action === 'release-pr') return releasePr(step, { repo, settings });
        if (step.action === 'hotfix-ship') return hotfixShip(step, { repo, settings, userToken });
        if (step.action === 'deploy-request') return deployRequest(step, { repo, userToken });
        if (step.action === 'kit-copy-reports') return kitCopyReports(step, { repo, appEnv });
        return releaseCut(step, { repo, mapping, settings });
      },
      git: (checkout) => prepareCheckout(checkout),
      dispatch: (action) => dispatchJiraSync(action.key),
      pack: reviewPackWriter({ github, jira }),
      worktree: { add: addWorktree, remove: removeWorktree },
      store: {
        readState: readRunState,
        writeState: (k, state) => writeFileSync(join(runsDir, k, 'state.json'), `${JSON.stringify(state, null, 2)}\n`),
        writeLast: (k, text) => writeFileSync(join(runsDir, k, 'last.md'), text),
      },
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      log: (line) => console.log(line),
    });
    console.log(`\n${formatDecision(final)}\nReport: .ai/runs/${key}/last.md`);
    const home = homeBranch(command, last, gates.protected_branches);
    const now = onBranch();
    if (home && now !== home) {
      const back = prepareCheckout({ branch: home, pull: true });
      console.log(back.ok ? `The checkout is back on ${home}, so the next /ao-review or /ao-fix starts from approved code.` : `The checkout stays on ${now}: ${back.reason}. Switch it to ${home} before the next /ao-review or /ao-fix.`);
    }
  } finally {
    rmSync(lock, { force: true });
  }
}

// state.json of a run folder; a run killed with its shell gets its session from its log.
function readRunState(key) {
  const log = (name) => (existsSync(join(runsDir, key, name)) ? readFileSync(join(runsDir, key, name), 'utf8').split('\n') : []);
  return withLoggedSession(readJson(join(runsDir, key, 'state.json')), log);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// A file in .ai/runs/<key>/, or null. The key is a work item or a release that checkArgument let through, and the
// name one of the kit's own.
function readRunFile(key, name) {
  try {
    return readFileSync(join(runsDir, key, name), 'utf8');
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
  return startAgentProcess({
    spawn,
    command,
    args,
    env: { ...process.env, ...env },
    cwd: projectDir,
    append: (stream, chunk) => appendFileSync(stream === 'stdout' ? logFile : `${logFile}.stderr`, chunk),
    kill: (pid) => killTree(pid, { spawnSync, kill: (target, signal) => process.kill(target, signal) }),
  });
}

// The context pack of a review run (Pilot 1, review cost, option 2): the PR, its files and diff at its head; the Epic's
// documents and the review report template at the merge base, as approved at gate ② (review of ao-sample PR #6: a dev
// agent may change docs/ in its own PR); written to .ai/reviews/<PR>-context.md. git, github and jira are parameters,
// for tests. Any failure leaves the run without a pack: the agent then fetches what it needs itself, as before.
export function reviewPackWriter({ github, jira, git: run = git, projectDir: dir = projectDir, kitDir: kit = kitDir, save = savePack(dir), log = console.log }) {
  return async (_run, facts) => {
    const { pr, item } = facts;
    try {
      const need = (...args) => {
        const result = run(...args);
        if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${(result.stderr || result.error?.message || '').trim()}`);
        return result.stdout;
      };
      // The PR by its number: its branch name is the author's, and one starting with - would read as an option.
      need('fetch', '--quiet', 'origin', `refs/heads/${pr.base}`, `refs/pull/${pr.number}/head`);
      const head = pr.headSha;
      // git merge-base exits 1 when there is none, so need throws then.
      const baseSha = need('merge-base', `origin/${pr.base}`, head).trim();
      const show = (sha, path) => {
        const shown = run('show', `${sha}:${path}`);
        return shown.status === 0 ? shown.stdout : null;
      };
      const range = `${baseSha}...${head}`;
      const files = need('diff', '--name-status', range).trim().split('\n').filter(Boolean).map((line) => {
        const [status, ...paths] = line.split('\t').map(unquotePath);
        return paths.length > 1 ? { status, from: paths[0], path: paths[1] } : { status, path: paths[0] };
      });
      const modified = filesToQuote(files).map((path) => ({ path, text: show(head, path) }));
      const epic = item.parent && /epic/i.test(item.parent.type) ? item.parent.key : null;
      const docs = epic && {
        epic,
        plan: show(baseSha, `docs/specs/${epic}/plan.md`),
        spec: show(baseSha, `docs/specs/${epic}/spec.md`),
        design: show(baseSha, `docs/specs/${epic}/design.md`),
        adrs: need('ls-tree', '--name-only', baseSha, 'docs/adr/').trim().split('\n').filter((name) => name.endsWith('.md'))
          .map((path) => ({ name: path.split('/').at(-1), text: show(baseSha, path) ?? '' })),
      };
      // The kit inside the project is one of the PR's paths, so its template is read at the base too.
      const kitPath = relative(dir, kit).replaceAll('\\', '/');
      const inside = kitPath !== '' && !kitPath.startsWith('..') && !isAbsolute(kitPath);
      const template = (inside && show(baseSha, `${kitPath}/templates/review-report.md`)) || readFileSync(join(kit, 'templates', 'review-report.md'), 'utf8');
      const runs = await github.get(`/commits/${head}/check-runs`, { per_page: 100 });
      const issue = await jira.get(`/rest/api/3/issue/${encodeURIComponent(item.key)}`, { fields: 'description' });
      const diff = run('diff', range);
      const text = buildReviewPack({
        pr: { ...pr, baseSha },
        checks: (runs.check_runs ?? []).map(({ name, status, conclusion }) => `${name}: ${conclusion ?? status}`),
        item: { ...item, parent: item.parent?.key ?? null, links: (item.blockedBy ?? []).map((key) => `is blocked by ${key}`), description: adfText(issue.fields?.description) },
        docs,
        template,
        files,
        modified,
        diff: diff.status === 0 ? diff.stdout : null,
        stat: need('diff', '--stat', range),
      });
      const name = `.ai/reviews/${pr.number}-context.md`;
      save(name, text);
      log(`context pack ${name}: ${text.length} characters`);
      return name;
    } catch (error) {
      log(`no context pack for PR #${pr.number} (${error.message}); the agent fetches what it needs itself`);
      return null;
    }
  };
}

const savePack = (dir) => (name, text) => {
  mkdirSync(join(dir, '.ai', 'reviews'), { recursive: true });
  writeFileSync(join(dir, name), text);
};

// Puts the checkout on `branch` before a run: from origin when it is there, else new from origin/<from>. A checkout with
// changes is left alone.
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

// The worktree of a PR for its review (Pilot 1, T10): the code at the head the review is on, never committed. It is in
// the temp folder, outside the project: Claude Code loads the instruction files (CLAUDE.md, AGENTS.md, .claude/rules) of
// a folder of the project when the agent reads a file there, and a probe of the second review of ao-sample PR #13 found
// that it loads none from a folder outside it, while agents still read, search and run commands there, and gh-guard lets
// them write in the temp folder. --add-dir is not given: with it, the skills of the folder's .claude/skills load. The
// instruction files are still removed from it, in case a later Claude Code loads more. A stale worktree from a run that
// was stopped is replaced. Node finds no node_modules there, so tests that need packages do not run in it.
export const reviewTreePath = (project, name, tmp = tmpdir()) => join(tmp, 'ao-reviews', `${basename(resolve(project))}-${name}`);
function addWorktree({ name, sha, install = false, keepInstructions = false }) {
  const path = reviewTreePath(projectDir, name);
  if (existsSync(path)) removeWorktree({ name });
  mkdirSync(join(path, '..'), { recursive: true });
  const added = git('worktree', 'add', '--detach', '--quiet', path, sha);
  if (added.status !== 0) return { ok: false, reason: `git could not add the worktree of ${name} at ${sha.slice(0, 7)}: ${(added.stderr || added.stdout).trim()}` };
  try {
    if (!keepInstructions) removeInstructions(path, { readdirSync, rmSync });
  } catch (error) {
    removeWorktree({ name });
    return { ok: false, reason: `the instruction files of the PR could not be removed from its worktree: ${error.message}` };
  }
  // qa runs the E2E there (release-workflow spec 2.5): the packages of that commit, without their install scripts, and
  // without your secrets in their environment.
  if (install) {
    const env = { ...process.env };
    for (const name of CLEARED_ENV) delete env[name];
    const installed = runNpm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: path, env, encoding: 'utf8' });
    if (installed.status !== 0) {
      removeWorktree({ name });
      return { ok: false, reason: `npm ci failed in the worktree of ${name} at ${sha.slice(0, 7)}: ${(installed.stderr || installed.error?.message || '').trim().slice(-500)}` };
    }
  }
  return { ok: true, path: path.replaceAll('\\', '/') };
}

// Whether the rendered files of a kit copy are what their sources give (kit-copy-review spec 2.3). The renderer is the
// one of this kit, never the PR's, and its sources were compared with the reviewed head before this runs. The tree keeps
// its instruction files, which render-agents reads, because no agent runs in it.
function renderCheck(number, sha, paths) {
  const name = `kit-copy-${number}`;
  return renderedReason({
    sha,
    paths,
    tree: {
      add: () => {
        const fetched = git('fetch', '--quiet', 'origin', `refs/pull/${number}/head`);
        return fetched.status === 0 ? addWorktree({ name, sha, keepInstructions: true }) : { ok: false, reason: `git fetch failed: ${fetched.stderr.trim()}` };
      },
      remove: () => removeWorktree({ name }),
    },
    render: (path) => {
      const env = { ...process.env };
      for (const secretName of CLEARED_ENV) delete env[secretName];
      const run = (flag) => spawnSync(process.execPath, [join(kitDir, 'scripts', 'render-agents.mjs'), flag, '--project', path], { env, encoding: 'utf8' });
      const checked = run('--check');
      const listed = run('--list');
      if (listed.status !== 0) return { status: listed.status, text: listed.stderr ?? '', files: [] };
      return { status: checked.status, text: `${checked.stdout ?? ''}${checked.stderr ?? ''}`, files: listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean) };
    },
  });
}

// The reports of a kit copy, with the ao-review App, on the head that was compared (kit-copy-review spec 2.4).
async function kitCopyReports(step, { repo, appEnv }) {
  const { token } = await installationToken({ ...appCredentials('review', { env: appEnv }), repo, permissions: { pull_requests: 'write' } });
  return postKitCopyReports({ github: createGitHubClient({ repo, token, write: true }), step });
}

// The first-parent history of develop on GitHub after the tag `tag`, oldest first, as parseHistory reads it
// (release-workflow spec 2.6). The tag comes from GitHub and has the form vX.Y.Z (latestTag), so it is no option.
function developHistory(tag) {
  const fetched = git('fetch', '--quiet', '--tags', 'origin', 'develop');
  if (fetched.status !== 0) throw new Error(`git fetch failed: ${(fetched.stderr || '').trim()}`);
  const shown = git('log', '--first-parent', '--reverse', '--format=%H%x09%s', tag ? `${tag}..origin/develop` : 'origin/develop');
  if (shown.status !== 0) throw new Error(`git log failed: ${(shown.stderr || '').trim()}`);
  return shown.stdout;
}

// /ao-release <vX.Y.0> <sha>, its one step (release-workflow spec 2.6): the Fix Versions and comments on Jira with the CI
// token, which only your session holds, then the release branch as the ao-dev App. The branch comes last: once it is
// there the command stops at "release branch open", so a step cut short before it can be run again.
async function releaseCut({ version, nextVersion, sha, included, after }, { repo, mapping, settings }) {
  const notes = [];
  const ciToken = secret('JIRA_CI_TOKEN');
  if (!ciToken) throw new Error('JIRA_CI_TOKEN is not set in your session');
  const jira = createJiraClient({ cloudId: mapping.cloud_id, authorization: bearerAuth(ciToken), write: true });
  const changes = releaseCutChanges({ version, nextVersion, sha, approvedAt: new Date().toISOString(), included, after });
  for (const { key, names } of changes.fixVersions) await jira.editItem(key, { fields: { fixVersions: names.map((name) => ({ name })) } });
  for (const { key, text } of changes.comments) await jira.comment(key, text);
  notes.push(`Fix Version ${version} on ${included.map(({ key }) => key).join(', ')}.`);
  const moved = changes.fixVersions.filter(({ key }) => !included.some((item) => item.key === key)).map(({ key }) => key);
  if (moved.length > 0) notes.push(`Moved to ${nextVersion}: ${moved.join(', ')}.`);
  const devEnv = { ...process.env, AO_DEV_APP: setting('AO_DEV_APP', settings), AO_DEV_APP_ID: setting('AO_DEV_APP_ID', settings) };
  const { token } = await installationToken({ ...appCredentials('dev', { env: devEnv }), repo, permissions: { contents: 'write' } });
  await createGitHubClient({ repo, token, write: true }).request('POST', '/git/refs', undefined, { ref: `refs/heads/release/${version}`, sha });
  notes.push(`Created release/${version} at ${sha.slice(0, 8)} as ${setting('AO_DEV_APP', settings)}[bot].`);
  return notes;
}

// A file of a branch on GitHub, or null when it has none.
async function contentOf(github, path, branch) {
  try {
    const { content } = await github.get(`/contents/${path}`, { ref: branch });
    return Buffer.from(content, 'base64').toString('utf8');
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

// /ao-ship vX.Y.0, its last step (release-workflow spec 2.7, steps 4 and 5): as the ao-dev App, one commit on the release
// branch with the regression report as docs/releases/<version>.md and the section of the release in CHANGELOG.md, then
// the check that the branch changed nothing else since the regression, then the release PR into main. The commit names
// the bot as author and committer, as audit's rule for the release report wants. Run again, it commits nothing new and
// opens no second PR.
async function releasePr({ version, branch, regression }, { repo, settings }) {
  const [report, section, body] = ['regression-report.md', 'changelog.md', 'pr-description.md'].map((name) => readRunFile(version, name));
  if (!report || !section || !body) throw new Error(`.ai/runs/${version}/ lacks the regression report or the notes of devops`);
  const slug = setting('AO_DEV_APP', settings);
  const devEnv = { ...process.env, AO_DEV_APP: slug, AO_DEV_APP_ID: setting('AO_DEV_APP_ID', settings) };
  const { token } = await installationToken({ ...appCredentials('dev', { env: devEnv }), repo, permissions: { contents: 'write', pull_requests: 'write' } });
  const github = createGitHubClient({ repo, token, write: true });
  const bot = await botIdentity({ slug, token });
  const notes = [];
  const head = (await github.get(`/git/ref/heads/${branch}`)).object.sha;
  const reportPath = `docs/releases/${version}.md`;
  const current = await contentOf(github, 'CHANGELOG.md', branch);
  const changelog = changelogWith(current, section, version);
  if (changelog !== current || report !== (await contentOf(github, reportPath, branch))) {
    const { tree } = await github.get(`/git/commits/${head}`);
    const files = [{ path: reportPath, content: report }, { path: 'CHANGELOG.md', content: changelog }].map((file) => ({ ...file, mode: '100644', type: 'blob' }));
    const made = await github.request('POST', '/git/trees', undefined, { base_tree: tree.sha, tree: files });
    const signed = { ...bot, date: new Date().toISOString() };
    const commit = await github.request('POST', '/git/commits', undefined, { message: `docs(release): add the regression report and the changelog of ${version}`, tree: made.sha, parents: [head], author: signed, committer: signed });
    await github.request('PATCH', `/git/refs/heads/${branch}`, undefined, { sha: commit.sha, force: false });
    notes.push(`Committed ${reportPath} and CHANGELOG.md on ${branch} as ${bot.name}: ${commit.sha.slice(0, 8)}.`);
  }
  const allowed = [reportPath, 'CHANGELOG.md'];
  const changed = ((await github.get(`/compare/${regression}...${branch}`)).files ?? []).flatMap(({ filename, previous_filename: previous }) => (previous ? [previous, filename] : [filename]));
  const beyond = [...new Set(changed.filter((file) => !allowed.includes(file)))];
  if (beyond.length > 0) throw new Error(`${branch} changed ${beyond.join(', ')} since the regression on ${regression.slice(0, 8)}: run /ao-ship ${version} again, and the regression runs again`);
  const open = (await github.getAll('/pulls', { state: 'open', base: 'main' })).find((pr) => pr.head.ref === branch);
  // The notes may have been written again (T21): the description follows them.
  if (open) {
    if (open.body !== body) await github.request('PATCH', `/pulls/${open.number}`, undefined, { body });
    notes.push(`PR #${open.number} of ${branch} into main is open already${open.body !== body ? '; its description now holds the new notes' : ''}.`);
  }
  else {
    const pr = await github.request('POST', '/pulls', undefined, { title: `release: ${version}`, head: branch, base: 'main', body });
    notes.push(`Opened PR #${pr.number} of ${branch} into main.`);
  }
  return notes;
}

// A writing client of your gh login: GitHub records you as the creator of what it makes (gate ⑤, spec 2.4).
function yours(repo, userToken) {
  if (!userToken) throw new Error('log in with gh auth login: the deployment request must be yours');
  return createGitHubClient({ repo, token: userToken, write: true });
}

// /ao-rollback, its one step (release-workflow spec 2.9): the deployment request, with your gh login.
async function deployRequest({ environment, sha, rollback }, { repo, userToken }) {
  const id = await requestDeploy(yours(repo, userToken), { sha, environment, rollback });
  return [`Deployment request #${id} for ${sha.slice(0, 8)} on ${environment}${rollback ? ', a rollback' : ''}, made with your gh login. The deployer takes it within a minute or two.`];
}

// /ao-ship of a hotfix, its one step (release-workflow spec 2.8, steps 6 and 7): with your gh login the tag and the
// deployment request for Production; as the ao-dev App the PRs that merge main back, unless one is open already.
async function hotfixShip({ version, sha, backMerges }, { repo, settings, userToken }) {
  const github = yours(repo, userToken);
  const notes = [];
  try {
    await github.request('POST', '/git/refs', undefined, { ref: `refs/tags/${version}`, sha });
    notes.push(`Tagged ${version} at ${sha.slice(0, 8)} with your gh login.`);
  } catch (error) {
    if (error.status !== 422) throw error;
    notes.push(`The tag ${version} is there already.`);
  }
  const id = await requestDeploy(github, { sha, environment: 'production', rollback: false });
  notes.push(`Deployment request #${id} for ${version} on Production, made with your gh login (gate ⑤).`);
  const devEnv = { ...process.env, AO_DEV_APP: setting('AO_DEV_APP', settings), AO_DEV_APP_ID: setting('AO_DEV_APP_ID', settings) };
  const { token } = await installationToken({ ...appCredentials('dev', { env: devEnv }), repo, permissions: { pull_requests: 'write', contents: 'read' } });
  const dev = createGitHubClient({ repo, token, write: true });
  for (const base of backMerges) {
    const open = (await dev.getAll('/pulls', { state: 'open', base })).find((pr) => pr.head.ref === 'main');
    if (open) {
      notes.push(`The merge of main back into ${base} is open already: PR #${open.number}.`);
      continue;
    }
    const pr = await dev.request('POST', '/pulls', undefined, { title: `Merge main into ${base} after ${version}`, head: 'main', base, body: `merge-gate merges main back into ${base} with a merge commit once CI is green and there is no conflict (release-workflow spec 2.8).` });
    notes.push(`Opened PR #${pr.number}: main into ${base}.`);
  }
  return notes;
}

// The files under a folder, with forward slashes; [] when there is none.
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name).replaceAll('\\', '/'));
}

// After a qa run, before its worktree goes: the evidence to the item with the CI token, which only this session holds,
// and whether the environment still runs the release qa tested (release-workflow spec 2.5).
function afterQa(run, tree, { deploys, mapping }) {
  const ciToken = secret('JIRA_CI_TOKEN');
  const jira = ciToken ? createJiraClient({ cloudId: mapping.cloud_id, authorization: bearerAuth(ciToken), write: true }) : null;
  return qaFollowUp({
    run,
    tree,
    projectDir,
    list: listFiles,
    attach: (key, paths) => {
      if (!jira) throw new Error('JIRA_CI_TOKEN is not set in your session');
      return attachEvidence({ jira, key, files: paths });
    },
    // .ai/ is ignored by git, so the traces never reach a commit. Each keeps the name of its test folder.
    keep: async (key, paths) => {
      const folder = join(runsDir, key, 'traces');
      mkdirSync(folder, { recursive: true });
      for (const path of paths) copyFileSync(path, join(folder, `${basename(dirname(path))}-${basename(path)}`));
      return relative(projectDir, folder).replaceAll('\\', '/');
    },
    running: async (environment) => (await readRunning(deploys, mapping))[environment]?.sha ?? null,
  });
}

// Takes the worktree away with what the agent left in it. A process that still holds a file of it (Windows) leaves the
// folder behind; the next run of the same PR replaces it.
function removeWorktree({ name }) {
  const path = reviewTreePath(projectDir, name);
  const removed = git('worktree', 'remove', '--force', path);
  if (removed.status !== 0 && existsSync(path)) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (error) {
      git('worktree', 'prune');
      return { ok: false, reason: error.message };
    }
  }
  git('worktree', 'prune');
  return existsSync(path) ? { ok: false, reason: `${path} is still there` } : { ok: true };
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
