// Rule R7: every artifact's template exists in templates/, and every file there is the template of an artifact.
// readContract lists the files of templates/, so this rule never touches the disk.

export function checkTemplates(contract) {
  const errors = [];
  const files = new Set(contract.template_files.map((file) => `templates/${file}`));
  const used = new Set(contract.artifacts.map(({ template }) => template));
  for (const { id, template } of contract.artifacts) {
    if (!files.has(template)) errors.push({ rule: 'R7', path: `artifacts[id=${id}].template`, message: `${template} does not exist` });
  }
  for (const file of files) {
    if (!used.has(file)) errors.push({ rule: 'R7', path: 'template_files', message: `${file} is not the template of any artifact` });
  }
  return errors;
}
