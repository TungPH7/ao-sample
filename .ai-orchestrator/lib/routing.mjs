// Where a bug is fixed and tested (spec section 2.6). `affects` is the location of the oldest version with the bug.
// Returns the Fix Version rule, not a version number: release-workflow computes the number.

export function routeBug(contract, { affects, severity }) {
  const location = contract.bug_routing.find(({ id }) => id === affects);
  if (!location) throw new Error(`No bug routing for location '${affects}'`);
  const route = location.routes.find(({ severities }) => severities.includes(severity));
  if (!route) throw new Error(`No bug route for severity '${severity}' at '${affects}'`);
  return { fixVersion: route.fix_version, baseBranch: route.base_branch, qaEnvironments: [...route.qa_environments] };
}
