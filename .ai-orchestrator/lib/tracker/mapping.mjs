// Mapping of the SDLC contract to Jira (tracker-integration spec section 2.3), and its rules J1–J4 (spec section 7).
// Like lib/contract.mjs, only readMapping touches the disk.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { schemaErrors } from '../rules/schema.mjs';

const schema = JSON.parse(readFileSync(new URL('../../tracker/schema/jira.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv({ allErrors: true }).compile(schema);

export function readMapping(dir = 'tracker') {
  const file = join(dir, 'jira.yaml');
  try {
    return parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error });
  }
}

// Returns every rule violation as { rule, path, message }; the contract must already be valid.
export function validateMapping(mapping, contract) {
  if (!validateSchema(mapping)) return schemaErrors(mapping, validateSchema.errors, 'J1', 'tracker/jira.yaml');
  return [...checkCoverage(mapping, contract), ...checkNames(mapping), ...checkIdentities(mapping, contract)];
}

// Rule J2: everything the contract declares has a mapping, and the mapping names nothing the contract lacks.
// Work types are left out: work-items.yaml already gives their Jira issue type.
function checkCoverage(mapping, contract) {
  const errors = [];
  const cover = (path, expected, actual) => {
    for (const id of expected.filter((i) => !actual.includes(i))) errors.push({ rule: 'J2', path: `${path}.${id}`, message: 'has no mapping to Jira' });
    for (const id of actual.filter((i) => !expected.includes(i))) errors.push({ rule: 'J2', path: `${path}.${id}`, message: 'is not in the contract' });
  };
  const columns = mapping.board.columns.map(({ id }) => id);

  cover('workflows', Object.keys(contract.workflows), Object.keys(mapping.workflows));
  for (const [name, workflow] of Object.entries(contract.workflows)) {
    const mapped = mapping.workflows[name];
    if (!mapped) continue;
    const states = Object.keys(workflow.states);
    cover(`workflows.${name}.states`, states, Object.keys(mapped.states));
    cover(`workflows.${name}.transitions`, workflow.transitions.map(({ id }) => id), Object.keys(mapped.transitions));
    for (const [state, column] of Object.entries(mapped.board_columns ?? {})) {
      const path = `workflows.${name}.board_columns.${state}`;
      if (!states.includes(state)) errors.push({ rule: 'J2', path, message: `'${state}' is not a state of the workflow` });
      if (!columns.includes(column)) errors.push({ rule: 'J2', path, message: `'${column}' is not a board column` });
    }
  }

  cover('fields', contract.work_item_fields.map(({ id }) => id), Object.keys(mapping.fields));
  for (const { id, values = [] } of contract.work_item_fields) {
    const field = mapping.fields[id];
    if (field?.type === 'select' && values.length === 0) {
      errors.push({ rule: 'J2', path: `fields.${id}.type`, message: 'a select field needs the contract to list its values' });
    }
    // A value keeps its contract name on Jira unless `values` gives another one.
    for (const value of Object.keys(field?.values ?? {}).filter((v) => !values.some((known) => known.id === v))) {
      errors.push({ rule: 'J2', path: `fields.${id}.values.${value}`, message: 'is not a value of the contract field' });
    }
  }

  const contractColumns = [...new Set(Object.values(contract.workflows).flatMap(({ states }) => Object.values(states).map((s) => s.board_column)))];
  for (const column of contractColumns.filter((c) => c && !columns.includes(c))) {
    errors.push({ rule: 'J2', path: 'board.columns', message: `board column '${column}' has no mapping to Jira` });
  }
  for (const { id, wip_limit: limit } of mapping.board.columns) {
    const path = `board.columns[id=${id}]`;
    if (!contractColumns.includes(id)) errors.push({ rule: 'J2', path, message: 'is not a board column of the contract' });
    if (limit && !contract.wip_limits.some((wip) => wip.id === limit)) {
      errors.push({ rule: 'J2', path: `${path}.wip_limit`, message: `unknown WIP limit '${limit}'` });
    }
  }

  cover('environments', contract.environments.map(({ id }) => id), Object.keys(mapping.environments));
  return errors;
}

// Rule J3: Jira names stay unambiguous. Within a workflow, statuses and transitions have distinct names; a status
// shared by several workflows keeps one category, since Jira statuses are global; board columns have distinct names.
function checkNames(mapping) {
  const errors = [];
  const categoryOf = new Map();
  for (const [name, { states, transitions }] of Object.entries(mapping.workflows)) {
    const seen = new Map();
    for (const [state, { status, category }] of Object.entries(states)) {
      if (seen.has(status)) {
        errors.push({ rule: 'J3', path: `workflows.${name}.states.${state}.status`, message: `status '${status}' is already used by '${seen.get(status)}'` });
      }
      seen.set(status, state);
      const first = categoryOf.get(status);
      if (!first) {
        categoryOf.set(status, { category, at: `workflows.${name}` });
      } else if (first.category !== category) {
        errors.push({
          rule: 'J3',
          path: `workflows.${name}.states.${state}.category`,
          message: `status '${status}' is '${first.category}' in ${first.at}, a Jira status has one category`,
        });
      }
    }
    // Each id is one contract transition, so a shared name here is two different transitions.
    const named = new Map();
    for (const [id, { name: label }] of Object.entries(transitions)) {
      if (named.has(label)) {
        errors.push({ rule: 'J3', path: `workflows.${name}.transitions.${id}.name`, message: `transition name '${label}' is already used by '${named.get(label)}'` });
      }
      named.set(label, id);
    }
  }
  const columnNames = new Map();
  for (const { id, name } of mapping.board.columns) {
    if (columnNames.has(name)) errors.push({ rule: 'J3', path: `board.columns[id=${id}].name`, message: `column name '${name}' is already used by '${columnNames.get(name)}'` });
    columnNames.set(name, id);
  }
  return errors;
}

// Rule J4: every contract role belongs to exactly one identity, and identities name only contract roles.
function checkIdentities(mapping, contract) {
  const errors = [];
  const declared = new Set(contract.roles.map(({ id }) => id));
  const owner = new Map();
  for (const { id, roles } of mapping.identities) {
    const path = `identities[id=${id}].roles`;
    for (const role of roles) {
      if (!declared.has(role)) errors.push({ rule: 'J4', path, message: `unknown role '${role}'` });
      else if (owner.has(role)) errors.push({ rule: 'J4', path, message: `role '${role}' already belongs to identity '${owner.get(role)}'` });
      else owner.set(role, id);
    }
  }
  for (const role of declared) {
    if (!owner.has(role)) errors.push({ rule: 'J4', path: 'identities', message: `role '${role}' belongs to no identity` });
  }
  return errors;
}
