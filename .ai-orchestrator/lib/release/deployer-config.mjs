// /etc/ao/deployer.yaml (release-workflow spec 2.3, 2.11): what the deployer on the VPS deploys. Rules: V1 the schema
// deployer.schema.json next to this file; V2 no two projects share a name, a repository or a host.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { schemaErrors } from '../rules/schema.mjs';
import { ENVIRONMENTS } from './targets.mjs';

const FILE = 'deployer.yaml';
const schema = JSON.parse(readFileSync(new URL('./deployer.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv({ allErrors: true }).compile(schema);

// Returns every rule violation as { rule, path, message }; schema errors come alone.
export function validateDeployerConfig(config) {
  if (!validateSchema(config)) return schemaErrors(config, validateSchema.errors, 'V1', FILE);
  const errors = [];
  const seen = { name: new Map(), repo: new Map(), host: new Map() };
  const once = (kind, value, path) => {
    if (seen[kind].has(value)) errors.push({ rule: 'V2', path, message: `${value} is also at ${seen[kind].get(value)} (${FILE})` });
    else seen[kind].set(value, path);
  };
  config.projects.forEach((project, i) => {
    once('name', project.name, `projects[${i}].name`);
    once('repo', project.repo, `projects[${i}].repo`);
    for (const env of ENVIRONMENTS) once('host', project.hosts[env], `projects[${i}].hosts.${env}`);
  });
  return errors;
}
