// ao-pr.mjs (quality-gates spec section 2.2): agents open, edit and comment on PRs with the ao-dev App, and post review
// reports with the ao-review App. The repository is the GitHub remote `origin`; each run buys a token for it and never
// prints one. The commands are in lib/quality/ao-pr.mjs.
// node .ai-orchestrator/scripts/ao-pr.mjs create|edit|comment|review ... (run it without arguments for the usage)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAoPr } from '../lib/quality/ao-pr.mjs';
import { readGates } from '../lib/quality/gates.mjs';
import { appCredentials, githubRepoOf, installationToken } from '../lib/quality/github-app.mjs';
import { createGitHubClient } from '../lib/tracker/github-client.mjs';

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' }).stdout?.trim() ?? '';

async function clientFor(kind) {
  const repo = githubRepoOf(git('remote', 'get-url', 'origin'));
  const { appId, privateKey } = appCredentials(kind);
  const { token } = await installationToken({ appId, privateKey, repo });
  return createGitHubClient({ repo, token, write: true });
}

try {
  const gates = readGates(fileURLToPath(new URL('../quality/', import.meta.url)));
  const readFile = (file) => readFileSync(file, 'utf8');
  console.log(await runAoPr(process.argv.slice(2), { gates, clientFor, readFile, currentBranch: () => git('rev-parse', '--abbrev-ref', 'HEAD') }));
} catch (error) {
  console.error(`ao-pr: ${error.message}`);
  process.exit(1);
}
