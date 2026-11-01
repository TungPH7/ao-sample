// audit (quality-gates spec section 2.6): checks that the commit about to be deployed came through the gates, writes
// the outcome to the job summary, and exits non-zero when it did not, so the deploy job that needs it does not run.
// The logic is lib/quality/audit.mjs; this file builds the clients. In a project it runs from .ai-orchestrator/scripts/.
// Usage: node scripts/audit.mjs --sha <commit> --branch <branch> [--dry-run] [--repo <owner>/<name>]
// The repository is GITHUB_REPOSITORY, else the GitHub remote origin of the current folder; reads use GITHUB_TOKEN or
// the GitHub CLI. A failed audit flags the work item with JIRA_CI_TOKEN. The App slugs, your GitHub logins
// (AO_APPROVERS) and the project space (AO_JIRA_SPACE) come from the environment or from the env block of the project's
// .claude/settings.json. --dry-run flags nothing. The merge of a docs PR needs JIRA_CI_TOKEN to read the Epic, and
// actions: read to read the CI runs of its head.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readContract } from '../lib/contract.mjs';
import { projectSettings, setting } from '../lib/project-settings.mjs';
import { runAudit } from '../lib/quality/audit.mjs';
import { gatePassage } from '../lib/quality/docs-pr.mjs';
import { readGates } from '../lib/quality/gates.mjs';
import { createGitHubClient, originRepo, readGitHubToken } from '../lib/tracker/github-client.mjs';
import { bearerAuth, createJiraClient } from '../lib/tracker/jira-client.mjs';
import { readMapping } from '../lib/tracker/mapping.mjs';

const kit = fileURLToPath(new URL('..', import.meta.url));
const projectDir = process.env.GITHUB_WORKSPACE ?? process.cwd();
const USAGE = 'usage: audit.mjs --sha <commit> --branch <branch> [--dry-run] [--repo <owner>/<name>]';
const lines = [];
const log = (line) => {
  lines.push(line);
  console.log(line);
};

try {
  const { values } = parseArgs({ options: { sha: { type: 'string' }, branch: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, repo: { type: 'string' } } });
  if (!values.sha || !values.branch) throw new Error(USAGE);
  const repo = values.repo ?? process.env.GITHUB_REPOSITORY ?? originRepo(projectDir);
  if (!repo) throw new Error('Set GITHUB_REPOSITORY, pass --repo <owner>/<name>, or run audit in a clone whose origin is on GitHub');
  const settings = projectSettings(projectDir);
  const apps = { dev: setting('AO_DEV_APP', settings), review: setting('AO_REVIEW_APP', settings) };
  if (!apps.dev || !apps.review) throw new Error('Set AO_DEV_APP and AO_REVIEW_APP, the slugs of the two GitHub Apps, in .claude/settings.json');
  const approvers = (setting('AO_APPROVERS', settings) ?? '').split(',').map((login) => login.trim()).filter(Boolean);
  if (approvers.length === 0) log('Warning: AO_APPROVERS is not set, so no PR counts as approved by you');
  const space = setting('AO_JIRA_SPACE', settings);
  const token = readGitHubToken();
  if (!token) throw new Error('Set GITHUB_TOKEN, or log in to the GitHub CLI');
  const mapping = readMapping(join(kit, 'tracker'));
  const jiraToken = process.env.JIRA_CI_TOKEN;
  const flagging = !values['dry-run'] && Boolean(space && jiraToken);
  if (!values['dry-run'] && !flagging) log('Warning: without AO_JIRA_SPACE and JIRA_CI_TOKEN a failed audit flags no work item');

  const gates = readGates(join(kit, 'quality'));
  // The merge of a docs PR passes on the Epic's state (dev-workflow spec 2.4), read with the same token.
  const docs = jiraToken
    ? { jira: createJiraClient({ cloudId: mapping.cloud_id, authorization: bearerAuth(jiraToken) }), passage: gatePassage(readContract(join(kit, 'contract')), mapping, gates.docs_pull_requests.gate) }
    : undefined;
  const { ok } = await runAudit({
    github: createGitHubClient({ repo, token }),
    jira: flagging ? createJiraClient({ cloudId: mapping.cloud_id, authorization: bearerAuth(jiraToken), write: true }) : undefined,
    docs,
    mapping,
    space,
    sha: values.sha,
    branch: values.branch,
    gates,
    apps,
    approvers,
    dryRun: !flagging,
    log,
  });
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  lines.push(`audit could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Audit\n\n${lines.join('\n')}\n`);
}
