// The pre-push hook (quality-gates spec section 2.3): refuses a push that changes or deletes a protected branch.
// Usage, from kit/.githooks/pre-push: node .ai-orchestrator/scripts/pre-push.mjs <remote> <url>, with git's refs on stdin.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readGates } from '../lib/quality/gates.mjs';
import { checkPush } from '../lib/quality/git-hooks.mjs';

const gates = readGates(fileURLToPath(new URL('../quality/', import.meta.url)));
const result = checkPush(readFileSync(0, 'utf8').split(/\r?\n/), gates.protected_branches);
if (!result.ok) {
  for (const reason of result.reasons) console.error(`pre-push: ${reason}`);
  process.exit(1);
}
