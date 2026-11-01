// PreToolUse hook for Bash, Read, Edit, Write and NotebookEdit (quality-gates spec section 2.7): refuses agents the ways
// around the quality gates, and, when the kit copy has agents/roster.yaml, what a role may not do (agent-roster spec
// 2.10). The logic is checkAgentCall in lib/quality/commands.mjs. Allows by printing nothing; refuses with
// permissionDecision "deny" and the reason.
// The kit is in .ai-orchestrator/ of the project, or in AO_KIT_DIR.
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const kit = resolve(process.env.AO_KIT_DIR ?? join(projectDir, '.ai-orchestrator'));
const load = (path) => import(pathToFileURL(join(kit, path)).href);

// os.tmpdir() gives the short (8.3) name of a user folder with a space; Claude Code writes by the long one.
function tempDirs() {
  try {
    return [tmpdir(), realpathSync.native(tmpdir())];
  } catch {
    return [tmpdir()];
  }
}

let text = '';
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);

let decision;
try {
  const { readContract } = await load('lib/contract.mjs');
  const { readGates } = await load('lib/quality/gates.mjs');
  const { checkAgentCall } = await load('lib/quality/commands.mjs');
  const { readRoster } = await load('lib/agents/roster.mjs');
  const roster = existsSync(join(kit, 'agents', 'roster.yaml')) ? readRoster(join(kit, 'agents')) : undefined;
  decision = checkAgentCall(input, { gates: readGates(join(kit, 'quality')), contract: readContract(join(kit, 'contract')), projectDir, roster, tempDir: tempDirs() });
} catch (error) {
  // Without the kit, refuse an agent's git and gh commands, the ones this hook exists for, so other tools keep working.
  const risky = Boolean(input.agent_type) && input.tool_name === 'Bash' && /\b(?:git|gh)\b/.test(input.tool_input?.command ?? '');
  decision = risky ? { allow: false, reason: `gh-guard: ${error.message}` } : { allow: true };
}
if (!decision.allow) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } }));
}
