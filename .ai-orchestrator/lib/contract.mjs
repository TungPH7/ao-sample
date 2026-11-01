// Read-only access to the SDLC contract (spec section 6). Every function except readContract is pure.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { checkAuthority } from './rules/authority.mjs';
import { checkGraph } from './rules/graph.mjs';
import { checkReferences } from './rules/references.mjs';
import { checkRework } from './rules/rework.mjs';
import { checkRouting } from './rules/routing.mjs';
import { CONTRACT_FILES, checkSchemas } from './rules/schema.mjs';
import { checkTemplates } from './rules/templates.mjs';
import { checkWorkTypes } from './rules/work-types.mjs';

export { routeBug } from './routing.mjs';
export { allowedTransitions, checkTransition } from './transitions.mjs';

// Run after R1 passes: they rely on the shape the schemas guarantee.
const RULES = [checkGraph, checkReferences, checkAuthority, checkRework, checkRouting, checkTemplates, checkWorkTypes];

// Merges the top-level keys of every contract file into one object, and adds the file names
// found in the templates folder next to `dir`, so the rules never touch the disk.
export function readContract(dir = 'contract') {
  const contract = {};
  for (const name of CONTRACT_FILES) {
    const file = join(dir, `${name}.yaml`);
    try {
      Object.assign(contract, parse(readFileSync(file, 'utf8')));
    } catch (error) {
      throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error });
    }
  }
  const templatesDir = join(dir, '..', 'templates');
  contract.template_files = existsSync(templatesDir) ? readdirSync(templatesDir).sort() : [];
  return contract;
}

// Returns every rule violation as { rule, path, message }; an empty list means the contract is valid.
export function validateContract(contract) {
  const schemaErrors = checkSchemas(contract);
  if (schemaErrors.length > 0) return schemaErrors;
  return RULES.flatMap((rule) => rule(contract));
}

export function loadContract(dir = 'contract') {
  const contract = readContract(dir);
  const errors = validateContract(contract);
  if (errors.length > 0) throw new Error(`Invalid contract in ${dir}:\n${errors.map(formatError).join('\n')}`);
  return deepFreeze(contract);
}

export function formatError({ rule, path, message }) {
  return `${rule} ${path}: ${message}`;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
