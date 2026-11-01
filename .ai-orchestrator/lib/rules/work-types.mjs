// Rule R8: every work type follows exactly one workflow.

export function checkWorkTypes(contract) {
  const errors = [];
  for (const { id } of contract.work_types) {
    const bound = Object.keys(contract.workflows).filter((name) => contract.workflows[name].applies_to.includes(id));
    if (bound.length === 1) continue;
    const message = bound.length === 0 ? 'no workflow applies to it' : `several workflows apply to it: ${bound.join(', ')}`;
    errors.push({ rule: 'R8', path: `work_types[id=${id}]`, message });
  }
  return errors;
}
