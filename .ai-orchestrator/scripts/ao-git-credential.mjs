// Credential helper of an agent session (dev-workflow spec 2.3). ao-agent.mjs sets it through GIT_CONFIG_* as
// `!node "<kit>/scripts/ao-git-credential.mjs" <role> <owner/name>`, and git adds the action. On `get` for that
// repository it buys a token of the role's App (lib/agents/git-credential.mjs) and gives it to git on stdout, the only
// place the token goes. Whatever goes wrong is said on stderr, which git shows: without it git only says
// "Repository not found" (T2). It always exits 0, and git goes on to its own error.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialAnswer, credentialPlan, parseCredentialRequest } from '../lib/agents/git-credential.mjs';
import { readRoster } from '../lib/agents/roster.mjs';
import { readGates } from '../lib/quality/gates.mjs';
import { appCredentials, installationToken } from '../lib/quality/github-app.mjs';

const [role, repo, action] = process.argv.slice(2);
let input = '';
for await (const chunk of process.stdin) input += chunk;

try {
  if (!action) throw new Error('usage: ao-git-credential.mjs <role> <owner/name> get|store|erase (git runs it)');
  const kit = fileURLToPath(new URL('..', import.meta.url));
  const request = parseCredentialRequest(input);
  const plan = credentialPlan({ action, request, role, repo, roster: readRoster(join(kit, 'agents')), gates: readGates(join(kit, 'quality')) });
  if (plan.reason) throw new Error(plan.reason);
  if (plan.kind) {
    const { token } = await installationToken({ ...appCredentials(plan.kind), repo, permissions: plan.permissions });
    process.stdout.write(credentialAnswer(token));
  }
} catch (error) {
  console.error(`ao-git-credential: ${error.message}`);
}
