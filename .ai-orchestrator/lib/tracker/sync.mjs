// jira-sync (tracker-integration spec section 2.7): the work items a GitHub event concerns, each reconciled, then the
// changes made with the CI token. scripts/jira-sync.mjs only reads the event and builds the clients.
import { extractKeys, parseBranch } from './conventions.mjs';
import { planDorLine, tickDorLine } from './dor.mjs';
import { ciAccount, clearsMergeGateFlag } from './flags.mjs';
import { reconcile } from './reconcile.mjs';

const ACTOR = 'automation';
// The guard a deployment can make hold.
const DEPLOY_GUARD = 'qa-deployed';
const FLAG = 'flag-needs-you';
// The only option of Jira's Flagged field.
const FLAG_VALUE = 'Impediment';

// The keys of the items in the project space that an event concerns. A PR event concerns the item of its branch and
// title; a successful deployment, every item in a state that a deployment can move on, found with JQL.
export async function itemsOf(event, payload, { jira, contract, mapping, space }) {
  const inSpace = (keys) => [...new Set(keys.filter(Boolean))].filter((key) => key.startsWith(`${space}-`));
  const ofBranch = (name) => parseBranch(name ?? '')?.key;
  switch (event) {
    case 'pull_request':
    case 'pull_request_review':
      return inSpace([ofBranch(payload.pull_request.head.ref), ...extractKeys(payload.pull_request.title ?? '')]);
    case 'workflow_run':
      return inSpace([ofBranch(payload.workflow_run.head_branch)]);
    case 'workflow_dispatch':
      return inSpace(extractKeys(payload.inputs?.item ?? '').slice(0, 1));
    case 'deployment_status':
      if (payload.deployment_status.state !== 'success') return [];
      return inSpace((await jira.searchAll(waitingForDeployment(contract, mapping, space), ['status'])).map(({ key }) => key));
    default:
      return [];
  }
}

// JQL for the items in the from-states of automation's transitions that need qa-deployed.
function waitingForDeployment(contract, mapping, space) {
  const statuses = Object.entries(contract.workflows).flatMap(([id, { transitions }]) =>
    transitions
      .filter(({ actors, guards = [] }) => actors.includes(ACTOR) && guards.includes(DEPLOY_GUARD))
      .flatMap(({ from }) => [from].flat().map((state) => mapping.workflows[id].states[state].status)),
  );
  return `project = "${space}" AND status in (${[...new Set(statuses)].map((status) => `"${status}"`).join(', ')})`;
}

// The changes for the items of an event, in order, what they still wait for, and the items that could not be
// reconciled. A change on an item outside the space, like a child of an Epic in another space, is dropped. A PR that
// closes moves no item: it only clears the Needs you flag merge-gate raised for it (dev-workflow spec 2.7); `kept`
// says why a flag stays.
export async function syncEvent({ event, payload, jira, github, contract, mapping, space, approvers = [] }) {
  const keys = await itemsOf(event, payload, { jira, contract, mapping, space });
  const actions = [];
  const waiting = [];
  const kept = [];
  const failures = [];
  const closing = event === 'pull_request' && payload.action === 'closed';
  for (const key of keys) {
    try {
      if (closing) {
        const pr = payload.pull_request;
        const decision = await flagClearing(key, pr.number, { jira, mapping });
        if (decision.clear) actions.push({ key, effect: CLEAR, pr: pr.number, merged: Boolean(pr.merged) });
        else if (decision.reason !== NOT_FLAGGED) kept.push({ key, reason: decision.reason });
        continue;
      }
      const found = await reconcile(key, { jira, github, contract, mapping, approvers });
      actions.push(...found.actions.filter((action) => action.key.startsWith(`${space}-`)));
      waiting.push(...found.waiting);
    } catch (error) {
      failures.push({ key, error });
    }
  }
  return { keys, actions, waiting, kept, failures };
}

const CLEAR = 'clear-needs-you';
const NOT_FLAGGED = 'it is not flagged';

// Reads what clearsMergeGateFlag needs: the item's labels, comments and changelog.
async function flagClearing(key, number, { jira, mapping }) {
  const path = `/rest/api/3/issue/${encodeURIComponent(key)}`;
  const { fields } = await jira.get(path, { fields: 'labels' });
  if (!(fields.labels ?? []).includes(mapping.needs_you_label)) return { clear: false, reason: NOT_FLAGGED };
  const comments = await jira.getAll(`${path}/comment`, {}, 'comments');
  const histories = await jira.getAll(`${path}/changelog`);
  return clearsMergeGateFlag({ comments, histories, item: { labels: fields.labels }, number, mapping, author: ciAccount(mapping) });
}

