// The copy of the kit in a project (project-scaffold spec 2.2; plan, decisions 4 and 5): what ao-kit init and sync
// write, on the file system. The kit files are those kit_copy of quality/gates.yaml names, which kit-copy-review
// compares; each kit folder is copied afresh, so a file the kit dropped goes too, and every file of the project stays.
// The rendered files (agents, rules, settings.json) are not copied: render-agents.mjs writes them from project.yaml.
// Replaces misc/scaffold-input/kit-copy.mjs, the script the kit copies of Pilot 1 and 2 were made with.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { stringify } from 'yaml';
import { readDeployConfig } from '../release/deploy-config.mjs';
import { OLD_PREVIEW_FILE, readPreviewConfig } from '../workflow/preview.mjs';

// The scripts a project runs from .ai-orchestrator/scripts/: the hooks, the CI jobs, ao-step and its helpers.
export const PROJECT_SCRIPTS = [
  'ao-agent.mjs', 'ao-git-credential.mjs', 'ao-pr.mjs', 'ao-step.mjs', 'audit.mjs', 'check-design.mjs', 'check-policy.mjs', 'commit-msg.mjs',
  'coverage-diff.mjs', 'install-hooks.mjs', 'jira-sync.mjs', 'merge-gate.mjs', 'pre-commit.mjs', 'pre-push.mjs', 'render-agents.mjs',
];
// The scripts that run from the kit only: setting a project up, the deployer on the VPS, the kit's own checks.
export const KIT_ONLY_SCRIPTS = [
  'ao-deploy.mjs', 'ao-kit.mjs', 'gh-protect.mjs', 'github-app-create.mjs', 'jira-check.mjs', 'jira-checklist.mjs', 'profiles-check.mjs', 'render-docs.mjs',
  'validate-contract.mjs',
  'vendor-skills.mjs',
];
// .ai-orchestrator/ of the project, from the kit.
const KIT_DIRS = ['agents', 'contract', 'lib', 'quality', 'templates', 'tracker'];
const KIT_FILES = ['package.json', 'package-lock.json'];
// The root of the project, from kit/. audit.yml is left out: a project deploys through the deployer, which runs audit.
const ROOT_DIRS = ['.claude/hooks', '.githooks'];
const ROOT_FILES = ['.mcp.json', '.jira/config.yml', '.github/workflows/ci.yml', '.github/workflows/jira-sync.yml', '.github/workflows/merge-gate.yml'];

// The files under a folder, relative to `base`, with forward slashes; [] when there is none.
const listed = (base, dir) => (existsSync(join(base, dir))
  ? readdirSync(join(base, dir), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(base, join(e.parentPath ?? e.path, e.name)).replaceAll('\\', '/'))
  : []);

// Copies the kit at kitDir into the project. Returns { removed }: the files of an older copy the kit no longer has.
export function installKit({ kitDir, projectDir }) {
  const removed = [];
  // A folder of the kit replaces the one of the project: what is in the old one only goes.
  const fresh = (from, to) => {
    const before = listed(projectDir, to);
    const after = new Set(listed(from, '.').map((path) => `${to}/${path}`));
    removed.push(...before.filter((path) => !after.has(path)));
    rmSync(join(projectDir, to), { recursive: true, force: true });
    cpSync(from, join(projectDir, to), { recursive: true });
  };
  const ao = '.ai-orchestrator';
  for (const dir of KIT_DIRS) fresh(join(kitDir, dir), `${ao}/${dir}`);
  for (const file of KIT_FILES) cpSync(join(kitDir, file), join(projectDir, ao, file));
  mkdirSync(join(projectDir, ao, 'docs'), { recursive: true });
  cpSync(join(kitDir, 'docs', 'sdlc.md'), join(projectDir, ao, 'docs', 'sdlc.md'));
  const scripts = `${ao}/scripts`;
  removed.push(...listed(projectDir, scripts).filter((path) => !PROJECT_SCRIPTS.includes(basename(path))));
  rmSync(join(projectDir, scripts), { recursive: true, force: true });
  mkdirSync(join(projectDir, scripts), { recursive: true });
  for (const script of PROJECT_SCRIPTS) cpSync(join(kitDir, 'scripts', script), join(projectDir, scripts, script));
  for (const dir of ROOT_DIRS) fresh(join(kitDir, 'kit', dir), dir);
  // Each skill of the kit is replaced; a skill of the project's stack, which the kit has not, stays.
  const skills = join(kitDir, 'kit', '.claude', 'skills');
  for (const name of readdirSync(skills)) fresh(join(skills, name), `.claude/skills/${name}`);
  for (const file of ROOT_FILES) {
    mkdirSync(join(projectDir, file, '..'), { recursive: true });
    cpSync(join(kitDir, 'kit', file), join(projectDir, file));
  }
  return { removed };
}

