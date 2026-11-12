// ao-kit init and sync (project-scaffold spec 2.2, 2.3; plan, decision 6). git(args, cwd) and run(argv, cwd), which
// runs npm, npx or node with no shell, are given, so tests make no branch and install nothing. Both resolve
// { status, stdout, stderr }. Each returns { ok, notes }: notes say what was done, what was skipped and what is next.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { stringify } from 'yaml';
import { githubRepoOf } from '../quality/github-app.mjs';
import { OLD_PREVIEW_FILE } from '../workflow/preview.mjs';
import { draftFromOldConfig, ensureGitignore, ensurePrepare, installKit, profileOf } from './install.mjs';
import { copyProfile, projectYaml, readProfile, rosterLocalYaml } from './profile.mjs';
import { PROJECT_FILE, readProjectConfig, REQUIRED_SCRIPTS } from './project-config.mjs';

const TODO = 'TODO';
const RENDER = ['node', '.ai-orchestrator/scripts/render-agents.mjs', '--project', '.'];
// The packages of the kit copy, which its scripts import (yaml, ajv), as the workflows of CI install them. Without them
// the render fails (T16 of project-scaffold).
const KIT_PACKAGES = ['npm', 'ci', '--prefix', '.ai-orchestrator', '--no-audit', '--no-fund'];
// What may sit in a folder ao-kit init still takes for empty: a new repo of GitHub has a README, a .gitignore, a LICENSE.
const EMPTY_ENOUGH = new Set(['.git', 'README.md', 'LICENSE', '.gitignore']);
const list = (value) => (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
// The TODO values of a config, by their path.
const todoPaths = (value, path = '') => {
  if (value === TODO) return [path];
  if (Array.isArray(value)) return value.flatMap((item, i) => todoPaths(item, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => todoPaths(item, path ? `${path}.${key}` : key));
  return [];
};

// The values of a new project, from the command line, then your environment for the Apps, as the hooks read them.
function projectValues(options, env) {
  const given = (value) => (value === undefined || value === '' ? TODO : value);
  const id = (value) => (/^\d+$/.test(value ?? '') ? Number(value) : given(value));
  return {
    name: given(options.name),
    space: given(options.space),
    repo: given(options.repo),
    approvers: list(options.approvers).length > 0 ? list(options.approvers) : [TODO],
    apps: {
      dev: given(options.devApp ?? env.AO_DEV_APP),
      dev_id: id(options.devAppId ?? env.AO_DEV_APP_ID),
      review: given(options.reviewApp ?? env.AO_REVIEW_APP),
      review_id: id(options.reviewAppId ?? env.AO_REVIEW_APP_ID),
    },
    kitPeers: list(options.kitPeers),
  };
}

// The apps of a repo that has code, from the workspaces of its package.json: [{ name, app }] and the names guessed.
const GUESS = { nextjs: { script: 'dev', port: 3000, health: '/' }, nestjs: { script: 'start:dev', port: 3001, health: '/health' } };
function appsFromWorkspaces(projectDir, packageJson, repoName) {
  const globs = Array.isArray(packageJson?.workspaces) ? packageJson.workspaces : (packageJson?.workspaces?.packages ?? []);
  const paths = globs.flatMap((glob) => {
    if (!glob.endsWith('/*')) return [glob];
    const parent = glob.slice(0, -2);
    return existsSync(join(projectDir, parent)) ? readdirSync(join(projectDir, parent), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `${parent}/${e.name}`) : [];
  });
  const apps = {};
  const used = new Set();
  for (const path of paths.filter((p) => existsSync(join(projectDir, p, 'package.json')))) {
    const profile = profileOf(projectDir, path);
    const guess = GUESS[profile] ?? { script: 'dev', port: 3000, health: '/' };
    const scripts = JSON.parse(readFileSync(join(projectDir, path, 'package.json'), 'utf8')).scripts ?? {};
    let port = guess.port;
    while (used.has(port)) port += 1;
    used.add(port);
    apps[basename(path)] = {
      repo: repoName,
      path,
      profile: profile ?? TODO,
      dev: `npm run ${scripts[guess.script] ? guess.script : TODO} -w ${path}`,
      port: { env: 'PORT', default: port },
      health: guess.health,
    };
  }
  return apps;
}

// What a repo that has code still lacks to pass the gates of the kit (spec 2.3): each line says what, not how.
function missingParts(projectDir, packageJson, git) {
  const notes = [];
  const scripts = packageJson?.scripts ?? {};
  const lacking = REQUIRED_SCRIPTS.filter((script) => !scripts[script]);
  if (lacking.length > 0) notes.push(`Missing: package.json has no ${lacking.join(', ')} script, which the build-test job of CI runs; test:coverage writes coverage/lcov.info`);
  if (!readdirSync(projectDir).some((name) => /^playwright\.config\.(ts|js|mjs)$/.test(name))) notes.push('Missing: no playwright.config: add Playwright, with an E2E test for each acceptance criterion, its name starting with the code of the criterion');
  if (!existsSync(join(projectDir, '.ai-orchestrator', 'deploy.yaml'))) notes.push('Missing: no .ai-orchestrator/deploy.yaml: the deployer on the VPS needs it, with a Dockerfile for each app (docs/release-workflow.md)');
  const branches = git(['branch', '--list'], projectDir).stdout.split('\n').map((line) => line.replace(/^[*+]?\s*/, '').trim()).filter(Boolean);
  for (const branch of ['develop', 'main']) if (!branches.includes(branch)) notes.push(`Missing: no ${branch} branch: the kit works with develop and main (docs/getting-started.md)`);
  notes.push('From the next commit on, a commit header reads type(scope): subject (<KEY>); the history before stays as it is');
  return notes;
}

// The origin of the project: ao-step reads the repo from it, so /ao-* fails without it (T16). A missing one is added
// from project.yaml; one that is there is left, with a note when it is another repo.
function ensureOrigin(projectDir, repo, git) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return [];
  const url = git(['remote', 'get-url', 'origin'], projectDir);
  const current = url.status === 0 ? url.stdout.trim() : '';
  if (!current) {
    const target = `https://github.com/${repo}.git`;
    const added = git(['remote', 'add', 'origin', target], projectDir);
    return [added.status === 0 ? `Added the remote origin: ${target}` : `git remote add origin ${target} failed: ${`${added.stderr ?? ''}`.trim()}`];
  }
  let found = null;
  try {
    found = githubRepoOf(current);
  } catch {
    found = null;
  }
  return found?.toLowerCase() === repo.toLowerCase() ? [] : [`origin is ${found ?? current}, not ${repo} of project.yaml: ao-step reads the repo from origin, so set one of the two to the other`];
}

const NEXT_EMPTY = 'Next: ao-kit setup jira; add the repo to the two GitHub Apps; run lint, typecheck, test:coverage and build, commit (the first commit needs no Jira key) and push develop and main; ao-kit setup github; ao-kit doctor; then open claude in the folder, trust it, and allow its two MCP servers (docs/getting-started.md, part 3)';
const NEXT_CODE = 'Next: fix what is missing above; add the repo to the two GitHub Apps; ao-kit setup jira; open claude in the folder, trust it, allow its two MCP servers, and run /ao-intake for the Task of the kit copy; commit with its key on develop and push it; ao-kit setup github; ao-kit doctor (docs/getting-started.md, part 4)';

// ao-kit init <dir>: an empty folder gets the skeleton of the profile, then the kit; a repo that has code gets the kit
// only, and a list of what it still lacks. A project that has a project.yaml is left as it is.
export function initProject({ kitDir, projectDir, options, env = process.env, git, run }) {
  if (existsSync(join(projectDir, PROJECT_FILE))) return { ok: true, notes: [`${projectDir} has a project.yaml already: ao-kit init does nothing; ao-kit sync updates the kit`] };
  const notes = [];
  const profile = readProfile(kitDir, options.profile ?? 'next-nest');
  const empty = readdirSync(projectDir).every((name) => EMPTY_ENOUGH.has(name));
  const values = projectValues(options, env);
  const repoName = values.repo.includes('/') ? values.repo.split('/')[1] : TODO;
  let text;
  if (empty) {
    if (!existsSync(join(projectDir, '.git'))) git(['init', '--quiet', '--initial-branch=develop'], projectDir);
    const title = options.title ?? values.name;
    const written = copyProfile({ profile, projectDir, name: values.name, title });
    notes.push(`Copied the ${profile.name} skeleton: ${written.length} files`);
    text = projectYaml(profile, values);
    writeFileSync(join(projectDir, '.ai-orchestrator', 'roster.local.yaml'), rosterLocalYaml(profile));
  } else {
    const packageJson = existsSync(join(projectDir, 'package.json')) ? JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')) : null;
    const apps = appsFromWorkspaces(projectDir, packageJson, repoName);
    const config = {
      name: values.name,
      jira: { space: values.space },
      github: { repo: values.repo, approvers: values.approvers, apps: values.apps, kit_peers: values.kitPeers },
      repos: [{ name: repoName, path: '.' }],
      apps,
      roles: { optional: [] },
      claude: { allow: [] },
    };
    text = `# The config of this project (SPEC-project-scaffold.md 2.1), drafted by ao-kit init from its workspaces: check each app.\n${stringify(config)}`;
    notes.push(`The repo has code, so ao-kit init copies the kit only and changes no file of the apps. The apps of project.yaml are guessed: check the port and health of ${Object.keys(apps).join(', ') || 'each app'}`);
  }
  mkdirSync(join(projectDir, '.ai-orchestrator'), { recursive: true });
  writeFileSync(join(projectDir, PROJECT_FILE), text);
  const { removed } = installKit({ kitDir, projectDir });
  notes.push(`Copied the kit${removed.length > 0 ? `, and removed ${removed.length} files of an older copy` : ''}`);
  notes.push(...ensureGitignore(projectDir), ...ensurePrepare(projectDir), ...ensureOrigin(projectDir, values.repo, git));
  const todo = todoPaths(readProjectConfig(text).config ?? {});
  const { errors } = readProjectConfig(text);
  if (todo.length > 0 || errors.length > 0) {
    if (todo.length > 0) notes.push(`Fill in ${PROJECT_FILE}: ${todo.join(', ')}. Then run ao-kit render, and ${empty ? 'npm ci in the project' : 'ao-kit check'}`);
    for (const { rule, path, message } of errors.filter(({ path }) => !todo.includes(path))) notes.push(`${rule} ${path}: ${message}`);
    return { ok: false, notes };
  }
  const steps = [KIT_PACKAGES, RENDER, ...(empty ? profile.after : [])];
  for (const argv of steps) {
    const done = run(argv, projectDir);
    if (done.status !== 0) return { ok: false, notes: [...notes, `${argv.join(' ')} failed: ${`${done.stderr ?? ''}${done.stdout ?? ''}`.trim().slice(-500)}`] };
    notes.push(`Ran ${argv.join(' ')}`);
  }
  if (!empty) notes.push(...missingParts(projectDir, existsSync(join(projectDir, 'package.json')) ? JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')) : null, git));
  notes.push(empty ? NEXT_EMPTY : NEXT_CODE);
  return { ok: true, notes };
}

// ao-kit sync <dir> --key <KEY>: the kit of this clone into the project, on a new branch from develop for the Task of
// the copy, in one commit. A project from before project-scaffold gets its project.yaml first. Nothing is pushed.
export function syncKit({ kitDir, projectDir, options, git, run }) {
  const stop = (note) => ({ ok: false, notes: [note] });
  const { key, name } = options;
  if (!key) return stop('ao-kit sync needs --key <KEY>: the Task the copy is made for, such as SHOP-5, which its branch and commit carry');
  const file = join(projectDir, PROJECT_FILE);
  const settings = join(projectDir, '.claude', 'settings.json');
  const space = existsSync(file) ? readProjectConfig(readFileSync(file, 'utf8')).config?.jira?.space : existsSync(settings) ? JSON.parse(readFileSync(settings, 'utf8')).env?.AO_JIRA_SPACE : null;
  if (space && !key.startsWith(`${space}-`)) return stop(`${key} is not an item of ${space}, the space of this project`);
  const dirty = git(['status', '--porcelain'], projectDir).stdout.split('\n').filter(Boolean);
  if (dirty.length > 0) return stop(`The project has changes not committed (${dirty.length} files): commit or put them aside first`);
  const notes = [];
  // A project from before project-scaffold: its project.yaml from what it had, or nothing happens.
  let draft = null;
  if (!existsSync(file)) {
    const url = git(['remote', 'get-url', 'origin'], projectDir).stdout.trim();
    let repo = null;
    try {
      repo = githubRepoOf(url);
    } catch {
      repo = null;
    }
    draft = draftFromOldConfig({ projectDir, name, repo });
    if (draft.todo.length > 0) {
      const onlyName = draft.todo.length === 1 && draft.todo[0] === 'name';
      return stop(`project.yaml needs values the old files do not have: ${draft.todo.join(', ')}. ${onlyName ? 'Run again with --name <the name of the project on the VPS>' : `Write ${PROJECT_FILE} as SPEC-project-scaffold.md 2.1 shows, then run ao-kit sync again`}`);
    }
  }
  const branch = `feature/${key}-kit-copy`;
  for (const args of [['fetch', '--quiet', 'origin'], ['switch', '--quiet', '--no-track', '-c', branch, 'origin/develop']]) {
    const done = git(args, projectDir);
    if (done.status !== 0) return stop(`git ${args.join(' ')} failed: ${done.stderr.trim()}`);
  }
  if (draft) {
    writeFileSync(file, draft.text);
    rmSync(join(projectDir, OLD_PREVIEW_FILE), { force: true });
    notes.push(`Wrote ${PROJECT_FILE} from .claude/settings.json, ${OLD_PREVIEW_FILE} and deploy.yaml, and removed preview.yaml`);
  }
  const { removed } = installKit({ kitDir, projectDir });
  notes.push(`Copied the kit${removed.length > 0 ? `; removed ${removed.length} files the kit no longer has: ${removed.join(', ')}` : ''}`);
  notes.push(...ensureGitignore(projectDir), ...ensurePrepare(projectDir));
  const installed = run(KIT_PACKAGES, projectDir);
  if (installed.status !== 0) return { ok: false, notes: [...notes, `${KIT_PACKAGES.join(' ')} failed: ${`${installed.stderr ?? ''}${installed.stdout ?? ''}`.trim().slice(-500)}. Fix it on ${branch}, then commit`] };
  const rendered = run(RENDER, projectDir);
  if (rendered.status !== 0) return { ok: false, notes: [...notes, `${RENDER.join(' ')} failed: ${`${rendered.stderr ?? ''}${rendered.stdout ?? ''}`.trim().slice(-500)}. Fix it on ${branch}, then commit`] };
  const sha = git(['-C', kitDir, 'rev-parse', 'HEAD'], kitDir).stdout.trim().slice(0, 8);
  for (const args of [['add', '--all'], ['commit', '--quiet', '-m', `chore(kit): copy the kit at ${sha} (${key})`]]) {
    const done = git(args, projectDir);
    if (done.status !== 0) return { ok: false, notes: [...notes, `git ${args.join(' ')} failed: ${`${done.stderr ?? ''}${done.stdout ?? ''}`.trim()}`] };
  }
  notes.push(`Push ${branch} and open its PR into develop. It changes protected paths, so you merge it once its review passes (docs/getting-started.md)`);
  return { ok: true, notes };
}
