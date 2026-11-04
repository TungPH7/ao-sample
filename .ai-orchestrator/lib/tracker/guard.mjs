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

// A link to one work item, as a PR body or a ledger has it: it ends at the key, before a space, the end of a line, a
// closing bracket or quote, or punctuation that ends a sentence. A link that goes on (a path, a query, ";", ".json")
// is not one of these.
const WORK_ITEM_LINK = /https?:\/\/[a-z0-9-]+\.atlassian\.net\/browse\/[a-z][a-z0-9_]*-\d+(?=$|[\s)\]>"'`]|[.,:!?](?:$|[\s)\]>"'`]))/gim;
const NETWORK_CLIENT = /\b(?:curl|wget|iwr|irm|axios|urllib|httpie|openssl|ncat|nc|telnet|socat)\b|\bhttp\.client\b|Invoke-(?:WebRequest|RestMethod)|WebClient|HttpClient|\bfetch\s*\(|\brequests\.(?:get|post|put|patch|delete|request|Session)\b|\bhttps?\.(?:get|request)\b/i;

// The first line of a heredoc whose body is data: cat or tee writing to a file, after simple commands only, with the
// delimiter quoted so the shell expands nothing in the body, and nothing after it on the line but where it writes.
// Returns { dash, delimiter }, or null.
const PATH = String.raw`(?:[^\s"'\`$()<>;&|]+|"[^"\`$\n]*"|'[^'\n]*')`;
const SIMPLE = String.raw`(?:[^"'\`$()\n;&|]|"[^"\`$\n]*"|'[^'\n]*')*`;
// The spaces after a separator are SIMPLE's to read, not a \s* of their own: two ways to read them made the regex
// backtrack exponentially on "a; a; a; …" (second review of ao-sample PR #13).
const HEAD = new RegExp(String.raw`^(?:${SIMPLE}(?:&&|;))*\s*(cat|tee)\b(.*)$`);
const REDIRECT = new RegExp(String.raw`^\s*(>>?\s*${PATH})?\s*$`);
const TEE_FILE = new RegExp(String.raw`^\s+(?:-a\s+)?${PATH}\s*$`);

function dataHeredoc(line) {
  const operator = line.match(/<<(-?)\s*(['"])(\w+)\2/);
  if (!operator) return null;
  const head = line.slice(0, operator.index).match(HEAD);
  const after = line.slice(operator.index + operator[0].length);
  if (!head) return null;
  const [, tool, args] = head;
  if (tool === 'cat') {
    const [before, behind] = [args.match(REDIRECT), after.match(REDIRECT)];
    if (!before || !behind || !(before[1] || behind[1])) return null;
  } else if (!TEE_FILE.test(args) || !/^\s*(?:>\s*\/dev\/null)?\s*$/.test(after)) return null;
  return { dash: operator[1] === '-', delimiter: operator[3] };
}

// The command without the body of the data heredoc that opens it, when there is one and it is closed.
function withoutDataBody(command) {
  const lines = command.split('\n');
  const heredoc = dataHeredoc(lines[0]);
  if (!heredoc) return command;
  const end = lines.findIndex((line, i) => i > 0 && (heredoc.dash ? line.replace(/^\t+/, '') : line) === heredoc.delimiter);
  return end < 0 ? command : [lines[0], ...lines.slice(end)].join('\n');
}

// A Bash command reaches Atlassian when it says "atlassian" anywhere, as in $ATLASSIAN_AGENT_TOKEN or a site, but for
// two kinds of text: the body of a data heredoc (cat or tee to a file, its delimiter quoted), and links to one work item
// in a command that runs no network client. block-atlassian refused four such writes in Pilot 1 (SMP-2, SMP-5, SMP-6);
// the review of ao-sample PR #13 showed that cutting links out before looking for a network client, or letting the
// word through elsewhere, let a link reach the REST API and the token be printed.
export function reachesAtlassian(command) {
  if (NETWORK_CLIENT.test(command)) return /atlassian/i.test(command);
  return /atlassian/i.test(withoutDataBody(command).replace(WORK_ITEM_LINK, ''));
}

// The site of the project: its cloud id, or its host name alone or in a URL. A text that only contains the host name,
// as in a query, is not (review of ao-sample PR #13).
function isProjectSite(cloudId, mapping) {
  const text = String(cloudId ?? '');
  if (text === mapping.cloud_id) return true;
  try {
    return Boolean(mapping.site) && new URL(text.includes('://') ? text : `https://${text}`).hostname === mapping.site.toLowerCase();
  } catch {
    return false;
  }
}

// The block-atlassian hook (spec section 2.6, plan task T14): no Atlassian call from Bash, no Atlassian tool of another
// server, no generic write tool, and writes only on the project space (Jira Free has no permission scheme, so the
// agent token could write to every space of the site). space is AO_JIRA_SPACE, set per project.
export function checkToolCall(input, { mapping, space }) {
  const deny = (reason) => ({ allow: false, reason: `jira: ${reason}` });
  const allow = { allow: true };
  const { tool_name: tool, tool_input: args = {} } = input;
  if (tool === 'Bash') return reachesAtlassian(args.command ?? '') ? deny('do not call Atlassian from Bash; use the tools of the atlassian MCP server') : allow;
  if (!tool.startsWith('mcp__')) return allow;
  if (!tool.startsWith(SERVER)) return /atlassian/i.test(tool) ? deny(`use the atlassian MCP server of the project, not ${tool}`) : allow;

  const name = tool.slice(SERVER.length);
  if (name === 'executeWrite' && args.name === LINK_OPERATION) return checkLink(args, { mapping, space, deny, allow });
  if (ANY_WRITE.includes(name)) return deny(`${name} can run any write; use ${WRITE_TOOLS.slice(0, -1).join(', ')} or ${WRITE_TOOLS.at(-1)}`);
  if (!WRITE_TOOLS.includes(name)) return allow;
  if (!space) return deny('set AO_JIRA_SPACE to the project space key in .claude/settings.json');
  if (args.cloudId && !isProjectSite(args.cloudId, mapping)) return deny(`${args.cloudId} is not the Jira site of the project`);
  if (name === 'createJiraIssue') return args.projectKey === space ? allow : deny(`${args.projectKey} is outside the project space ${space}`);
  const [key] = extractKeys(String(args.issueIdOrKey ?? ''));
  if (!key) return deny(`use the work item key, not ${args.issueIdOrKey}, so the project space can be checked`);
  return key.startsWith(`${space}-`) ? allow : deny(`${key} is outside the project space ${space}`);
}

// The one operation executeWrite may run: a Blocks link between two items of the project space, which `ba` makes from
// the dependencies of the plan. The server has no tool of its own for it: addGraphContext needs the scope
// write:all:twg, which the agent token does not have (Pilot 1, T10). A link moves no item, so it does not go around
// jira-guard; only the inputs below are let through, since the server routes any other input into the request.
const LINK_OPERATION = 'createJiraIssueLink';
const LINK_ARGS = ['cloudId', 'name', 'inputs', 'responseFields'];
const LINK_INPUTS = ['cloudId', 'linkType', 'inwardIssue', 'outwardIssue'];

function checkLink(args, { mapping, space, deny, allow }) {
  const inputs = args.inputs ?? {};
  const extra = [...Object.keys(args).filter((key) => !LINK_ARGS.includes(key)), ...Object.keys(inputs).filter((key) => !LINK_INPUTS.includes(key))];
  if (extra.length > 0) return deny(`${LINK_OPERATION} takes only ${LINK_INPUTS.join(', ')}, not ${extra.join(', ')}`);
  if (!space) return deny('set AO_JIRA_SPACE to the project space key in .claude/settings.json');
  // The server needs the cloudId of executeWrite itself; the one in the inputs may be left out.
  for (const cloudId of [args.cloudId, ...(inputs.cloudId === undefined ? [] : [inputs.cloudId])]) {
    if (!isProjectSite(cloudId, mapping)) return deny(`${cloudId ?? 'no cloudId'} is not the Jira site of the project`);
  }
  if (!/^blocks$/i.test(String(inputs.linkType ?? ''))) return deny(`${LINK_OPERATION} may only make a Blocks link, not ${inputs.linkType}`);
  const keys = [inputs.inwardIssue, inputs.outwardIssue].map((key) => String(key ?? ''));
  const outside = keys.filter((key) => !new RegExp(`^${space}-\\d+$`).test(key));
  if (outside.length > 0) return deny(`${outside.join(', ')} is not a work item key of the project space ${space}`);
  return keys[0] === keys[1] ? deny(`${keys[0]} cannot block itself`) : allow;
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
