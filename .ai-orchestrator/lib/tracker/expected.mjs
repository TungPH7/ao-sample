// What the Jira configuration must contain, derived from the contract and tracker/jira.yaml (tracker-integration spec
// sections 2.3 and 2.10). The setup checklist and jira:check both read the mapping through these functions.

// The groups whose identities hold one of these contract roles.
export function groupsOf(mapping, actors) {
  return mapping.identities.filter(({ roles }) => roles.some((role) => actors.includes(role))).map(({ group }) => group);
}

// Each contract workflow as Jira sees it, in contract order: its statuses, the status new items start in, and one Jira
// transition per `from`, with the groups that may make it, the Resolution it sets and whether it asks for one.
export function expectedWorkflows(contract, mapping) {
  return Object.entries(contract.workflows).map(([id, workflow]) => {
    const mapped = mapping.workflows[id];
    const status = (state) => mapped.states[state].status;
    return {
      id,
      name: mapped.jira_workflow,
      initial: status(workflow.initial),
      statuses: Object.keys(workflow.states).map((state) => ({ name: status(state), category: mapped.states[state].category })),
      transitions: workflow.transitions.flatMap(({ id: transition, from, to, actors }) => {
        const { name, set_resolution: setResolution, screen } = mapped.transitions[transition];
        const groups = groupsOf(mapping, actors);
        return [from].flat().map((source) => ({ name, from: status(source), to: status(to), groups, setResolution, asksResolution: screen === 'resolution' }));
      }),
    };
  });
}

// The board columns in mapping order, each with its statuses and WIP limit, and the statuses that stay off the board.
export function expectedBoard(contract, mapping) {
  const columnOf = new Map();
  const unplaced = new Set();
  for (const [name, workflow] of Object.entries(contract.workflows)) {
    const mapped = mapping.workflows[name];
    if (mapped.on_board === false) continue;
    for (const [state, { board_column: column }] of Object.entries(workflow.states)) {
      const status = mapped.states[state].status;
      const target = column ?? mapped.board_columns?.[state];
      if (!target) unplaced.add(status);
      else columnOf.set(target, [...new Set([...(columnOf.get(target) ?? []), status])]);
    }
  }
  return {
    columns: mapping.board.columns.map(({ id, name, wip_limit: wip }) => ({
      id,
      name,
      statuses: columnOf.get(id) ?? [],
      max: wip ? contract.wip_limits.find((limit) => limit.id === wip).limit : undefined,
    })),
    unplaced: [...unplaced],
  };
}

// The option names of a field with values, in contract order; the mapping may rename a value.
export function expectedOptions(contract, mapping, id) {
  const field = mapping.fields[id];
  return contract.work_item_fields.find((f) => f.id === id).values.map((value) => field.values?.[value.id] ?? value.name);
}

// The Resolution values of the contract, then the ones transitions set, once each.
export function expectedResolutions(contract, mapping) {
  const setByTransitions = Object.values(mapping.workflows).flatMap(({ transitions }) =>
    Object.values(transitions).map(({ set_resolution: name }) => name).filter(Boolean),
  );
  return [...new Set([...expectedOptions(contract, mapping, 'resolution'), ...setByTransitions])];
}
