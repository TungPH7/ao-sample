// jira-sync (tracker-integration spec section 2.7): the work items a GitHub event concerns, each reconciled, then the
// changes made with the CI token. scripts/jira-sync.mjs only reads the event and builds the clients.
import { extractKeys, parseBranch } from './conventions.mjs';
import { planDorLine, tickDorLine } from './dor.mjs';
import { adfText } from './facts.mjs';
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
  if (event === 'deployment_status' && FAILED.includes(payload.deployment_status.state)) return deploymentFailed(payload, { jira, github, space });
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

// release-workflow spec 2.4, 2.9, 2.10: the deployer reports `failure` when a new release ran and failed its smoke
// test, and `error` when it refused a release before it ran.
const FAILED = ['failure', 'error'];
const BUG = 'create-bug';
const DEPLOY_FLAG = 'flag-failed-deployment';

// A failed deployment. On Production, a failure makes a Bug Critical, as the contract rule "Smoke test sau khi lên
// Production fail" says, once per deployment; an error makes none, since that release never ran. On Development and
// Staging, either flags the items the deployed commit names, as the rule "Deploy lên môi trường QA thất bại" says,
// once per deployment and item. `notes` say what was done before.
async function deploymentFailed(payload, { jira, github, space }) {
  const { deployment, deployment_status: status } = payload;
  const what = { id: deployment.id, sha: deployment.sha, environment: status.environment ?? deployment.environment, state: status.state, description: status.description ?? '' };
  const result = { keys: [], actions: [], waiting: [], kept: [], notes: [], failures: [] };
  if (what.environment === 'production') {
    if (what.state !== 'failure') return result;
    const label = `ao-deployment-${what.id}`;
    const [made] = await jira.searchAll(`project = "${space}" AND labels = "${label}"`, ['status']);
    if (made) {
      result.notes.push(`deployment ${what.id}: Bug ${made.key} was made for it already`);
      return result;
    }
    const version = (await github.getAll('/tags')).find(({ commit }) => commit.sha === what.sha)?.name ?? null;
    result.actions.push({ key: `deployment ${what.id}`, effect: BUG, deployment: what, version, label });
    return result;
  }
  const { commit } = await github.get(`/commits/${what.sha}`);
  result.keys = [...new Set(extractKeys(commit.message.split('\n', 1)[0]))].filter((key) => key.startsWith(`${space}-`));
  const marker = `jira-sync: deployment ${what.id} `;
  for (const key of result.keys) {
    try {
      const comments = await jira.getAll(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {}, 'comments');
      if (comments.some(({ body }) => adfText(body).startsWith(marker))) result.notes.push(`${key}: deployment ${what.id} flagged it already`);
      else result.actions.push({ key, effect: DEPLOY_FLAG, deployment: what });
    } catch (error) {
      result.failures.push({ key, error });
    }
  }
  return result;
}

// The Bug Critical of a failed release on Production. The issue type is found by its English name, since the CI
// account reads names in its own language (T1 of the plan); Affects versions is set when the release is a version on
// Jira. Returns a note naming the Bug.
async function createProductionBug({ deployment, version, label }, { jira, mapping, contract, space }) {
  const typeName = contract.work_types.find(({ id }) => id === 'bug').jira_issue_type;
  const types = await jira.getAll(`/rest/api/3/issue/createmeta/${encodeURIComponent(space)}/issuetypes`, {}, 'issueTypes');
  const type = types.find((t) => (t.untranslatedName ?? t.name) === typeName);
  if (!type) throw new Error(`${space} has no issue type ${typeName}`);
  const fields = await jira.get('/rest/api/3/field');
  const fieldId = (id) => {
    const name = mapping.fields[id].jira_field;
    const found = fields.find((field) => field.name === name);
    if (!found) throw new Error(`Jira has no field ${name}`);
    return found.id;
  };
  const valueName = (field, value) => contract.work_item_fields.find(({ id }) => id === field).values.find(({ id }) => id === value).name;
  const versions = version ? await jira.get(`/rest/api/3/project/${encodeURIComponent(space)}/versions`) : [];
  const known = versions.some(({ name }) => name === version);
  const short = deployment.sha.slice(0, 7);
  const lines = [
    `jira-sync: deployment ${deployment.id} of ${short} to production failed: ${deployment.description}.`,
    'The deployer kept the release that ran before. The contract rule "Smoke test sau khi lên Production fail" asks for this Bug Critical.',
    ...(version ? [] : [`No tag names ${short}, so Affects versions is empty.`]),
    ...(version && !known ? [`${version} is no version of ${space} on Jira, so Affects versions is empty.`] : []),
  ];
  const { key } = await jira.request('POST', '/rest/api/3/issue', {}, {
    fields: {
      project: { key: space },
      issuetype: { id: type.id },
      summary: `Smoke test failed on Production at ${version ?? short}`,
      description: { type: 'doc', version: 1, content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) },
      labels: [label],
      [fieldId('found-in')]: { value: valueName('found-in', 'production') },
      [fieldId('severity')]: { value: valueName('severity', 'critical') },
      ...(known ? { versions: [{ name: version }] } : {}),
    },
  });
  return `made ${key}`;
}

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
export async function applyAction(action, { jira, mapping, contract, space }) {
  if (action.effect === BUG) return createProductionBug(action, { jira, mapping, contract, space });
  if (action.effect === DEPLOY_FLAG) {
    const { id, sha, environment, state, description } = action.deployment;
    await raiseFlag(action.key, { jira, mapping });
    await jira.comment(
      action.key,
      `jira-sync: deployment ${id} of ${sha.slice(0, 7)} to ${environment} ${state === 'failure' ? 'failed' : 'was refused'}: ${description}. ${action.key} is flagged with the label ${mapping.needs_you_label} and waits for you.`,
    );
    return undefined;
  }
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

export function describe({ key, transition, name, from, to, effect, reworkCount, pr, merged, deployment, version }) {
  if (effect === BUG) return `Bug Critical for deployment ${deployment.id} (${version ?? deployment.sha.slice(0, 7)})`;
  if (effect === DEPLOY_FLAG) return `${key}: ${effect} (deployment ${deployment.id} to ${deployment.environment})`;
  if (transition) return `${key}: ${name} (${from} → ${to})`;
  if (effect === CLEAR) return `${key}: ${effect} (PR #${pr} ${merged ? 'merged' : 'closed'})`;
  return `${key}: ${effect} (rework ${reworkCount})`;
}

// Reconciles the event, prints what it finds and, unless dryRun, makes each change, then prints what the items still
// wait for. A failure does not stop the others; all of them are returned, so the caller can exit non-zero.
export async function runSync({ dryRun = false, log = console.log, ...context }) {
  const { keys, actions, waiting, kept, notes = [], failures } = await syncEvent(context);
  log(`${context.event}: ${keys.length > 0 ? keys.join(', ') : `no work item of ${context.space}`}`);
  for (const { key, error } of failures) log(`Failed ${key}: ${error.message}`);
  for (const { key, reason } of kept) log(`Kept ${key} flagged: ${reason}`);
  for (const note of notes) log(`Kept ${note}`);
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
