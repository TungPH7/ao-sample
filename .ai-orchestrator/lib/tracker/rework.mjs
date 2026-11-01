// Rework count of an item, counted from its status history (contract field rework-count, tracker-integration spec 2.4):
// the number of status changes that are contract transitions with the effect increment-rework.

// histories: the `values` of GET /rest/api/3/issue/{key}/changelog, or the `histories` of expand=changelog.
export function countRework(histories, { contract, mapping, workType }) {
  const [name, workflow] = Object.entries(contract.workflows).find(([, { applies_to: types }]) => types.includes(workType));
  const stateOf = new Map(Object.entries(mapping.workflows[name].states).map(([state, { status }]) => [status, state]));
  const reworks = workflow.transitions.filter(({ effects = [] }) => effects.includes('increment-rework'));

  return histories
    .flatMap(({ items }) => items.filter(({ field }) => field === 'status'))
    .filter(({ fromString, toString }) => {
      const from = stateOf.get(fromString);
      const to = stateOf.get(toString);
      return reworks.some((transition) => transition.to === to && [transition.from].flat().includes(from));
    }).length;
}

// The count, and the effect to add when it has reached the limit in policies.yaml.
export function reworkStatus(histories, context) {
  const count = countRework(histories, context);
  const { limit, on_limit: onLimit } = context.contract.rework;
  const limitReached = count >= limit;
  return { count, limit, limitReached, effects: limitReached ? [onLimit] : [] };
}
