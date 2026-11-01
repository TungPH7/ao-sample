// The docs PR of an Epic (dev-workflow spec 2.4), for merge-gate and audit. Its documents go into develop through one
// PR, which you read and approve on Jira at the gate of quality/gates.yaml (docs_pull_requests), not on GitHub. So the
// PR needs no review report and no approval, as long as what is merged is what you read: the newest CI run of the docs
// branch is on its head and started before you moved the Epic through that gate. Every push to the PR starts a run, so
// a later push, even back to a commit you read, makes it a PR like any other. Pure, but readDocsFacts.
import { jiraTime } from '../tracker/facts.mjs';
import { docsRule, epicOfDocsBranch } from './gates.mjs';
import { matchesGlob } from './glob.mjs';

// The workflow whose run dates the head commit: the kit's kit/.github/workflows/ci.yml.
const CI_WORKFLOW = 'CI';

// The Epic of a docs PR, or null when it is not one: its head is the docs branch of an Epic of the project `space`
// (when given), the ao-dev App opened it, and every file it changes, by its old name too when renamed, matches the docs
// paths of that Epic. Whether the key is really an Epic is for docsConditions, which reads Jira.
export function docsPullRequest({ pr, files, gates, apps, space }) {
  const epic = epicOfDocsBranch(gates, pr.head?.ref ?? '');
  if (!epic || (space && !epic.startsWith(`${space}-`)) || pr.user?.login !== `${apps.dev}[bot]`) return null;
  const names = files.flatMap(({ filename, previous_filename: previous }) => (previous ? [previous, filename] : [filename]));
  const { paths } = docsRule(gates, epic);
  const inside = (name) => !name.split('/').includes('..') && paths.some((glob) => matchesGlob(glob, name));
  return names.length > 0 && names.every(inside) ? epic : null;
}

// How an Epic passes `gate`, from the contract: the stage of the gate, the human guard on that stage's artifacts, and the
// Epic transition with that guard. `past` lists the statuses only reachable through it (In Progress and Done for gate
// ②; Cancelled is reachable without it). Statuses and the transition name are Jira's, from tracker/jira.yaml.
export function gatePassage(contract, mapping, gate) {
  const stage = contract.stages.find((s) => s.gate === gate);
  if (!stage) throw new Error(`no stage of the contract ends at gate ${gate}`);
  const artifacts = stage.outputs?.artifacts ?? [];
  const guards = Object.entries(contract.guards)
    .filter(([, { evidence }]) => evidence?.source === 'human' && artifacts.includes(evidence.artifact))
    .map(([id]) => id);
  const [workflowId, workflow] = Object.entries(contract.workflows).find(([, w]) => w.applies_to.includes('epic'));
  const transition = workflow.transitions.find((t) => (t.guards ?? []).some((g) => guards.includes(g)));
  if (!transition) throw new Error(`no Epic transition passes gate ${gate}`);
  const jira = mapping.workflows[workflowId];
  const reachable = (start, skip) => {
    const seen = new Set([start]);
    for (const state of seen) {
      for (const t of workflow.transitions) if (t !== skip && [t.from].flat().includes(state)) seen.add(t.to);
    }
    return seen;
  };
  const after = reachable(transition.to);
  const before = reachable(workflow.initial, transition);
  const status = (state) => jira.states[state].status;
  return {
    gate,
    transition: jira.transitions[transition.id].name,
    from: [transition.from].flat().map(status),
    to: status(transition.to),
    past: Object.keys(workflow.states).filter((state) => after.has(state) && !before.has(state)).map(status),
    epicType: contract.work_types.find(({ id }) => id === 'epic').jira_issue_type,
  };
}

// The Epic with its changelog, and the pull_request workflow runs of the docs branch. jira reads with the CI token;
// github needs actions: read.
export async function readDocsFacts({ github, jira, key, branch }) {
  const { fields } = await jira.get(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: 'issuetype,status' });
  const histories = await jira.getAll(`/rest/api/3/issue/${encodeURIComponent(key)}/changelog`);
  const runs = await github.getAll('/actions/runs', { branch, event: 'pull_request' }, 'workflow_runs');
  return { epic: { key, type: fields.issuetype.name, status: fields.status.name, histories }, runs };
}

// The docs conditions of PR `pr` for Epic `key`, with the facts readDocsFacts gives and the gate's `passage`:
//   { docs: true, missing }   a docs PR: missing lists what it still waits for, besides the conditions of every PR
//   { docs: false, reason }   not a docs PR after all, so it is reviewed and approved like any PR
export function docsConditions({ pr, key, epic, runs, passage }) {
  const head = pr.head.sha.slice(0, 7);
  if (epic.type !== passage.epicType) return { docs: false, reason: `${key} is a ${epic.type}, not an ${passage.epicType}` };
  if (!passage.past.includes(epic.status)) return { docs: true, missing: [`${key} past gate ${passage.gate} (it is ${epic.status})`] };
  const approvedAt = epic.histories
    .filter(({ items }) => items.some(({ field, fromString, toString }) => field === 'status' && passage.from.includes(fromString) && toString === passage.to))
    .map(({ created }) => jiraTime(created))
    .sort((a, b) => a - b)
    .at(-1);
  if (approvedAt === undefined) return { docs: false, reason: `no ${passage.transition} in the changelog of ${key}` };
  // The newest CI run of the docs branch for its PR. A run started again keeps its created_at; each push starts a new
  // one. A run of the same commit on another branch or by hand says nothing about what you read. While the newest run
  // is of another commit, the run of the head has not started yet.
  const newest = runs
    .filter(({ name, event, head_branch: branch }) => name === CI_WORKFLOW && event === 'pull_request' && branch === pr.head.ref)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (newest?.head_sha !== pr.head.sha) return { docs: true, missing: [`a CI run on head ${head}`] };
  if (Date.parse(newest.created_at) > approvedAt) {
    return { docs: false, reason: `head ${head} came after ${passage.transition} of ${key} at ${new Date(approvedAt).toISOString()}, so it is reviewed like any PR` };
  }
  return { docs: true, missing: [] };
}