// Each kit file a copy holds: [path in the kit, path in the project].
function kitFiles(kitDir) {
  const ao = '.ai-orchestrator';
  return [
    ...KIT_DIRS.flatMap((dir) => listed(kitDir, dir).map((path) => [path, `${ao}/${path}`])),
    ...KIT_FILES.map((file) => [file, `${ao}/${file}`]),
    ['docs/sdlc.md', `${ao}/docs/sdlc.md`],
    ...PROJECT_SCRIPTS.map((script) => [`scripts/${script}`, `${ao}/scripts/${script}`]),
    ...[...ROOT_DIRS, '.claude/skills'].flatMap((dir) => listed(join(kitDir, 'kit'), dir).map((path) => [`kit/${path}`, path])),
    ...ROOT_FILES.map((file) => [`kit/${file}`, file]),
  ];
}

// The kit files of the project that are not those of the kit at kitDir, missing ones included (ao-kit doctor). A
// checkout on Windows writes CRLF, so line ends do not count.
export function kitDrift({ kitDir, projectDir }) {
  const text = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  return kitFiles(kitDir).filter(([from, to]) => !existsSync(join(projectDir, to)) || text(join(kitDir, from)) !== text(join(projectDir, to))).map(([, to]) => to);
}

// The lines .gitignore needs: the packages of the kit, your local settings, what agents write, playwright-cli snapshots.
const IGNORED = ['.ai-orchestrator/node_modules/', '.claude/settings.local.json', '.ai/', '.playwright-cli/'];

// The lines of IGNORED that .gitignore lacks (ao-kit doctor).
export function gitignoreMissing(projectDir) {
  const file = join(projectDir, '.gitignore');
  const have = new Set((existsSync(file) ? readFileSync(file, 'utf8') : '').split(/\r?\n/).map((line) => line.trim()));
  return IGNORED.filter((line) => !have.has(line));
}

