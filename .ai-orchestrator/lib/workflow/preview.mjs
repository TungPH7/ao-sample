// The pure part of /ao-preview (human-loop spec 4.3): the apps to start and where they answer, from the project's
// .ai-orchestrator/project.yaml (project-scaffold spec 2.1), whether the packages must be installed again, and what
// keeps a PR from a preview. ao-step starts and stops the processes (preview-run.mjs).
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { matchesGlob } from '../quality/glob.mjs';
import { isSteeringPath } from './review-tree.mjs';

// What /ao-preview prints when the project has no project.yaml: the apps part of that file, for ao-sample.
export const PREVIEW_SAMPLE = `# The apps of .ai-orchestrator/project.yaml (SPEC-project-scaffold.md 2.1), which /ao-preview starts in order.
apps:
  api:
    repo: shop
    path: apps/api
    profile: nestjs
    dev: npm run start:dev -w apps/api
    port: { env: PORT, default: 3001 }
    health: /health
  web:
    repo: shop
    path: apps/web
    profile: nextjs
    dev: npm run dev -w apps/web
    port: { env: PORT, default: 3000 }
    health: /
    public: true
    env: { API_URL: "http://localhost:3001" }`;

// The apps of project.yaml, read and valid, in order: [{ name, command, argv, url, port, env }]. The URL is the health
// path on this machine, at the default port, which the app gets in its port variable: so two worktrees can run the
// same app on two ports later (C2).
export function previewApps(config) {
  return Object.entries(config.apps).map(([name, app]) => ({
    name,
    command: app.dev,
    argv: app.dev.trim().split(/\s+/),
    url: `http://localhost:${app.port.default}${app.health}`,
    port: app.port.default,
    env: { ...(app.env ?? {}), [app.port.env]: String(app.port.default) },
  }));
}

// The file a project had before project-scaffold. ao-kit sync turns it into the apps of project.yaml, then removes it.
export const OLD_PREVIEW_FILE = '.ai-orchestrator/preview.yaml';

const NAME = /^[a-z][a-z0-9-]*$/;
const LOCAL = new Set(['localhost', '127.0.0.1']);
// A command runs with no shell (Semgrep's spawn-shell-true, found by the sast job of ao-sample PR #21): npm or node, then
// words split on spaces. Quotes, pipes, redirections and variables would need a shell, so they are refused.
const TOOLS = ['npm', 'node'];
const SHELL_CHARS = /["'`$|&;<>(){}*?\\]/;

// Why a command cannot start an app with no shell, or null: one line, npm or node, then plain words. project.yaml uses
// it for the dev command of each app (project-scaffold spec 2.1).
export function commandProblem(command) {
  if (typeof command !== 'string' || command.trim() === '' || /[\r\n]/.test(command)) return 'one line, the command that starts the app';
  const [tool] = command.trim().split(/\s+/);
  if (!TOOLS.includes(tool) || SHELL_CHARS.test(command)) return 'npm or node and plain words, run with no shell, such as npm run dev -w apps/web';
  return null;
}

// The apps of the preview.yaml a project had before project-scaffold, in order: [{ name, command, argv, url, port, env }].
// ao-kit sync reads it once, to write the apps of project.yaml. Throws with every problem when the file is wrong.
export function readPreviewConfig(text) {
  let data;
  try {
    data = parse(text);
  } catch (error) {
    throw new Error(`${OLD_PREVIEW_FILE} is not YAML: ${error.message.split('\n')[0]}`);
  }
  const problems = [];
  const apps = Object.entries(data?.apps ?? {});
  if (apps.length === 0) problems.push('it lists no app under apps');
  const read = apps.map(([name, app]) => {
    const where = `apps.${name}`;
    if (!NAME.test(name)) problems.push(`${where}: a name is lower-case letters, digits and hyphens`);
    const argv = typeof app?.command === 'string' ? app.command.trim().split(/\s+/) : [];
    const wrong = commandProblem(app?.command);
    if (wrong) problems.push(`${where}.command: ${wrong}`);
    let url = null;
    try {
      url = new URL(app?.url);
    } catch {
      problems.push(`${where}.url: the URL where the app answers when it is up, such as http://localhost:3000/`);
    }
    if (url && (!['http:', 'https:'].includes(url.protocol) || !LOCAL.has(url.hostname) || !url.port)) problems.push(`${where}.url: http://localhost with a port, not ${app.url}`);
    const env = app?.env ?? {};
    if (typeof env !== 'object' || Array.isArray(env) || Object.values(env).some((value) => typeof value !== 'string')) problems.push(`${where}.env: names and text values`);
    return { name, command: app?.command, argv, url: app?.url, port: url ? Number(url.port) : null, env };
  });
  if (problems.length > 0) throw new Error(`${OLD_PREVIEW_FILE}: ${problems.join('; ')}`);
  return read;
}

// The environment of the apps of a preview, which run code nobody reviewed (review of ao-sample PR #21): without the
// variables an agent run clears (`cleared`, lib/agents/launch.mjs), and without any whose name says it holds a secret,
// such as ATLASSIAN_AGENT_TOKEN, GH_TOKEN, AO_DEV_APP_KEY_FILE or a password.
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|_KEY$|_KEY_FILE$|^ATLASSIAN_|^AO_ENV_AUTH$/i;
export function previewEnv(env, cleared = []) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !cleared.includes(name) && !SECRET_NAME.test(name)));
}

// The hash of a package-lock.json, to know whether the packages installed are those of the head.
export const lockHash = (text) => createHash('sha256').update(text ?? '').digest('hex');

// Whether npm ci must run: the lockfile of the head differs from the one installed last, or none is on record.
export const needsInstall = (lockText, state) => !state?.lock || state.lock !== lockHash(lockText);

// Whether a path of a PR keeps it from a preview: it steers a session in the project folder (review-tree.mjs), or it
// is under a protected path (`globs`, from quality/gates.yaml) in any case, since Windows writes .Claude/ into .claude/
// (review of ao-sample PR #21; live-run-fixes spec 2.7).
export const steersPreview = (path, globs = []) => isSteeringPath(path) || globs.some((glob) => matchesGlob(glob, path, { ignoreCase: true }));

// Up to 8 paths by name, then how many more: a branch from before a kit copy differs in 54 such files (T11 of
// live-run-fixes).
const MAX_NAMED = 8;
export const namePaths = (paths) => (paths.length <= MAX_NAMED ? paths.join(', ') : `${paths.slice(0, MAX_NAMED).join(', ')} and ${paths.length - MAX_NAMED} more`);

// Why a preview does not run a PR that changes such paths.
export const steeringReason = (number, paths) =>
  `PR #${number} changes ${namePaths(paths)}, which steer the kit and the agents: during a preview every /ao-* command, and your own session, would load them. Read those changes in the diff instead`;
