// The part of /ao-preview that acts on this machine (human-loop spec 4.3): what it reads before deciding, starting the
// apps of project.yaml on the PR branch, and stopping them. Moved out of scripts/ao-step.mjs with every effect as a
// parameter, so its paths are tested without git, npm or processes (live-run-fixes spec 2.6).
import { connect } from 'node:net';
import { join } from 'node:path';
import { PROJECT_FILE, readProjectConfig } from '../scaffold/project-config.mjs';
import { lockHash, namePaths, needsInstall, previewApps, previewEnv, steeringReason, steersPreview } from './preview.mjs';

// The apps of project.yaml as /ao-preview starts them, or the problems of the file on one line (project-scaffold spec
// 2.1). { apps: null, problem: null } when the project has no project.yaml.
function readApps(fs, projectDir) {
  const file = join(projectDir, PROJECT_FILE);
  if (!fs.existsSync(file)) return { apps: null, problem: null };
  const { config, errors } = readProjectConfig(fs.readFileSync(file, 'utf8'));
  if (errors.length > 0) return { apps: null, problem: errors.map(({ rule, path, message }) => `${rule} ${path}: ${message}`).join('; ') };
  return { apps: previewApps(config), problem: null };
}

// The files of a preview: the apps that run (active.json), and the lockfile installed last (state.json).
export function previewPaths(projectDir) {
  const dir = join(projectDir, '.ai', 'preview');
  return { dir, active: join(dir, 'active.json'), state: join(dir, 'state.json') };
}

// Whether something answers on the port, on IPv4 or IPv6.
export async function portBusy(port) {
  const tryHost = (host) => new Promise((done) => {
    const socket = connect({ host, port });
    const end = (busy) => {
      socket.destroy();
      done(busy);
    };
    socket.setTimeout(1000, () => end(false));
    socket.once('connect', () => end(true));
    socket.once('error', () => end(false));
  });
  return (await tryHost('127.0.0.1')) || (await tryHost('::1'));
}

// Whether the URL answers 2xx or 3xx within `ms`.
export async function answers(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
      if (res.status < 400) return true;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 2000));
  }
  return false;
}

