// Reconciliation for jira-sync (tracker-integration spec section 2.7): from an item's state and the facts that hold
// now, the transitions automation makes, until none holds. A second run gives nothing more, so the next run makes up
// for a missed GitHub event. planMoves decides from the guards; reconcile reads the item and the facts.
import { allowedTransitions, checkTransition } from '../transitions.mjs';
import { githubGuards, jiraGuards, readItem } from './facts.mjs';
import { countRework } from './rework.mjs';

const ACTOR = 'automation';
// The effect of approve-plan, and the transition it makes on each child of the Epic (contract effects).
const CHILDREN_EFFECT = 'refine-children';
const CHILD_TRANSITION = 'refine';

// guards: ids of the guards that hold; reworkCount: before these moves; flagged: the item has the needs-you label.
// Returns the moves [{ transition, from, to }], the state and rework count after them, flag when the item must get
// flag-needs-you: the count has reached the limit of policies.yaml and the item is not flagged yet (plan, decision 2),
// and waiting: the transitions of automation from the last state that some guard allows already, with the guards
// still missing.
export function planMoves(contract, workType, { state, guards, reworkCount = 0, flagged = false }) {
  const order = Object.keys(workflowOf(contract, workType)[1].states);
  const goesBack = (from, to) => order.indexOf(to) < order.indexOf(from);
  const holding = (from) =>
    allowedTransitions(contract, workType, from).filter(({ id }) => checkTransition(contract, workType, id, { actor: ACTOR, facts: { guards } }).ok);

  const moves = [];
  let current = state;
  let count = reworkCount;
  while (moves.length < order.length) {
    // The first in contract order, except a forward move that a rework would undo at once: otherwise a PR that is
    // green but has changes asked would go back and forth on every run.
    const next = holding(current).find(({ to }) => goesBack(current, to) || !holding(to).some((back) => goesBack(to, back.to)));
    if (!next) break;
    const { effects } = checkTransition(contract, workType, next.id, { actor: ACTOR, facts: { guards, reworkCount: count } });
    if (effects.includes('increment-rework')) count += 1;
    moves.push({ transition: next.id, from: current, to: next.to });
    current = next.to;
  }
  const waiting = allowedTransitions(contract, workType, current)
    .filter(({ actors }) => actors.includes(ACTOR))
    .map(({ id, guards: needed }) => ({ transition: id, needed, missing: needed.filter((guard) => !guards.includes(guard)) }))
    .filter(({ needed, missing }) => missing.length > 0 && missing.length < needed.length)
    .map(({ transition, missing }) => ({ transition, missing }));
  return { moves, state: current, reworkCount: count, flag: count >= contract.rework.limit && !flagged, waiting };
}

// The changes automation makes on one item, in order, as actions: { key, transition, name, from, to } for a transition,
// where name is the Jira name, and { key, effect, reworkCount } for flag-needs-you. An Epic in a state reached with
// refine-children also gets refine on each child that meets DoR. waiting: [{ key, transition, name, missing }], see
// planMoves. github may be null; its guards then do not hold.
export async function reconcile(key, { jira, github, contract, mapping, approvers = [] }) {
  const item = await readItem(jira, key);
  const { workType, workflowId, state } = locate(item, contract, mapping);
  const workflow = contract.workflows[workflowId];
  const histories = await jira.getAll(`/rest/api/3/issue/${encodeURIComponent(item.key)}/changelog`);

  const needed = [...new Set(workflow.transitions.filter(({ actors }) => actors.includes(ACTOR)).flatMap(({ guards = [] }) => guards))];
  const guards = [
    ...(await jiraGuards(jira, { item, actor: ACTOR, needed, contract, mapping })),
    ...(github ? await githubGuards(github, { item, needed, contract, mapping, approvers }) : []),
  ];
  const plan = planMoves(contract, workType, {
    state,
    guards,
    reworkCount: countRework(histories, { contract, mapping, workType }),
    flagged: item.labels.includes(mapping.needs_you_label),
  });

  const nameOf = (id) => mapping.workflows[workflowId].transitions[id].name;
  const actions = plan.moves.map((move) => ({ key: item.key, ...move, name: nameOf(move.transition) }));
  if (plan.flag) actions.push({ key: item.key, effect: contract.rework.on_limit, reworkCount: plan.reworkCount });
  const entered = workflow.transitions.filter(({ to }) => to === state).flatMap(({ effects = [] }) => effects);
  if (entered.includes(CHILDREN_EFFECT)) actions.push(...(await refineChildren(item, { jira, contract, mapping })));
  const waiting = plan.waiting.map(({ transition, missing }) => ({ key: item.key, transition, name: nameOf(transition), missing }));
  return { actions, waiting };
}

// refine on each child of the Epic whose state allows it for automation and whose guards hold.
async function refineChildren(epic, { jira, contract, mapping }) {
  const actions = [];
  for (const { key, fields } of await jira.searchAll(`parent = "${epic.key}"`, ['issuetype', 'status'])) {
    const { workType, workflowId, state } = locate({ key, type: fields.issuetype.name, status: fields.status.name }, contract, mapping);
    const refine = allowedTransitions(contract, workType, state).find(({ id, actors }) => id === CHILD_TRANSITION && actors.includes(ACTOR));
    if (!refine) continue;
    const child = await readItem(jira, key);
    const guards = await jiraGuards(jira, { item: child, actor: ACTOR, needed: refine.guards, contract, mapping });
    if (!checkTransition(contract, workType, refine.id, { actor: ACTOR, facts: { guards } }).ok) continue;
    actions.push({ key, transition: refine.id, name: mapping.workflows[workflowId].transitions[refine.id].name, from: state, to: refine.to });
  }
  return actions;
}

// The work type, workflow and contract state of an item, from its Jira type and status.
function locate(item, contract, mapping) {
  const workType = contract.work_types.find(({ jira_issue_type: type }) => type === item.type)?.id;
  if (!workType) throw new Error(`${item.key} is a ${item.type}, which the contract does not know`);
  const [workflowId] = workflowOf(contract, workType);
  const { states, jira_workflow: jiraWorkflow } = mapping.workflows[workflowId];
  const state = Object.keys(states).find((id) => states[id].status === item.status);
  if (!state) throw new Error(`${item.key} has the status ${item.status}, which ${jiraWorkflow} does not map`);
  return { workType, workflowId, state };
}

function workflowOf(contract, workType) {
  const found = Object.entries(contract.workflows).find(([, { applies_to: types }]) => types.includes(workType));
  if (!found) throw new Error(`No workflow applies to work type '${workType}'`);
  return found;
}