// Adds the lines .gitignore lacks, at its end. Returns notes.
export function ensureGitignore(projectDir) {
  const file = join(projectDir, '.gitignore');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const have = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  const missing = IGNORED.filter((line) => !have.has(line));
  if (missing.length === 0) return [];
  writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${missing.map((line) => `${line}\n`).join('')}`);
  return [`Added to .gitignore: ${missing.join(', ')}`];
}

const PREPARE = 'node .ai-orchestrator/scripts/install-hooks.mjs';

// Sets the prepare script, so npm install installs the git hooks of the kit; a prepare of the project's own is named,
// not changed. Returns notes.
export function ensurePrepare(projectDir) {
  const file = join(projectDir, 'package.json');
  if (!existsSync(file)) return ['The project has no package.json: add one with the four scripts of CI and a prepare script that runs ' + PREPARE];
  const text = readFileSync(file, 'utf8');
  const pkg = JSON.parse(text);
  const current = pkg.scripts?.prepare;
  if (current?.includes('install-hooks.mjs')) return [];
  if (current) return [`package.json has its own prepare script (${current}): add ${PREPARE} to it, so npm install installs the git hooks of the kit`];
  pkg.scripts = { ...pkg.scripts, prepare: PREPARE };
  const indent = text.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? '  ';
  writeFileSync(file, `${JSON.stringify(pkg, null, indent)}\n`);
  return [`Added the prepare script of package.json: ${PREPARE}`];
}

const TODO = 'TODO';
// The stack of an app from its own package.json.
const PROFILES = [['next', 'nextjs'], ['@nestjs/core', 'nestjs']];
export function profileOf(projectDir, path) {
  const file = join(projectDir, path, 'package.json');
  if (!existsSync(file)) return null;
  const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(file, 'utf8'));
  return PROFILES.find(([dependency]) => dependency in dependencies || dependency in devDependencies)?.[1] ?? null;
}
// The workspace a dev command runs in: npm run dev -w apps/web.
const workspaceOf = (command) => command.match(/(?:^|\s)(?:-w|--workspace)(?:\s+|=)(\S+)/)?.[1] ?? null;
const asId = (value) => (/^\d+$/.test(value ?? '') ? Number(value) : value);

// project.yaml for a project from before project-scaffold, from what it had (plan, decision 4): the env of its
// .claude/settings.json, the apps of its preview.yaml, and which app is public in its deploy.yaml. name: the project on
// the VPS; repo: owner/name on GitHub, from the git remote. Returns { text, todo }: todo names each value it could not
// find, written as TODO for you to fill.
export function draftFromOldConfig({ projectDir, name, repo }) {
  const todo = [];
  const known = (value, path) => {
    if (value === undefined || value === null || value === '') {
      todo.push(path);
      return TODO;
    }
    return value;
  };
  const read = (path) => (existsSync(join(projectDir, path)) ? readFileSync(join(projectDir, path), 'utf8') : null);
  const env = JSON.parse(read('.claude/settings.json') ?? '{}').env ?? {};
  const deploy = read('.ai-orchestrator/deploy.yaml');
  const deployed = deploy ? (readDeployConfig(deploy).config?.apps ?? {}) : {};
  const preview = read(OLD_PREVIEW_FILE);
  const repoName = repo ? repo.split('/')[1] : null;
  const config = {
    name: known(name, 'name'),
    jira: { space: known(env.AO_JIRA_SPACE, 'jira.space') },
    github: {
      repo: known(repo, 'github.repo'),
      approvers: known(env.AO_APPROVERS, 'github.approvers') === TODO ? [TODO] : env.AO_APPROVERS.split(',').map((login) => login.trim()).filter(Boolean),
      apps: {
        dev: known(env.AO_DEV_APP, 'github.apps.dev'),
        dev_id: asId(known(env.AO_DEV_APP_ID, 'github.apps.dev_id')),
        review: known(env.AO_REVIEW_APP, 'github.apps.review'),
        review_id: asId(known(env.AO_REVIEW_APP_ID, 'github.apps.review_id')),
      },
      kit_peers: (env.AO_KIT_PEERS ?? '').split(',').map((peer) => peer.trim()).filter(Boolean),
    },
    repos: [{ name: known(repoName, 'repos[0].name'), path: '.' }],
    apps: {},
    roles: { optional: [] },
    claude: { allow: [] },
  };
  for (const app of preview ? readPreviewConfig(preview) : []) {
    const where = `apps.${app.name}`;
    const path = known(workspaceOf(app.command), `${where}.path`);
    const url = new URL(app.url);
    const own = Object.fromEntries(Object.entries(app.env).filter(([variable]) => variable !== 'PORT'));
    config.apps[app.name] = {
      repo: known(repoName, `${where}.repo`),
      path,
      profile: known(path === TODO ? null : profileOf(projectDir, path), `${where}.profile`),
      dev: app.command,
      port: { env: 'PORT', default: app.port },
      health: url.pathname,
      ...(deployed[app.name]?.public && { public: true }),
      ...(Object.keys(own).length > 0 && { env: own }),
    };
  }
  if (!preview) todo.push('apps');
  const header = `# The config of this project (SPEC-project-scaffold.md 2.1), written by ao-kit from .claude/settings.json, ${OLD_PREVIEW_FILE}\n# and deploy.yaml.${todo.length > 0 ? ` Fill in each TODO: ${todo.join(', ')}.` : ''}\n`;
  return { text: `${header}${stringify(config)}`, todo };
}
