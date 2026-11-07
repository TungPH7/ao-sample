// The deployer's own record of a project, /var/lib/ao/<project>/state.json (release-workflow plan, decision 3): the
// deployer trusts it, not the deployments on GitHub, for what passed Staging and what a rollback may go back to.
// - branches: per branch, the newest commit audited or that you approved by a deployment request, and the PR it merged;
// - environments: per environment, the release running, every run with whether its smoke test passed, the head of each
//   branch already decided, and the deploy under way, so a tick cut short is finished by the next one;
// - requests: the deployment requests already handled.
import { ENVIRONMENTS } from './targets.mjs';

const RUNS = 100; // runs kept per environment
const REQUESTS = 200; // handled requests kept

const emptyEnvironment = () => ({ current: null, runs: [], seen: {}, pending: null });

export function emptyState() {
  return { version: 1, branches: {}, environments: Object.fromEntries(ENVIRONMENTS.map((env) => [env, emptyEnvironment()])), requests: [] };
}

// The record from the text of state.json; an empty record when there is no file yet.
export function readState(text) {
  if (!text) return emptyState();
  const state = JSON.parse(text);
  if (state.version !== 1) throw new Error(`state.json has version ${state.version}; this deployer reads version 1`);
  return state;
}

export const stateText = (state) => `${JSON.stringify(state, null, 2)}\n`;

// The starting point (T1 of the plan): today's heads of develop, main and the open release branches count as audited
// and already decided, so the first tick neither audits old history nor deploys it.
export function baseline(state, { develop, main, releases }) {
  const heads = { develop, main, ...releases };
  for (const [branch, sha] of Object.entries(heads)) state.branches[branch] = { audited: sha, pull: null };
  state.environments.development.seen.develop = develop;
  Object.assign(state.environments.staging.seen, { main, ...releases });
  state.environments.production.seen.main = main;
  return state;
}

export const hasBaseline = (state) => Boolean(state.branches.develop?.audited);

// The runs of each environment, the record decideTarget reads.
export const runsByEnvironment = (state) => Object.fromEntries(ENVIRONMENTS.map((env) => [env, state.environments[env].runs]));

// Adds a run; one whose smoke test passed becomes the release running there, with its public app and port for Caddy.
export function recordRun(state, env, { sha, tree, ok, via, branch, at, public: open }) {
  const record = state.environments[env];
  record.runs.push({ sha, tree, ok, via, at });
  if (record.runs.length > RUNS) record.runs.splice(0, record.runs.length - RUNS);
  if (ok) record.current = { sha, tree, branch, ...(open && { public: open }) };
}

export function markRequest(state, id) {
  if (!state.requests.includes(id)) state.requests.push(id);
  if (state.requests.length > REQUESTS) state.requests.splice(0, state.requests.length - REQUESTS);
}
