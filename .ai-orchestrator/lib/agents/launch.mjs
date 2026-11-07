// The command ao-agent.mjs runs to start an agent as the main session (agent-roster spec 2.5). `claude --agent` takes
// only the tools, model and system prompt of an agent, so the effort, the turn limit and the preloaded skills come as
// flags (T1). The session also gets the GitHub identity of the Apps in its environment (dev-workflow spec 2.3). Pure:
// the script reads the skills, buys the token, writes the skills file and starts claude.
import { join } from 'node:path';

const INTERACTIVE = 'You work with the human directly in this session: when you need an answer, ask them one question at a time.';
const UNATTENDED = 'You run unattended (claude -p): nobody answers questions in this session. Write them where your instructions say, then stop.';

// What the token in GH_TOKEN may do: every role reads PRs, reviews and CI with it, and writes nothing.
export const READ_PERMISSIONS = { contents: 'read', pull_requests: 'read', actions: 'read', checks: 'read' };

// Variables of your environment that would give git or gh another way in: settings passed by `git -c`, a program that
// asks for a password, and the tokens gh reads after GH_TOKEN. Also your own secrets: Windows gives every process your
// user variables, and the CI token, your admin token, the read-only Jira token of the deployer and the basic auth of the
// environments stay in your session (release-workflow spec 2.5, T13); qa gets the basic auth as its own two variables.
export const CLEARED_ENV = [
  'GIT_CONFIG_PARAMETERS', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
  'JIRA_CI_TOKEN', 'JIRA_ADMIN_TOKEN', 'AO_JIRA_READ_TOKEN', 'AO_ENV_AUTH',
];

// The command git runs for a credential, before the role and the repository. git runs it through the shell, so the
// folder is quoted, and a folder the shell would still read inside the quotes is refused.
export function credentialHelper(kitDir) {
  const dir = kitDir.replaceAll('\\', '/').replace(/\/+$/, '');
  if (/["$`\n\r]/.test(dir)) throw new Error(`the kit folder ${kitDir} cannot be quoted for git's credential helper; move the project`);
  return `node "${dir}/scripts/ao-git-credential.mjs"`;
}

// args: the caller's arguments for claude, such as -p "<prompt>" --output-format json. skills: Map of skill name →
// { dir, text } for the SKILL.md files the role preloads. roster: already merged with roster.local.yaml. identity:
// { repo, readToken, helper, bot: { name, email } }, what ao-agent.mjs resolved with the Apps.
// Returns the command and its arguments, the skills file, and the variables to set (env) and to remove (clear).
export function launchPlan({ role, roster, args, skills, projectDir, identity }) {
  const entry = roster.roles[role];
  if (!entry) throw new Error(`${role} is not a role of agents/roster.yaml`);
  const unattended = args.includes('-p') || args.includes('--print');
  const parts = [`## Session\n\n${unattended ? UNATTENDED : INTERACTIVE}`];
  for (const name of entry.skills) {
    const skill = skills.get(name);
    if (!skill) throw new Error(`skill ${name} of ${role} has no SKILL.md in .claude/skills/${name}`);
    parts.push(`## Skill: ${name}\n\nThe files of this skill are in ${skill.dir}.\n\n${skill.text.replace(/\r\n?/g, '\n').trim()}`);
  }
  const path = join(projectDir, '.ai', 'agents', `${role}.skills.md`);
  const ours = [
    '--agent',
    role,
    ...(args.includes('--effort') ? [] : ['--effort', entry.effort]),
    '--append-system-prompt-file',
    path,
    ...(unattended && entry.max_turns && !args.includes('--max-turns') ? ['--max-turns', String(entry.max_turns)] : []),
  ];
  return { command: 'claude', args: [...ours, ...args], skillsFile: { path, text: `${parts.join('\n\n')}\n` }, env: agentEnv(role, identity), clear: CLEARED_ENV };
}

// gh reads with the token in GH_TOKEN. For credentials git reads only the settings below: the empty credential.helper
// drops every helper set before it, such as Git Credential Manager, and the next one is the kit's helper with the role
// and the repository in its value. gh-guard refuses the commands that change them (GIT_CONFIG_*, -c credential.*), which
// stops a mistake, not an agent set on getting round it: the session runs as your Windows user and can read the App
// keys (docs/quality-gates.md). The helper decides what each role gets (lib/agents/git-credential.mjs).
function agentEnv(role, identity) {
  if (!identity?.readToken || !identity.helper || !identity.bot) throw new Error('an agent session needs the GitHub App identity: the read-only token, the credential helper and the bot');
  if (!/^[\w.-]+\/[\w.-]+$/.test(identity.repo ?? '')) throw new Error(`the repository must be owner/name, not ${identity.repo}`);
  const config = [
    ['credential.helper', ''],
    ['credential.helper', `!${identity.helper} ${role} ${identity.repo}`],
    ['credential.useHttpPath', 'true'],
    ['user.name', identity.bot.name],
    ['user.email', identity.bot.email],
  ];
  return {
    GH_TOKEN: identity.readToken,
    GH_PROMPT_DISABLED: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: String(config.length),
    ...Object.fromEntries(config.flatMap(([key, value], n) => [[`GIT_CONFIG_KEY_${n}`, key], [`GIT_CONFIG_VALUE_${n}`, value]])),
  };
}
