// Starts an agent as the main session (agent-roster spec 2.5): claude --agent <role> with the effort of the roster, its
// preloaded skills in a file appended to the system prompt, and with -p its turn limit. Run it from the project root.
// The skills file is rewritten in .ai/agents/<role>.skills.md on every run. CLAUDE_CODE_EFFORT_LEVEL still beats the
// effort, to raise it for one run.
// The session works on GitHub as the Apps, never with your gh or git login (dev-workflow spec 2.3): GH_TOKEN is a
// read-only token of ao-review for the origin repository, and git gets its token from ao-git-credential.mjs and
// commits as the ao-dev bot. Without the Apps the agent does not start.
// Usage: node .ai-orchestrator/scripts/ao-agent.mjs <role> [--ao-dry-run] [claude arguments, such as -p "<prompt>"]
// --ao-dry-run writes the skills file and prints the command and the variables instead of running it, never the token.
// The kit is in AO_KIT_DIR when set.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { READ_PERMISSIONS, credentialHelper, launchPlan } from '../lib/agents/launch.mjs';
import { mergeLocal, readRoster } from '../lib/agents/roster.mjs';
import { projectSettings, setting } from '../lib/project-settings.mjs';
import { appCredentials, botIdentity, githubRepoOf, installationToken } from '../lib/quality/github-app.mjs';

const [role, ...rest] = process.argv.slice(2);
if (!role || role.startsWith('-')) {
  console.error('Usage: node .ai-orchestrator/scripts/ao-agent.mjs <role> [--ao-dry-run] [claude arguments, such as -p "<prompt>"]');
  process.exit(2);
}
const dryRun = rest.includes('--ao-dry-run');
const args = rest.filter((arg) => arg !== '--ao-dry-run');
const kitDir = resolve(process.env.AO_KIT_DIR ?? fileURLToPath(new URL('..', import.meta.url)));
const projectDir = process.cwd();
const skillDir = (name) => join(projectDir, '.claude', 'skills', name);
// The settings of the Apps live in the project's .claude/settings.json, which only Claude Code reads: the session and
// the credential helper get them from here.
const APP_SETTINGS = ['AO_DEV_APP', 'AO_DEV_APP_ID', 'AO_REVIEW_APP', 'AO_REVIEW_APP_ID'];

// The identity of the session, bought from GitHub: the repository of origin, the read-only token and the bot.
async function resolveIdentity(appEnv) {
  const env = { ...process.env, ...appEnv };
  const url = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  const repo = githubRepoOf(url);
  const { token, expiresAt } = await installationToken({ ...appCredentials('review', { env }), repo, permissions: READ_PERMISSIONS });
  if (!env.AO_DEV_APP) throw new Error('AO_DEV_APP is not set');
  const bot = await botIdentity({ slug: env.AO_DEV_APP, token });
  return { identity: { repo, readToken: token, helper: credentialHelper(kitDir), bot }, expiresAt };
}

let plan;
let shown;
try {
  const localFile = join(kitDir, 'roster.local.yaml');
  const local = existsSync(localFile) ? parse(readFileSync(localFile, 'utf8')) : undefined;
  const { roster, errors } = mergeLocal(readRoster(join(kitDir, 'agents')), local, { skillExists: (name) => existsSync(join(skillDir(name), 'SKILL.md')) });
  if (errors.length > 0) throw new Error(errors.join('\n'));
  const names = roster.roles[role]?.skills ?? [];
  const skills = new Map(names.filter((name) => existsSync(join(skillDir(name), 'SKILL.md'))).map((name) => [name, { dir: skillDir(name), text: readFileSync(join(skillDir(name), 'SKILL.md'), 'utf8') }]));
  const settings = projectSettings(projectDir);
  const appEnv = Object.fromEntries(APP_SETTINGS.map((name) => [name, setting(name, settings)]).filter(([, value]) => value));
  let resolved;
  try {
    resolved = await resolveIdentity(appEnv);
  } catch (error) {
    if (!dryRun) throw new Error(`no GitHub App identity for the agent, so it does not start: ${error.message}`);
    // A dry run still shows what the session would get.
    console.error(`ao-agent: no GitHub App identity (${error.message}); a real run stops here`);
    resolved = { identity: { repo: 'owner/name', readToken: '<token>', helper: credentialHelper(kitDir), bot: { name: '<bot>', email: '<bot email>' } } };
  }
  plan = launchPlan({ role, roster, args, skills, projectDir, identity: resolved.identity });
  plan.env = { ...appEnv, ...plan.env };
  shown = { ...plan.env, GH_TOKEN: `<read-only token of ${appEnv.AO_REVIEW_APP ?? 'ao-review'}${resolved.expiresAt ? `, expires ${resolved.expiresAt}` : ''}>` };
  mkdirSync(dirname(plan.skillsFile.path), { recursive: true });
  writeFileSync(plan.skillsFile.path, plan.skillsFile.text);
} catch (error) {
  console.error(`ao-agent: ${error.message}`);
  process.exit(1);
}

if (dryRun) {
  const quoted = plan.args.map((arg) => (/[\s"]/.test(arg) ? JSON.stringify(arg) : arg));
  console.log(`${plan.command} ${quoted.join(' ')}`);
  for (const [name, value] of Object.entries(shown)) console.log(`  ${name}=${value}`);
  console.log(`  unset ${plan.clear.join(' ')}`);
} else {
  const env = { ...process.env, ...plan.env };
  for (const name of plan.clear) delete env[name];
  const child = spawn(plan.command, plan.args, { stdio: 'inherit', env });
  child.on('error', (error) => {
    console.error(`ao-agent: cannot start ${plan.command}: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}
