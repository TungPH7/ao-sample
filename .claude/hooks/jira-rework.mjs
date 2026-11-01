// PostToolUse hook after mcp__atlassian__transitionJiraIssue (tracker-integration plan, decision 2): when the move was
// a rework that reached the limit of policies.yaml, tells the agent to flag the item through MCP and stop. The logic is
// reworkDecision in lib/tracker/guard.mjs; the history is read with the agent's token.
// The kit is in .ai-orchestrator/ of the project, or in AO_KIT_DIR.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TOOL = 'mcp__atlassian__transitionJiraIssue';
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const kit = resolve(process.env.AO_KIT_DIR ?? join(projectDir, '.ai-orchestrator'));
const load = (path) => import(pathToFileURL(join(kit, path)).href);

let text = '';
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);

if (input.tool_name === TOOL) {
  const key = input.tool_input?.issueIdOrKey;
  let decision;
  try {
    const { readContract } = await load('lib/contract.mjs');
    const { readMapping } = await load('lib/tracker/mapping.mjs');
    const { bearerAuth, createJiraClient } = await load('lib/tracker/jira-client.mjs');
    const { readItem } = await load('lib/tracker/facts.mjs');
    const { reworkDecision } = await load('lib/tracker/guard.mjs');
    if (!process.env.ATLASSIAN_AGENT_TOKEN) throw new Error('ATLASSIAN_AGENT_TOKEN is not set');
    // Read without validating: the copy has no templates, and npm run validate already checks the contract in the kit.
    const contract = readContract(join(kit, 'contract'));
    const mapping = readMapping(join(kit, 'tracker'));
    const jira = createJiraClient({ cloudId: mapping.cloud_id, authorization: bearerAuth(process.env.ATLASSIAN_AGENT_TOKEN) });
    const item = await readItem(jira, key);
    const histories = await jira.getAll(`/rest/api/3/issue/${encodeURIComponent(key)}/changelog`);
    decision = reworkDecision({ histories, item, contract, mapping });
  } catch (error) {
    decision = { block: true, reason: `jira-rework: could not count the rework of ${key}: ${error.message}. Check the rework count before going on.` };
  }
  if (decision.block) console.log(JSON.stringify({ decision: 'block', reason: decision.reason }));
}
