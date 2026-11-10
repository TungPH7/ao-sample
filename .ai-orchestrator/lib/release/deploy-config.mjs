// .ai-orchestrator/deploy.yaml (release-workflow spec 2.3): how the deployer builds, runs and smoke-tests the apps of a
// project. The deployer reads the file at the commit it deploys, so readDeployConfig takes the text, never a path.
// Rules: D1 the schema deploy.schema.json, kept next to this file so a project's copy of lib/ has it; D2 exactly one
// public app; D3 each smoke check names an app of the file; D4 no variable name the deployer keeps for itself; D5 each
// Dockerfile inside the repo.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { schemaErrors } from '../rules/schema.mjs';

const FILE = '.ai-orchestrator/deploy.yaml';
const schema = JSON.parse(readFileSync(new URL('./deploy.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv({ allErrors: true }).compile(schema);

// The deployer sets AO_PUBLIC_URL on the public app itself, and keeps every AO_ name for such variables.
const RESERVED_ENV = /^AO_/;

// Parses and checks the text of deploy.yaml. Returns { config, errors }; config is null when the text holds no YAML
// document.
export function readDeployConfig(text) {
  let config;
  try {
    config = parse(text);
  } catch (error) {
    return { config: null, errors: [{ rule: 'D1', path: 'deploy.yaml', message: `is not YAML: ${error.message} (${FILE})` }] };
  }
  if (config == null) return { config: null, errors: [{ rule: 'D1', path: 'deploy.yaml', message: `is empty (${FILE})` }] };
  return { config, errors: validateDeployConfig(config) };
}

// Returns every rule violation as { rule, path, message }. Schema errors come alone, since the other rules read a file
// of the right shape.
export function validateDeployConfig(config) {
  if (!validateSchema(config)) return schemaErrors(config, validateSchema.errors, 'D1', FILE);
  const errors = [];
  const apps = Object.entries(config.apps);

  const open = apps.filter(([, app]) => app.public).map(([name]) => name);
  if (open.length !== 1) {
    const found = open.length === 0 ? 'no app is public' : `${open.join(' and ')} are all public`;
    errors.push({ rule: 'D2', path: 'apps', message: `${found}: exactly one app is public, the one Caddy serves (${FILE})` });
  }
  config.smoke.forEach(({ app }, i) => {
    if (!Object.hasOwn(config.apps, app)) errors.push({ rule: 'D3', path: `smoke[${i}].app`, message: `'${app}' is not an app of this file (${FILE})` });
  });
  for (const [name, app] of apps) {
    (app.env ?? []).forEach((variable, i) => {
      if (RESERVED_ENV.test(variable)) {
        errors.push({ rule: 'D4', path: `apps.${name}.env[${i}]`, message: `${variable}: names that start with AO_ belong to the deployer (${FILE})` });
      }
    });
    if (app.dockerfile.split('/').includes('..')) {
      errors.push({ rule: 'D5', path: `apps.${name}.dockerfile`, message: `${app.dockerfile} climbs out of the repo (${FILE})` });
    }
  }
  return errors;
}
