// Rule R2: every workflow is a sound state graph. States named by initial, final, from and to are declared;
// every state is reachable from initial; every non-final state can reach a final state; final states have no way out.

export function checkGraph(contract) {
  const errors = [];
  for (const [name, workflow] of Object.entries(contract.workflows)) {
    const error = (path, message) => errors.push({ rule: 'R2', path: `workflows.${name}.${path}`, message });
    const states = new Set(Object.keys(workflow.states));
    const final = new Set(workflow.final);

    for (const state of [workflow.initial].filter((s) => !states.has(s))) error('initial', `'${state}' is not a declared state`);
    for (const state of workflow.final.filter((s) => !states.has(s))) error('final', `'${state}' is not a declared state`);

    const edges = [];
    for (const { id, from, to } of workflow.transitions) {
      for (const source of [from].flat()) {
        if (!states.has(source)) error(`transitions[id=${id}].from`, `'${source}' is not a declared state`);
        else if (states.has(to)) edges.push([source, to]);
      }
      if (!states.has(to)) error(`transitions[id=${id}].to`, `'${to}' is not a declared state`);
    }
    // Reachability means nothing until the start and end states exist.
    if (!states.has(workflow.initial) || workflow.final.some((s) => !states.has(s))) continue;

    const reachable = reach([workflow.initial], edges);
    const canFinish = reach(workflow.final, edges.map(([source, target]) => [target, source]));
    for (const state of states) {
      if (!reachable.has(state)) error(`states.${state}`, `is not reachable from '${workflow.initial}'`);
      if (!final.has(state) && !canFinish.has(state)) error(`states.${state}`, 'has no path to a final state');
      if (final.has(state)) {
        const outgoing = workflow.transitions.filter(({ from }) => [from].flat().includes(state)).map(({ id }) => id);
        if (outgoing.length > 0) error(`states.${state}`, `is final but has outgoing transitions: ${outgoing.join(', ')}`);
      }
    }
  }
  return errors;
}

function reach(starts, edges) {
  const seen = new Set(starts);
  const queue = [...starts];
  while (queue.length > 0) {
    const state = queue.shift();
    for (const [source, target] of edges) {
      if (source === state && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}
