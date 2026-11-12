// .ai-orchestrator/project.yaml (project-scaffold spec 2.1): the one file a project declares itself in. Its repos, its
// apps with their path, stack, dev command, port and health path, its Jira space, its GitHub repo and Apps, its
// optional roles, and its own allow rules for Claude Code. .claude/settings.json and the agents are rendered from it.
// Rules of the file: P1 the schema project.schema.json, kept next to this file so a project's copy of lib/ has it; P2
// exactly one repo, until the multi-repo module; P3 each app in a repo of the file; P4 each path inside its repo; P5
// optional roles the kit has; P6 dev commands that run with no shell; P7 one default port per app.
// checkProject compares the file with the rest of the project: C1 deploy.yaml, C2 package.json, C3 the folders.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { matchesGlob } from '../quality/glob.mjs';
import { readDeployConfig } from '../release/deploy-config.mjs';
import { schemaErrors } from '../rules/schema.mjs';
import { commandProblem } from '../workflow/preview.mjs';

export const PROJECT_FILE = '.ai-orchestrator/project.yaml';
const schema = JSON.parse(readFileSync(new URL('./project.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv({ allErrors: true }).compile(schema);
// The four scripts the build-test job runs (quality-gates spec 2.4).
export const REQUIRED_SCRIPTS = ['lint', 'typecheck', 'test:coverage', 'build'];

// Parses and checks the text of project.yaml. options.optionalRoles: the roles of the roster a project may turn on,
// none until C1 adds seo. Returns { config, errors }; config is null when the text holds no YAML document.
export function readProjectConfig(text, { optionalRoles = [] } = {}) {
  let config;
  try {
    config = parse(text);
  } catch (error) {
    return { config: null, errors: [{ rule: 'P1', path: 'project.yaml', message: `is not YAML: ${error.message.split('\n')[0]} (${PROJECT_FILE})` }] };
  }
  if (config == null) return { config: null, errors: [{ rule: 'P1', path: 'project.yaml', message: `is empty (${PROJECT_FILE})` }] };
  return { config, errors: validateProjectConfig(config, { optionalRoles }) };
}

// Every rule violation as { rule, path, message }. Schema errors come alone, since the other rules read a file of the
// right shape.
export function validateProjectConfig(config, { optionalRoles = [] } = {}) {
  if (!validateSchema(config)) {
    // An anyOf names each of its branches too: one error per path, the last, which is the anyOf itself.
    const byPath = new Map();
    for (const error of schemaErrors(config, validateSchema.errors, 'P1', PROJECT_FILE)) byPath.set(error.path, error);
    return [...byPath.values()];
  }
  const errors = [];
  const add = (rule, path, message) => errors.push({ rule, path, message: `${message} (${PROJECT_FILE})` });
  if (config.repos.length !== 1) add('P2', 'repos', `lists ${config.repos.length} repos: a project has exactly one repo until the multi-repo module`);
  const repos = new Set(config.repos.map(({ name }) => name));
  const seen = new Map();
  for (const [name, app] of Object.entries(config.apps)) {
    if (!repos.has(app.repo)) add('P3', `apps.${name}.repo`, `'${app.repo}' is not a repo of this file`);
    if (outside(app.path)) add('P4', `apps.${name}.path`, `${app.path} is not a path inside the repo`);
    const wrong = commandProblem(app.dev);
    if (wrong) add('P6', `apps.${name}.dev`, `${app.dev}: ${wrong}`);
    const other = seen.get(app.port.default);
    if (other) add('P7', `apps.${name}.port.default`, `${app.port.default} is the port of ${other} too`);
    else seen.set(app.port.default, name);
  }
  (config.roles?.optional ?? []).forEach((role, i) => {
    if (!optionalRoles.includes(role)) add('P5', `roles.optional[${i}]`, `'${role}' is not an optional role of the kit${optionalRoles.length ? ` (${optionalRoles.join(', ')})` : ': it has none yet'}`);
  });
  return errors;
}

const outside = (path) => /^([A-Za-z]:)?[\\/]/.test(path) || path.split(/[\\/]/).includes('..');

// What differs between project.yaml and the rest of the project, as { rule, path, message }. deployText: the text of
// .ai-orchestrator/deploy.yaml, or null when the project has none yet; packageJson: the root package.json, parsed;
// exists(path): whether a path relative to the repo exists.
export function checkProject({ config, deployText, packageJson, exists }) {
  const errors = [];
  const add = (rule, path, message) => errors.push({ rule, path, message });
  if (deployText != null) {
    const deploy = readDeployConfig(deployText);
    if (deploy.errors.length > 0) {
      for (const { message } of deploy.errors) add('C1', 'deploy.yaml', message);
    } else {
      // The deployer runs the apps of deploy.yaml; project.yaml says how they run here. They are the same apps.
      for (const [name, app] of Object.entries(config.apps)) {
        const deployed = deploy.config.apps[name];
        if (!deployed) {
          add('C1', `apps.${name}`, `${name} is in project.yaml but not in deploy.yaml`);
          continue;
        }
        if (deployed.port !== app.port.default) add('C1', `apps.${name}.port`, `${name} listens on ${app.port.default} in project.yaml and on ${deployed.port} in deploy.yaml`);
        if (deployed.health !== app.health) add('C1', `apps.${name}.health`, `${name} has health ${app.health} in project.yaml and ${deployed.health} in deploy.yaml`);
        if (Boolean(deployed.public) !== Boolean(app.public)) add('C1', `apps.${name}.public`, `${name} is ${app.public ? '' : 'not '}public in project.yaml but ${deployed.public ? '' : 'not '}in deploy.yaml`);
      }
      for (const name of Object.keys(deploy.config.apps)) {
        if (!Object.hasOwn(config.apps, name)) add('C1', `apps.${name}`, `${name} is in deploy.yaml but not in project.yaml`);
      }
    }
  }
  const scripts = packageJson?.scripts ?? {};
  for (const script of REQUIRED_SCRIPTS) {
    if (!scripts[script]) add('C2', `scripts.${script}`, `package.json has no ${script} script, which the build-test job of CI runs`);
  }
  const workspaces = Array.isArray(packageJson?.workspaces) ? packageJson.workspaces : (packageJson?.workspaces?.packages ?? []);
  for (const [name, app] of Object.entries(config.apps)) {
    if (!workspaces.some((glob) => matchesGlob(glob, app.path))) add('C2', `apps.${name}.path`, `${app.path} is not a workspace of package.json (${workspaces.join(', ') || 'none'})`);
  }
  for (const [name, app] of Object.entries(config.apps)) {
    if (!exists(app.path)) add('C3', `apps.${name}.path`, `${app.path} is not in the repo`);
  }
  return errors;
}
