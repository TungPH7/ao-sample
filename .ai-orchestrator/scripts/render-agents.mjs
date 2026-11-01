// Generates the agents and the shared rules file (agent-roster spec 2.1, 2.6) from agents/, the contract,
// quality/gates.yaml and tracker/jira.yaml. --check writes nothing and fails when a generated file is stale.
// In the kit repo it writes kit/.claude/. With --project <dir> it reads the kit copy in <dir>/.ai-orchestrator/, adds the
// stack skills of its roster.local.yaml, takes the space key from AO_JIRA_SPACE in <dir>/.claude/settings.json, and
// writes <dir>/.claude/.
// Usage: node scripts/render-agents.mjs [--check] [--project <dir>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { renderAll } from '../lib/agents/render.mjs';
import { mergeLocal, readRoster } from '../lib/agents/roster.mjs';
import { readContract } from '../lib/contract.mjs';
import { readGates } from '../lib/quality/gates.mjs';
import { readMapping } from '../lib/tracker/mapping.mjs';

const { values } = parseArgs({ options: { check: { type: 'boolean' }, project: { type: 'string' } } });
const project = values.project ? resolve(values.project) : null;
const kitDir = project ? join(project, '.ai-orchestrator') : fileURLToPath(new URL('..', import.meta.url));
const outDir = project ? join(project, '.claude') : join(kitDir, 'kit', '.claude');
const where = project ? '.claude/' : 'kit/.claude/';

let roster = readRoster(join(kitDir, 'agents'));
let space;
if (project) {
  const localFile = join(kitDir, 'roster.local.yaml');
  const local = existsSync(localFile) ? parse(readFileSync(localFile, 'utf8')) : undefined;
  const merged = mergeLocal(roster, local, { skillExists: (name) => existsSync(join(project, '.claude', 'skills', name, 'SKILL.md')) });
  if (merged.errors.length > 0) {
    for (const error of merged.errors) console.error(error);
    process.exit(1);
  }
  roster = merged.roster;
  const settings = join(project, '.claude', 'settings.json');
  const key = existsSync(settings) ? JSON.parse(readFileSync(settings, 'utf8')).env?.AO_JIRA_SPACE : undefined;
  if (key && key !== '<KEY>') space = key;
}

const sources = {
  roster,
  contract: readContract(join(kitDir, 'contract')),
  gates: readGates(join(kitDir, 'quality')),
  mapping: readMapping(join(kitDir, 'tracker')),
  prompts: Object.fromEntries(Object.keys(roster.roles).map((role) => [role, readFileSync(join(kitDir, 'agents', 'prompts', `${role}.md`), 'utf8')])),
  rules: readFileSync(join(kitDir, 'agents', 'rules.md'), 'utf8'),
  space,
};

const files = renderAll(sources);
const stale = [...files].filter(([path, text]) => {
  const file = join(outDir, path);
  return !existsSync(file) || readFileSync(file, 'utf8') !== text;
});

if (values.check) {
  if (stale.length === 0) console.log(`${files.size} files up to date in ${where}`);
  else {
    for (const [path] of stale) console.error(`stale: ${where}${path}`);
    console.error(`Run ${project ? 'node .ai-orchestrator/scripts/render-agents.mjs --project .' : 'npm run agents'} and commit the result.`);
    process.exitCode = 1;
  }
} else {
  for (const [path, text] of stale) {
    mkdirSync(dirname(join(outDir, path)), { recursive: true });
    writeFileSync(join(outDir, path), text);
  }
  console.log(`Wrote ${stale.length} of ${files.size} files in ${where}`);
}
