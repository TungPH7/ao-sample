// Rule R5: a transition that goes back to in-progress needs a guard with evidence and the effect
// increment-rework. "Back" follows the order states are declared in (plan, decision 4).

export function checkRework(contract) {
  const errors = [];
  for (const [name, workflow] of Object.entries(contract.workflows)) {
    const order = Object.keys(workflow.states);
    const target = order.indexOf('in-progress');
    if (target === -1) continue;

    for (const { id, from, to, guards = [], effects = [] } of workflow.transitions) {
      const goesBack = to === 'in-progress' && [from].flat().some((source) => order.indexOf(source) > target);
      if (!goesBack) continue;
      const at = `workflows.${name}.transitions[id=${id}]`;
      if (!guards.some((guard) => contract.guards[guard]?.evidence)) {
        errors.push({ rule: 'R5', path: `${at}.guards`, message: "goes back to 'in-progress' without a guard that has evidence" });
      }
      if (!effects.includes('increment-rework')) {
        errors.push({ rule: 'R5', path: `${at}.effects`, message: "goes back to 'in-progress' without the effect 'increment-rework'" });
      }
    }
  }
  return errors;
}
