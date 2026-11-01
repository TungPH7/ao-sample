// PreToolUse hook for Bash and MCP tools (tracker-integration spec section 2.6): refuses the ways around jira-guard, and
// writes outside the project space set in AO_JIRA_SPACE. The logic is checkToolCall in lib/tracker/guard.mjs. Allows
// by printing nothing; refuses with permissionDecision "deny" and the reason.
// The kit is in .ai-orchestrator/ of the project, or in AO_KIT_DIR.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const kit = resolve(process.env.AO_KIT_DIR ?? join(projectDir, '.ai-orchestrator'));
const load = (path) => import(pathToFileURL(join(kit, path)).href);

let text = '';
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);

let decision;
try {
  const { readMapping } = await load('lib/tracker/mapping.mjs');
  const { checkToolCall } = await load('lib/tracker/guard.mjs');
  const env = process.env.AO_JIRA_SPACE ?? '';
  const space = /^[A-Z][A-Z0-9]+$/.test(env) ? env : null;
  decision = checkToolCall(input, { mapping: readMapping(join(kit, 'tracker')), space });
} catch (error) {
  // Without the kit, refuse only what touches Atlassian, so other tools keep working.
  const touchesAtlassian = /atlassian/i.test(`${input.tool_name} ${JSON.stringify(input.tool_input ?? {})}`);
  decision = touchesAtlassian ? { allow: false, reason: `jira: ${error.message}` } : { allow: true };
}
if (!decision.allow) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } }));
}
