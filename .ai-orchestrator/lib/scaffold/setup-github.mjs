// ao-kit setup github (project-scaffold spec 2.4; plan, decision 8): what the GitHub side of a project needs, set with
// your gh login. Each step reads first and writes only what is missing, so a second run changes nothing. Secrets go to
// gh through stdin, never as an argument; nothing is printed of them. What the API cannot do, such as installing the
// Apps (403 with a gh token, Pilot 1), comes back as steps for you.
//   gh(args, { input })   gh with no shell: { status, stdout, stderr }
//   run(argv)             node for gh-protect.mjs
//   secret(name)          a variable of your environment or of your Windows user, or null
//   readFile(path)        the text of a file
import { join } from 'node:path';

const ENVIRONMENTS = ['development', 'staging', 'production'];
const json = (result) => {
  try {
    return JSON.parse(result.stdout || 'null');
  } catch {
    return null;
  }
};

export function setupGithub({ kitDir, repo, devAppKeyFile, secret, readFile, gh, run }) {
  const notes = [];
  const done = [];
  const left = [];
  const write = (label, args, options) => {
    const result = gh(args, options);
    if (result.status !== 0) left.push(`${label} failed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`);
    else notes.push(`Set ${label}`);
    return result.status === 0;
  };

  const info = json(gh(['api', `repos/${repo}`]));
  if (!info) return { ok: false, notes: [`gh cannot read ${repo}: check the name, and that gh is logged in as you (gh auth status)`] };
  const develop = gh(['api', `repos/${repo}/branches/develop`]).status === 0;
  if (info.default_branch === 'develop') done.push('default branch develop');
  else if (!develop) left.push('develop is not on GitHub yet: push it, then run ao-kit setup github again, so it becomes the default branch');
  else write('the default branch to develop, so merge-gate and jira-sync run the workflows of develop', ['api', '-X', 'PATCH', `repos/${repo}`, '-f', 'default_branch=develop']);
  if (info.delete_branch_on_merge) done.push('branch deletion');
  else write('the deletion of a branch once its PR is merged', ['api', '-X', 'PATCH', `repos/${repo}`, '-F', 'delete_branch_on_merge=true']);

  const alerts = gh(['api', `repos/${repo}/vulnerability-alerts`]).status === 0;
  const autofix = json(gh(['api', `repos/${repo}/automated-security-fixes`]))?.enabled === true;
  if (alerts && autofix) done.push('Dependabot security updates');
  else {
    if (!alerts) write('Dependabot alerts', ['api', '-X', 'PUT', `repos/${repo}/vulnerability-alerts`]);
    if (!autofix) write('Dependabot security updates', ['api', '-X', 'PUT', `repos/${repo}/automated-security-fixes`]);
  }

  // merge-gate reads the second key of ao-dev from its environment, which only develop may use (docs/quality-gates.md).
  const envs = new Set((json(gh(['api', `repos/${repo}/environments`]))?.environments ?? []).map(({ name }) => name));
  const missingEnvs = [...ENVIRONMENTS, 'merge-gate'].filter((name) => !envs.has(name));
  if (missingEnvs.length === 0) done.push('environments');
  for (const name of missingEnvs) {
    if (name === 'merge-gate') write('the environment merge-gate, for develop only', ['api', '-X', 'PUT', `repos/${repo}/environments/merge-gate`, '--input', '-'], { input: JSON.stringify({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }) });
    else write(`the environment ${name}`, ['api', '-X', 'PUT', `repos/${repo}/environments/${name}`]);
  }
  const policies = (json(gh(['api', `repos/${repo}/environments/merge-gate/deployment-branch-policies`]))?.branch_policies ?? []).map(({ name }) => name);
  if (policies.includes('develop')) done.push('the branch rule of merge-gate');
  else write('the branch rule of merge-gate: develop', ['api', '-X', 'POST', `repos/${repo}/environments/merge-gate/deployment-branch-policies`, '-f', 'name=develop', '-f', 'type=branch']);

  const secrets = new Set((json(gh(['secret', 'list', '--repo', repo, '--json', 'name'])) ?? []).map(({ name }) => name));
  if (secrets.has('JIRA_CI_TOKEN')) done.push('JIRA_CI_TOKEN');
  else {
    const token = secret('JIRA_CI_TOKEN');
    if (!token) left.push('JIRA_CI_TOKEN is not set on this machine: set it as a user variable (docs/getting-started.md), then run ao-kit setup github again');
    else write('the secret JIRA_CI_TOKEN, from your variable', ['secret', 'set', 'JIRA_CI_TOKEN', '--repo', repo], { input: token });
  }
  const envSecrets = new Set((json(gh(['secret', 'list', '--env', 'merge-gate', '--repo', repo, '--json', 'name'])) ?? []).map(({ name }) => name));
  if (envSecrets.has('AO_DEV_APP_KEY')) done.push('AO_DEV_APP_KEY');
  else if (!devAppKeyFile) left.push('AO_DEV_APP_KEY: give the second private key of ao-dev with --dev-app-key-file <path> (docs/github-apps-setup.md, section 2), then run ao-kit setup github again');
  else if (write('the secret AO_DEV_APP_KEY of merge-gate, from the key file', ['secret', 'set', 'AO_DEV_APP_KEY', '--env', 'merge-gate', '--repo', repo], { input: readFile(devAppKeyFile) })) notes.push(`Delete ${devAppKeyFile} now: GitHub holds the key, and no other copy should`);

  const ruleset = run(['node', join(kitDir, 'scripts', 'gh-protect.mjs').replaceAll('\\', '/'), '--repo', repo]);
  notes.push(`gh:protect: ${`${ruleset.stdout ?? ''}${ruleset.stderr ?? ''}`.trim().split('\n').at(-1) || `exit ${ruleset.status}`}`);
  if (done.length > 0) notes.push(`Already set: ${done.join(', ')}`);
  notes.push(...left);
  notes.push(
    `By hand: add ${repo} to the two GitHub Apps: on GitHub, Settings → Applications → Installed GitHub Apps → Configure beside each App → Repository access → choose the repo → Save (docs/github-apps-setup.md section 3)`,
    `By hand: connect GitHub for Atlassian to ${repo} (docs/jira-setup.md section 11)`,
  );
  return { ok: left.length === 0 && ruleset.status === 0, notes };
}