// Makes one change with a client made for writing. Returns a note on what it did besides, or nothing.
export async function applyAction(action, { jira, mapping, contract }) {
  if (action.transition) {
    await jira.transition(action.key, action.name);
    return action.transition === REFINE && contract ? tickPlanLine(action.key, { jira, contract }) : undefined;
  }
  if (action.effect === CLEAR) {
    await clearFlag(action.key, { jira, mapping });
    await jira.comment(action.key, `jira-sync: PR #${action.pr} was ${action.merged ? 'merged' : 'closed without merging'}, so the Needs you flag merge-gate raised for it is cleared.`);
    return;
  }
  if (action.effect !== FLAG) throw new Error(`jira-sync cannot make the effect ${action.effect}`);
  await raiseFlag(action.key, { jira, mapping });
  await jira.comment(
    action.key,
    `jira-sync: ${action.key} went back ${action.reworkCount} times, the limit in policies.yaml. It is flagged with the label ${mapping.needs_you_label} and waits for you.`,
  );
}

// After refine, the Definition of Ready line "Thuộc Epic có plan đã duyệt" is true: tick it in the description, or say
// on the item that there was none to tick (dev-workflow spec 2.9).
const REFINE = 'refine';

async function tickPlanLine(key, { jira, contract }) {
  const { fields } = await jira.get(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: 'description,issuetype,parent' });
  const workType = contract.work_types.find(({ jira_issue_type: type }) => type === fields.issuetype.name)?.id;
  const line = workType && planDorLine(contract, workType);
  if (!line) return undefined;
  const { description, status } = tickDorLine(fields.description, line);
  if (status === 'ticked') {
    await jira.editItem(key, { fields: { description } });
    return 'ticked its DoR line';
  }
  if (status === 'already') return 'its DoR line was ticked already';
  const epic = fields.parent?.key ? `the plan of ${fields.parent.key} is approved` : 'its plan is approved';
  await jira.comment(key, `jira-sync: ${key} is Ready: ${epic}. Its description has no Definition of Ready line "${firstClause(line)}" to tick.`);
  return 'its description has no DoR line to tick, so it got a comment';
}

const firstClause = (line) => line.split(',')[0].trim();

// The effect flag-needs-you without its comment: Jira's flag and the Needs you label. audit and merge-gate raise it too.
export async function raiseFlag(key, { jira, mapping }) {
  await jira.editItem(key, { fields: { [await flaggedField(jira, mapping)]: [{ value: FLAG_VALUE }] }, update: { labels: [{ add: mapping.needs_you_label }] } });
}

// Takes the flag and the Needs you label off.
export async function clearFlag(key, { jira, mapping }) {
  await jira.editItem(key, { fields: { [await flaggedField(jira, mapping)]: null }, update: { labels: [{ remove: mapping.needs_you_label }] } });
}

async function flaggedField(jira, mapping) {
  const name = mapping.fields.flagged.jira_field;
  const flagged = (await jira.get('/rest/api/3/field')).find((field) => field.name === name);
  if (!flagged) throw new Error(`Jira has no field ${name}`);
  return flagged.id;
}

export function describe({ key, transition, name, from, to, effect, reworkCount, pr, merged }) {
  if (transition) return `${key}: ${name} (${from} → ${to})`;
  if (effect === CLEAR) return `${key}: ${effect} (PR #${pr} ${merged ? 'merged' : 'closed'})`;
  return `${key}: ${effect} (rework ${reworkCount})`;
}

// Reconciles the event, prints what it finds and, unless dryRun, makes each change, then prints what the items still
// wait for. A failure does not stop the others; all of them are returned, so the caller can exit non-zero.
export async function runSync({ dryRun = false, log = console.log, ...context }) {
  const { keys, actions, waiting, kept, failures } = await syncEvent(context);
  log(`${context.event}: ${keys.length > 0 ? keys.join(', ') : `no work item of ${context.space}`}`);
  for (const { key, error } of failures) log(`Failed ${key}: ${error.message}`);
  for (const { key, reason } of kept) log(`Kept ${key} flagged: ${reason}`);
  for (const action of actions) {
    if (dryRun) {
      log(`Would make ${describe(action)}`);
      continue;
    }
    try {
      const note = await applyAction(action, context);
      log(`Made ${describe(action)}${note ? `; ${note}` : ''}`);
    } catch (error) {
      failures.push({ key: action.key, error });
      log(`Failed ${describe(action)}: ${error.message}`);
    }
  }
  for (const { key, name, missing } of waiting) log(`Waiting ${key}: ${name} needs ${missing.join(', ')}`);
  if (keys.length > 0 && actions.length === 0) log('No change');
  return { keys, actions, waiting, failures };
}
