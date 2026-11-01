// The Definition of Ready line jira-sync ticks when it refines an item (dev-workflow spec 2.9): "Thuộc Epic có plan đã
// duyệt", the part of DoR that automation checks for dor-met. The line comes from contract/work-items.yaml; the
// description is ADF, with the line either as a task item (Jira's editor) or as text that starts with [ ] (what agents
// write through MCP). Pure.

// The DoR line of `workType` that dor-met checks: its first clause is in the description of the guard dor-met. A Task's
// line adds "or approved by you directly" after a comma.
export function planDorLine(contract, workType) {
  const guard = contract.guards['dor-met'].description.toLowerCase();
  const dor = contract.work_types.find(({ id }) => id === workType)?.dor ?? [];
  return dor.find((line) => guard.includes(firstClause(line).toLowerCase()));
}

const firstClause = (line) => line.split(',')[0].trim();

// Returns { description, status }: 'ticked' with the new description, 'already' when the line is ticked, 'missing' when
// the description has no such line. The description given is never changed.
export function tickDorLine(description, line) {
  if (!description) return { description, status: 'missing' };
  const copy = structuredClone(description);
  const wanted = firstClause(line);
  let status = 'missing';
  const visit = (node) => {
    if (status !== 'missing' || !node || typeof node !== 'object') return;
    if (node.type === 'taskItem' && plain(node).trim().startsWith(wanted)) {
      status = node.attrs?.state === 'DONE' ? 'already' : 'ticked';
      node.attrs = { ...node.attrs, state: 'DONE' };
      return;
    }
    // The first text of a paragraph: [ ] or [x], then the line.
    if (node.type === 'paragraph' && node.content?.[0]?.type === 'text') {
      const first = node.content[0];
      const box = first.text.match(/^\s*\[([ xX])\]\s+/);
      if (box && first.text.slice(box[0].length).startsWith(wanted)) {
        status = box[1] === ' ' ? 'ticked' : 'already';
        first.text = first.text.replace(/\[ \]/, '[x]');
        return;
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(copy);
  return { description: status === 'ticked' ? copy : description, status };
}

// The text of an ADF node and everything in it.
const plain = (node) => (node.type === 'text' ? node.text : (node.content ?? []).map(plain).join(''));
