// ao-kit doctor (project-scaffold spec 2.5): what a project still lacks, row by row, each with what to do. Pure: ao-kit
// gathers the facts (scripts/ao-kit.mjs) and this decides. A secret is judged by whether it is there and its shape,
// never printed. The VPS row is a question: doctor does not reach the VPS, so it prints the lines deployer.yaml needs.
// facts: { config, projectProblems, nodeVersion, versions: { gh, claude, git }, env, files (the paths that exist),
// kitDrift, renderCheck, hooksPath, gitignoreMissing, github: { defaultBranch, environments, secrets, envSecrets,
// workflows (how many GitHub knows), ciRuns (on develop) }, apps: { dev, review }, jiraCheck, claude: { trusted, mcp } }
import { basicAuthEnv } from '../workflow/qa.mjs';

const MIN_GH = [2, 102, 0];
const ENVIRONMENTS = ['development', 'staging', 'production', 'merge-gate'];
const MCP = ['atlassian', 'chrome-devtools'];
const newer = (version, min) => {
  const parts = (version ?? '').match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  if (!parts) return false;
  for (let i = 0; i < 3; i++) if (parts[i] !== min[i]) return parts[i] > min[i];
  return true;
};
const shapeOk = (value) => typeof value === 'string' && value.length >= 8 && !/\s/.test(value);

