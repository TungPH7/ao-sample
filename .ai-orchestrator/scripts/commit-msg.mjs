// The commit-msg hook (quality-gates spec section 2.3): refuses a commit whose header breaks the convention.
// Usage, from kit/.githooks/commit-msg: node .ai-orchestrator/scripts/commit-msg.mjs <message file>
import { readFileSync } from 'node:fs';
import { checkCommitMessage } from '../lib/quality/git-hooks.mjs';

const result = checkCommitMessage(readFileSync(process.argv[2], 'utf8'));
if (!result.ok) {
  console.error(`commit-msg: ${result.reason}`);
  console.error('The header is type(scope): subject (<KEY>), for example: feat(api): add login endpoint (DEMO-12)');
  process.exit(1);
}