// The effects, given by ao-step:
//   projectDir
//   git(...args)              git in the project folder: { status, stdout, stderr }
//   checkout({ branch, from, pull })   puts the folder on a branch, as before a run: { ok, reason }
//   npm(args, options)        runNpm of lib/quality/npm.mjs: { status, stderr, error }
//   spawn(file, args, options) starts one app apart from ao-step: { pid, unref() }
//   fs                        { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync }
//   portBusy(port), answers(url, ms), killTree(pid), sleep(ms)
//   env, execPath, npmCli()   the environment and the node of ao-step, and the path of npm-cli.js or null
//   cleared                   the variables an agent run clears (CLEARED_ENV of lib/agents/launch.mjs)
//   agentRunning()            the live holder of the lock of the runs, other than this process, or null
//   now()
export function previewRunner({ projectDir, git, checkout, npm, spawn, fs, portBusy: busy, answers: answering, killTree, sleep, env, execPath, npmCli, cleared = [], agentRunning, now = Date.now }) {
  const paths = previewPaths(projectDir);
  const readJson = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };
  const at = () => new Date(now()).toISOString();
  const readLock = () => {
    const file = join(projectDir, 'package-lock.json');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  };
  const install = () => npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: projectDir, env: previewEnv(env, cleared), encoding: 'utf8' });
  const installed = (lock) => fs.writeFileSync(paths.state, `${JSON.stringify({ lock: lockHash(lock), at: at() }, null, 2)}\n`);

  // What /ao-preview reads on this machine. `install` is a forecast from the head of the PR when git has it already;
  // start decides again once the folder is on the branch.
  async function facts(stopping, pr) {
    const { apps: config, problem: configError } = readApps(fs, projectDir);
    const dirty = git('status', '--porcelain', '--untracked-files=no').stdout.trim().split('\n').filter(Boolean).length;
    const taken = [];
    for (const { port } of config ?? []) if (await busy(port)) taken.push(port);
    const lock = pr?.headSha ? git('show', `${pr.headSha}:package-lock.json`) : null;
    return {
      stop: stopping,
      config,
      configError,
      active: readJson(paths.active),
      agentRunning: agentRunning(),
      dirty,
      busy: taken,
      install: lock?.status === 0 ? needsInstall(lock.stdout, readJson(paths.state)) : true,
    };
  }

  // /ao-preview <KEY> --go: the folder on the PR branch, the packages of its lockfile, then each app of project.yaml in
  // order, apart from ao-step, with its log in .ai/preview/ and no secret in its environment. The record of the preview
  // is written as soon as the folder is on the branch, and whatever fails from there goes through stop: the apps stop,
  // the folder goes back to develop with its packages, and the record stays while it cannot (live-run-fixes spec 2.6).
  async function start({ key, number, branch, head: checked, protected: globs = [] }) {
    const { apps: config, problem } = readApps(fs, projectDir);
    if (!config) throw new Error(problem ?? `the project has no ${PROJECT_FILE}`);
    steeringCheck({ key, number, branch, checked, globs });
    // What steers a session and git does not track, before the apps of the PR run: stop names what appears after.
    const untracked = untrackedSteering(globs);
    const moved = checkout({ branch, pull: true });
    // A switch that failed before the folder moved, such as git fetch, leaves nothing to undo.
    if (!moved.ok && git('branch', '--show-current').stdout.trim() !== branch) throw new Error(moved.reason);
    const head = git('rev-parse', 'HEAD').stdout.trim();
    const apps = [];
    fs.mkdirSync(paths.dir, { recursive: true });
    const record = () => fs.writeFileSync(paths.active, `${JSON.stringify({ key, pr: number, branch, head, apps, untracked, protected: globs, startedAt: at() }, null, 2)}\n`);
    record();
    try {
      // The switch may have failed after the folder moved, such as at the fast-forward.
      if (!moved.ok) throw new Error(moved.reason);
      // The head decidePreview checked for protected paths and instruction files, or nothing runs (review of PR #21).
      if (checked && head !== checked) throw new Error(`${branch} is at ${head.slice(0, 8)}, not ${checked.slice(0, 8)}, the head that was checked: a push came in between. Run /ao-preview ${key} again`);
      // No secret of your session reaches code nobody reviewed (review of ao-sample PR #21).
      const appEnv = previewEnv(env, cleared);
      const notes = [`The project folder is on ${branch} at ${head.slice(0, 8)}.`];
      const lock = readLock();
      if (needsInstall(lock, readJson(paths.state))) {
        // Until npm ci ends well, the packages are those of no lockfile: stop then installs those of develop again.
        fs.rmSync(paths.state, { force: true });
        const done = install();
        if (done.status !== 0) throw new Error(`npm ci failed: ${(done.stderr || done.error?.message || '').trim().slice(-500)}`);
        installed(lock);
        notes.push('Ran npm ci --ignore-scripts, since package-lock.json differs from the one installed before.');
      }
      for (const app of config) {
        const log = fs.openSync(join(paths.dir, `${app.name}.log`), 'w');
        // npm or node and its words, with no shell: npm through npm-cli.js next to node, as runNpm does.
        const [tool, ...words] = app.argv;
        const cli = tool === 'npm' ? npmCli() : null;
        const [file, args] = tool === 'node' ? [execPath, words] : cli ? [execPath, [cli, ...words]] : ['npm', words];
        const child = spawn(file, args, { cwd: projectDir, env: { ...appEnv, ...app.env }, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
        child.unref();
        apps.push({ name: app.name, url: app.url, port: app.port, pid: child.pid });
        record();
        if (!(await answering(app.url, 120000))) throw new Error(`${app.name} did not answer at ${app.url} within 2 minutes: read .ai/preview/${app.name}.log`);
      }
      notes.push(...apps.map(({ name, url }) => `${name}: ${url}`), `Stop it with /ao-preview ${key} --stop: the apps stop and the folder goes back to develop. /ao-fix and /ao-review stop it too.`);
      return notes;
    } catch (error) {
      const stopped = await stop();
      throw new Error(`${error.message}. ${stopped.notes.join(' ')}`);
    }
  }

  // Before the switch, so a refusal leaves nothing to undo (live-run-fixes spec 2.7): the branch on origin is at the head
  // decidePreview checked, and no file it brings steers a session. decidePreview read the files GitHub lists, at most
  // 3000; git lists them all. Its own changes count from where it left develop; from the tip of develop, git also finds
  // a branch cut from an older develop, whose older kit and instructions would load during the preview.
  function steeringCheck({ key, number, branch, checked, globs }) {
    const fetched = git('fetch', '--quiet', 'origin');
    if (fetched.status !== 0) throw new Error(`git fetch failed: ${fetched.stderr.trim()}`);
    const remote = git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`).stdout.trim();
    if (checked && remote !== checked) throw new Error(`${branch} is at ${remote.slice(0, 8) || 'nothing'} on origin, not ${checked.slice(0, 8)}, the head that was checked: a push came in between. Run /ao-preview ${key} again`);
    const head = checked ?? remote;
    // -z: one name after another with no quoting, whatever characters a name has.
    const changed = (...range) => {
      const diff = git('diff', '--name-only', '--no-renames', '-z', ...range);
      if (diff.status !== 0) throw new Error(`git diff ${range.join(' ')} failed: ${diff.stderr.trim()}`);
      return diff.stdout.split('\0').filter(Boolean).filter((path) => steersPreview(path, globs));
    };
    const own = changed(`origin/develop...${head}`);
    if (own.length > 0) throw new Error(steeringReason(number, own));
    const older = changed('origin/develop', head);
    if (older.length > 0) throw new Error(`${branch} was cut from an older develop: ${namePaths(older)} differ from develop there, and those older files would steer the agents during the preview. Merge develop into ${branch} and push, then run /ao-preview ${key} again`);
  }

  // The files that steer a session and git does not track, ignored ones included, such as CLAUDE.local.md or
  // .claude/settings.local.json: the apps of a PR run as you in the project folder and may write them (Low of security
  // on ao-sample PR #21; live-run-fixes spec 2.8). A folder ignored as a whole, such as node_modules/, is one entry.
  function untrackedSteering(globs) {
    const listed = git('status', '--porcelain=v1', '-z', '--ignored=matching', '--untracked-files=all');
    if (listed.status !== 0) return [];
    return listed.stdout.split('\0').filter((entry) => /^(\?\?|!!) /.test(entry)).map((entry) => entry.slice(3)).filter((path) => steersPreview(path, globs));
  }

  // Stops each app with its whole tree (lib/workflow/agent-process.mjs), then says which port still answers.
  async function stopApps(apps) {
    for (const { pid } of apps) killTree(pid);
    await sleep(3000);
    const still = [];
    for (const { name, port } of apps) if (await busy(port)) still.push(`${name} (port ${port})`);
    return still;
  }

  // /ao-preview <KEY> --stop, and the first step of a command that runs agents during a preview. The record of the
  // preview goes only once the folder is back on develop: otherwise it stays, with no app, so no command runs from the PR
  // branch (review of ao-sample PR #21). Back on develop, the packages of develop are installed again when the preview
  // installed those of the PR. Resolves { home, notes }.
  async function stop() {
    const active = readJson(paths.active);
    if (!active) return { home: true, notes: ['No preview runs.'] };
    const still = await stopApps(active.apps ?? []);
    const notes = [`Stopped the preview of ${active.key}: ${(active.apps ?? []).map(({ name }) => name).join(', ') || 'no app ran'}.${still.length > 0 ? ` Still answering: ${still.join(', ')}; stop it yourself.` : ''}`];
    // Named, never deleted: you may have made one yourself during the preview. A record from before this check has no list.
    if (Array.isArray(active.untracked)) {
      const appeared = untrackedSteering(active.protected ?? []).filter((path) => !active.untracked.includes(path));
      if (appeared.length > 0) notes.push(`Files that steer a session appeared in the project folder during the preview, and git does not track them: ${appeared.join(', ')}. The apps of the PR may have written them, and /ao-preview --stop does not delete them: read each one, and delete those you did not make.`);
    }
    const home = checkout({ branch: 'develop', pull: true });
    if (!home.ok) {
      fs.writeFileSync(paths.active, `${JSON.stringify({ ...active, apps: [], stoppedAt: at() }, null, 2)}\n`);
      return { home: false, notes: [...notes, `The project folder stays on ${active.branch}: ${home.reason}`] };
    }
    fs.rmSync(paths.active, { force: true });
    notes.push('The project folder is back on develop.');
    const lock = readLock();
    if (needsInstall(lock, readJson(paths.state))) {
      const done = install();
      if (done.status === 0) {
        installed(lock);
        notes.push('Ran npm ci --ignore-scripts again, for the packages of develop.');
      } else notes.push(`npm ci for develop failed: ${(done.stderr || done.error?.message || '').trim().slice(-300)}. Run npm ci yourself before a test or a build.`);
    }
    return { home: true, notes };
  }

  return { paths, facts, start, stop };
}
