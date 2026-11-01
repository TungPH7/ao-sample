// Pure queries over a work type's workflow (spec section 6). Guards are not evaluated here:
// the caller passes the ids of the guards that hold in `facts.guards`.

export function allowedTransitions(contract, workType, state) {
  return workflowFor(contract, workType)
    .transitions.filter(({ from }) => [from].flat().includes(state))
    .map(({ id, to, actors, guards = [] }) => ({ id, to, actors, guards }));
}

// facts: { guards: ids of the guards that hold, reworkCount: the item's Rework count before this transition }
export function checkTransition(contract, workType, transitionId, { actor, facts }) {
  const transition = workflowFor(contract, workType).transitions.find(({ id }) => id === transitionId);
  if (!transition) throw new Error(`No transition '${transitionId}' in the workflow of '${workType}'`);

  const actorAllowed = transition.actors.includes(actor);
  const missingGuards = (transition.guards ?? []).filter((guard) => !facts.guards.includes(guard));
  const ok = actorAllowed && missingGuards.length === 0;
  return { ok, actorAllowed, missingGuards, effects: ok ? effectsOf(contract, transition, facts.reworkCount ?? 0) : [] };
}

function effectsOf(contract, transition, reworkCount) {
  const effects = [...(transition.effects ?? [])];
  const { limit, on_limit: onLimit } = contract.rework;
  if (effects.includes('increment-rework') && reworkCount + 1 >= limit) effects.push(onLimit);
  return effects;
}

function workflowFor(contract, workType) {
  const workflow = Object.values(contract.workflows).find(({ applies_to: types }) => types.includes(workType));
  if (!workflow) throw new Error(`No workflow applies to work type '${workType}'`);
  return workflow;
}
