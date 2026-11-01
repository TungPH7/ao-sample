// PreToolUse hook for mcp__atlassian__transitionJiraIssue (tracker-integration spec section 2.6): an agent may move a
// Jira item only when the contract allows its role and the guards hold. The logic is lib/tracker/guard.mjs; this file
// reads the hook input, builds the clients and prints the decision. It allows by printing nothing, so the usual
// permission flow goes on, and refuses with permissionDecision "deny" and the reason.
// The kit is in .ai-orchestrator/ of the project, or in AO_KIT_DIR.
import { execFileSync } from 'node:child_process';
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
  let decision;
  try {
    decision = await decideCall(input);
  } catch (error) {
    decision = { allow: false, reason: `jira-guard: ${error.message}` };
  }
  if (!decision.allow) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } }));
  }
}

async function decideCall(call) {
  const { readContract } = await load('lib/contract.mjs');
  const { readMapping } = await load('lib/tracker/mapping.mjs');
  const { bearerAuth, createJiraClient } = await load('lib/tracker/jira-client.mjs');
  const { createGitHubClient, readGitHubToken } = await load('lib/tracker/github-client.mjs');
  const { decide } = await load('lib/tracker/guard.mjs');
  // Read without validating: the copy has no templates, and npm run validate already checks the contract in the kit.
  const contract = readContract(join(kit, 'contract'));
  const mapping = readMapping(join(kit, 'tracker'));

  const token = process.env.ATLASSIAN_AGENT_TOKEN;
  const jira = token
    ? createJiraClient({ cloudId: mapping.cloud_id, authorization: bearerAuth(token) })
    : { get: async () => Promise.reject(new Error('ATLASSIAN_AGENT_TOKEN is not set')) };
  const repo = githubRepo();
  const githubToken = repo && readGitHubToken();
  const github = githubToken ? createGitHubClient({ repo, token: githubToken }) : null;
  return decide(call, { contract, mapping, jira, github });
}

// owner/name of the project's origin remote, from an https or ssh URL.
function githubRepo() {
  try {
    const url = execFileSync('git', ['-C', projectDir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    return url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}
