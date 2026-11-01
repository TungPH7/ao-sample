// Rule R6: the bug routing covers every location × severity exactly once.
// Severities are the values of the Severity field in work-items.yaml.

export function checkRouting(contract) {
  const severities = contract.work_item_fields.find(({ id }) => id === 'severity')?.values.map(({ id }) => id) ?? [];
  const errors = [];
  for (const { id, routes } of contract.bug_routing) {
    for (const severity of severities) {
      const count = routes.filter((route) => route.severities.includes(severity)).length;
      if (count === 1) continue;
      const message = count === 0 ? `no route for severity '${severity}'` : `${count} routes for severity '${severity}'`;
      errors.push({ rule: 'R6', path: `bug_routing[id=${id}].routes`, message });
    }
  }
  return errors;
}
