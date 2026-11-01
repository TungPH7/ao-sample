// jira-sync (tracker-integration spec section 2.7): reconciles the work items of the GitHub event that started the run,
// and makes the changes with the CI token. The logic is lib/tracker/sync.mjs; this file reads the event and builds the
// clients. In a project it runs from .ai-orchestrator/scripts/, next to the project's copy of the kit.
// Usage: node scripts/jira-sync.mjs [--dry-run]
// Needs GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, JIRA_CI_TOKEN, and GITHUB_TOKEN or the GitHub CLI. The project space and
// your GitHub logins come from AO_JIRA_SPACE and AO_APPROVERS, or from the env block of the project's
// .claude/settings.json, where the hooks read them too. --dry-run prints the changes and sends no write request.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readContract } from '../lib/contract.mjs';
import { projectSettings, setting } from '../lib/project-settings.mjs';
import { createGitHubClient, readGitHubToken } from '../lib/tracker/github-client.mjs';
import { bearerAuth, createJiraClient } from '../lib/tracker/jira-client.mjs';
import { readMapping } from '../lib/tracker/mapping.mjs';
import { runSync } from '../lib/tracker/sync.mjs';

const kit = fileURLToPath(new URL('..', import.meta.url));
const projectDir = process.env.GITHUB_WORKSPACE ?? process.cwd();
const dryRun = process.argv.includes('--dry-run');

try {
  const { GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: eventPath, JIRA_CI_TOKEN: token } = process.env;
  if (!event || !eventPath) throw new Error('Set GITHUB_EVENT_NAME and GITHUB_EVENT_PATH, as GitHub Actions does');
  if (!token) throw new Error('Set JIRA_CI_TOKEN to the token of the automation account');
  const settings = projectSettings(projectDir);
  const space = setting('AO_JIRA_SPACE', settings);
  if (!space) throw new Error('Set AO_JIRA_SPACE to the project space key in .claude/settings.json');
  const approvers = (setting('AO_APPROVERS', settings) ?? '').split(',').map((login) => login.trim()).filter(Boolean);
  if (approvers.length === 0) console.log('Warning: AO_APPROVERS is not set, so no PR counts as approved by you and no item goes to QA');

  const payload = JSON.parse(readFileSync(eventPath, 'utf8'));
  // Read without validating: a project's copy has no templates, and npm run validate checks the contract in the kit.
  const contract = readContract(join(kit, 'contract'));
  const mapping = readMapping(join(kit, 'tracker'));
  const repo = process.env.GITHUB_REPOSITORY ?? payload.repository?.full_name;
  const githubToken = readGitHubToken();
  if (!repo || !githubToken) throw new Error('Set GITHUB_REPOSITORY and GITHUB_TOKEN, or log in to the GitHub CLI');

  const { failures } = await runSync({
    event,
    payload,
    jira: createJiraClient({ cloudId: mapping.cloud_id, authorization: bearerAuth(token), write: !dryRun }),
    github: createGitHubClient({ repo, token: githubToken }),
    contract,
    mapping,
    space,
    approvers,
    dryRun,
  });
  if (failures.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
