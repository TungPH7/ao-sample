// The logic of the Jira hooks (tracker-integration spec section 2.6): whether an agent may make a transition
// (jira-guard), whether a tool call goes around the guard (block-atlassian), and whether a rework must be flagged
// (jira-rework). The hook scripts in kit/.claude/hooks/ only read stdin, build the clients and print the decision.
import { NON_AGENT_ROLES } from '../rules/references.mjs';
import { checkTransition } from '../transitions.mjs';
import { extractKeys } from './conventions.mjs';
import { githubGuards, jiraGuards, jiraTime, readItem } from './facts.mjs';
import { countRework, reworkStatus } from './rework.mjs';

// input: the PreToolUse input of mcp__atlassian__transitionJiraIssue. Returns { allow: true } or { allow: false, reason }.
// Any error while reading the facts refuses the call.
export async function decide(input, { contract, mapping, jira, github, approvers = [] }) {
  const role = input.agent_type;
  const deny = (reason) => ({ allow: false, reason: `jira-guard: ${reason}` });
  if (!role) return deny('only an agent may move a Jira item; this call does not come from a subagent named after a role of the contract');
  if (NON_AGENT_ROLES.includes(role) || !contract.roles.some(({ id }) => id === role)) return deny(`"${role}" is not an agent role of the contract`);

  const { issueIdOrKey: key, transitionId, transitionName } = input.tool_input ?? {};
  try {
    const item = await readItem(jira, key);
    if (item.labels.includes(mapping.needs_you_label)) return deny(`${key} has the label ${mapping.needs_you_label} and waits for you`);

    const workType = contract.work_types.find(({ jira_issue_type: type }) => type === item.type)?.id;
    if (!workType) return deny(`${key} is a ${item.type}, which the contract does not know`);
    const workflowId = Object.keys(contract.workflows).find((id) => contract.workflows[id].applies_to.includes(workType));
    const workflow = contract.workflows[workflowId];
    const mapped = mapping.workflows[workflowId];

    let name = transitionName;
    if (!name) {
      // An id only means something on this item; the agent's token lists the transitions it may make here.
      const { transitions } = await jira.get(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
      name = transitions.find(({ id }) => id === String(transitionId))?.name;
      if (!name) return deny(`transition ${transitionId} is not available on ${key}`);
    }
    // The role first, so a role that may never make this transition hears that, whatever the item's status.
    const named = workflow.transitions.filter(({ id }) => mapped.transitions[id].name === name);
    if (named.length === 0) return deny(`the contract has no transition "${name}" for a ${item.type}`);
    if (!named.some(({ actors }) => actors.includes(role))) {
      return deny(`${role} may not make "${name}" on ${key}; it is for ${[...new Set(named.flatMap(({ actors }) => actors))].join(', ')}`);
    }
    const state = Object.keys(mapped.states).find((id) => mapped.states[id].status === item.status);
    const transition = named.find(({ from }) => [from].flat().includes(state));
    if (!transition) return deny(`the contract has no transition "${name}" from "${item.status}" for a ${item.type}`);

    const needed = transition.guards ?? [];
    const guards = [
      ...(await jiraGuards(jira, { item, actor: role, needed, contract, mapping })),
      ...(github ? await githubGuards(github, { item, needed, contract, mapping, approvers }) : []),
    ];
    const result = checkTransition(contract, workType, transition.id, { actor: role, facts: { guards } });
    if (!result.ok) return deny(`"${name}" on ${key} needs ${result.missingGuards.join(', ')}`);
    return { allow: true };
  } catch (error) {
    return deny(`could not check ${key}: ${error.message}`);
  }
}

const SERVER = 'mcp__atlassian__';
// The write tools agents use; each touches one work item, or creates one in a space.
const WRITE_TOOLS = ['createJiraIssue', 'editJiraIssue', 'addOrEditJiraIssueComment', 'transitionJiraIssue'];
// Generic tools that run any operation by name: a way around transitionJiraIssue and jira-guard.
const ANY_WRITE = ['executeWrite', 'executeDestructive'];

// The block-atlassian hook (spec section 2.6, plan task T14): no Atlassian call from Bash, no Atlassian tool of another
// server, no generic write tool, and writes only on the project space (Jira Free has no permission scheme, so the
// agent token could write to every space of the site). space is AO_JIRA_SPACE, set per project.
export function checkToolCall(input, { mapping, space }) {
  const deny = (reason) => ({ allow: false, reason: `jira: ${reason}` });
  const allow = { allow: true };
  const { tool_name: tool, tool_input: args = {} } = input;
  if (tool === 'Bash') return /atlassian/i.test(args.command ?? '') ? deny('do not call Atlassian from Bash; use the tools of the atlassian MCP server') : allow;
  if (!tool.startsWith('mcp__')) return allow;
  if (!tool.startsWith(SERVER)) return /atlassian/i.test(tool) ? deny(`use the atlassian MCP server of the project, not ${tool}`) : allow;

  const name = tool.slice(SERVER.length);
  if (ANY_WRITE.includes(name)) return deny(`${name} can run any write; use ${WRITE_TOOLS.slice(0, -1).join(', ')} or ${WRITE_TOOLS.at(-1)}`);
  if (!WRITE_TOOLS.includes(name)) return allow;
  if (!space) return deny('set AO_JIRA_SPACE to the project space key in .claude/settings.json');
  if (args.cloudId && args.cloudId !== mapping.cloud_id && !args.cloudId.includes(mapping.site)) return deny(`${args.cloudId} is not the Jira site of the project`);
  if (name === 'createJiraIssue') return args.projectKey === space ? allow : deny(`${args.projectKey} is outside the project space ${space}`);
  const [key] = extractKeys(String(args.issueIdOrKey ?? ''));
  if (!key) return deny(`use the work item key, not ${args.issueIdOrKey}, so the project space can be checked`);
  return key.startsWith(`${space}-`) ? allow : deny(`${key} is outside the project space ${space}`);
}

// The jira-rework hook, after an agent's transition (plan, decision 2): when that move was a rework and the item has
// now gone back as many times as policies.yaml allows, the agent must flag the item through MCP and stop, since its
// token cannot write over REST. histories: the `values` of GET /issue/{key}/changelog, in any order.
export function reworkDecision({ histories, item, contract, mapping }) {
  const workType = contract.work_types.find(({ jira_issue_type: type }) => type === item.type)?.id;
  if (!workType || item.labels.includes(mapping.needs_you_label)) return { block: false };
  const context = { contract, mapping, workType };
  const ordered = histories.toSorted((a, b) => jiraTime(a.created) - jiraTime(b.created));
  const last = ordered.filter(({ items }) => items.some(({ field }) => field === 'status')).at(-1);
  if (!last || countRework([last], context) === 0) return { block: false };
  const { count, limitReached } = reworkStatus(ordered, context);
  if (!limitReached) return { block: false };
  return {
    block: true,
    reason: `jira-rework: ${item.key} went back ${count} times, the limit in policies.yaml. Through the atlassian MCP server: set Flagged on ${item.key}, add the label ${mapping.needs_you_label}, and comment why it keeps going back. Then stop and wait for the human.`,
  };
}