export function doctor(facts) {
  const { config, env } = facts;
  const repo = config?.github?.repo ?? 'the repo';
  const rows = [];
  const row = (group, name, ok, fix) => rows.push({ group, name, ok, fix: ok === true ? '' : fix });

  row('Machine', 'Node 24', Number(facts.nodeVersion.split('.')[0]) >= 24, 'Install Node.js 24 from nodejs.org, then open a new terminal');
  row('Machine', 'GitHub CLI 2.102.0 or later', newer(facts.versions.gh, MIN_GH), 'Install or update gh: winget upgrade GitHub.cli, then gh auth login');
  row('Machine', 'Claude Code', Boolean(facts.versions.claude), 'Install Claude Code (docs/getting-started.md), then run claude once and sign in');
  row('Machine', 'Git', Boolean(facts.versions.git), 'Install Git for Windows, which brings Git Bash');
  row('Machine', 'ATLASSIAN_AGENT_TOKEN is set', shapeOk(env.ATLASSIAN_AGENT_TOKEN), 'Set the API token of the agents\' Jira account as the user variable ATLASSIAN_AGENT_TOKEN (docs/getting-started.md)');
  row('Machine', 'JIRA_CI_TOKEN is set', shapeOk(env.JIRA_CI_TOKEN), 'Set the API token of the CI Jira account as the user variable JIRA_CI_TOKEN: ao-kit setup github and the QA evidence use it');
  for (const kind of ['DEV', 'REVIEW']) {
    const name = `AO_${kind}_APP_KEY_FILE`;
    row('Machine', `${name} names a key file`, Boolean(env[name]) && facts.files.has(env[name]), `Set ${name} to the path of the private key of ao-${kind.toLowerCase()} on this machine (docs/github-apps-setup.md)`);
  }
  let auth = false;
  try {
    basicAuthEnv(env.AO_ENV_AUTH);
    auth = true;
  } catch {
    auth = false;
  }
  row('Machine', 'AO_ENV_AUTH is user:password', auth, 'Set AO_ENV_AUTH to the basic auth of Development and Staging, user:password, with no double quote, backslash or line break (docs/vps-setup.md section 11)');

  row('Repo', 'project.yaml is valid and agrees with the project', facts.projectProblems.length === 0, `Fix .ai-orchestrator/project.yaml, then ao-kit check: ${facts.projectProblems.slice(0, 3).join('; ')}`);
  row('Repo', 'the kit files are those of this clone', facts.kitDrift.length === 0, `${facts.kitDrift.length} kit files differ: ao-kit sync <dir> --key <KEY of a Task>, then its PR`);
  row('Repo', 'settings.json and the agents are rendered from project.yaml', facts.renderCheck.status === 0, `ao-kit render <dir>, then commit: ${facts.renderCheck.text.split('\n')[0]}`);
  row('Repo', 'git hooks are installed', facts.hooksPath === '.githooks', 'npm install in the project: its prepare script runs .ai-orchestrator/scripts/install-hooks.mjs');
  row('Repo', '.gitignore has the lines of the kit', facts.gitignoreMissing.length === 0, `ao-kit sync, or add them by hand: ${facts.gitignoreMissing.join(', ')}`);

  const gh = facts.github;
  row('GitHub', 'default branch develop', gh.defaultBranch === 'develop', 'ao-kit setup github <dir>, once develop is on GitHub');
  row('GitHub', `environments ${ENVIRONMENTS.join(', ')}`, ENVIRONMENTS.every((name) => gh.environments.includes(name)), 'ao-kit setup github <dir>');
  row('GitHub', 'secrets JIRA_CI_TOKEN, and AO_DEV_APP_KEY of merge-gate', gh.secrets.includes('JIRA_CI_TOKEN') && gh.envSecrets.includes('AO_DEV_APP_KEY'), 'ao-kit setup github <dir> --dev-app-key-file <second key of ao-dev>');
  for (const kind of ['dev', 'review']) {
    const app = facts.apps[kind];
    row('GitHub', `ao-${kind} installed on ${repo}`, app.ok, `${app.reason ?? 'no token'}: install the App on the repo (docs/getting-started.md)`);
  }
  // The first push to an empty repo may start nothing: no run though the workflows were active (Pilot 1, T7), or
  // Actions off on the repo though the API says enabled (T16).
  row('GitHub', 'GitHub knows the workflows of the repo', gh.workflows > 0, 'Open the Actions tab of the repo on GitHub: if it says "Workflows aren\'t being run on this repository", click Enable Actions on this repository');
  row('GitHub', 'CI has run on develop', gh.ciRuns > 0, `gh workflow run CI --repo ${repo} --ref develop, then wait for it to pass: the first push to an empty repo may start no workflow`);

  row('Jira', 'jira:check finds no difference', facts.jiraCheck.status === 0, `ao-kit setup jira <dir>, then the board columns by hand: ${facts.jiraCheck.text.split('\n').at(-1)}`);

  row('Claude Code', 'folder trusted', facts.claude.trusted === true, 'Open claude in the project folder once and answer that you trust it: until then Claude Code skips the allow rules of the project');
  row('Claude Code', `MCP servers ${MCP.join(', ')} allowed`, MCP.every((name) => facts.claude.mcp.includes(name)), 'In claude, run /mcp and allow both servers; /mcp must show them connected');

  const name = config?.name ?? '<name>';
  const hosts = ['development', 'staging', 'production'].map((environment) => `      ${environment}: ${name}${environment === 'production' ? '' : `-${environment === 'development' ? 'dev' : environment}`}.<your domain>`).join('\n');
  rows.push({ group: 'VPS', name: 'is the project in /etc/ao/deployer.yaml? doctor does not reach the VPS', ok: null, fix: `Under projects: of /etc/ao/deployer.yaml, as docs/vps-setup.md says:\n  - name: ${name}\n    repo: ${repo}\n    space: ${config?.jira?.space ?? '<KEY>'}\n    hosts:\n${hosts}` });
  return rows;
}

// The printout: ✔ for a row that passes, ✘ with what to do, ? for a question; then how many rows to fix.
export function formatDoctor(rows) {
  const lines = rows.map(({ group, name, ok, fix }) => {
    const mark = ok === true ? '✔' : ok === false ? '✘' : '?';
    return `${mark} ${group}: ${name}${ok === true ? '' : `\n${fix.split('\n').map((line) => `    ${line}`).join('\n')}`}`;
  });
  const bad = rows.filter(({ ok }) => ok === false).length;
  lines.push('', bad === 0 ? 'Every row passes.' : `${bad} row${bad === 1 ? '' : 's'} to fix.`);
  return lines.join('\n');
}
