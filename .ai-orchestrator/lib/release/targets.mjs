// Which commit the deployer runs on each environment (release-workflow spec 2.4, 2.8, 2.9; plan decisions 3 and 5).
// A pure function. The deployer reads the facts from git, from GitHub and from its own record in /var/lib/ao/; from
// GitHub it trusts only the commit history and the login that created a deployment request.
import { parseBranch } from '../tracker/conventions.mjs';

export const ENVIRONMENTS = ['development', 'staging', 'production'];

// environment: one of ENVIRONMENTS. Then either:
// - candidate, a new head on a branch the environment watches: { sha, tree, branch, audits, pull }. audits holds the
//   audit of every new first-parent commit up to sha, oldest first, each { sha, ok, problems }; pull is { number, head }
//   of the PR whose merge commit sha is, or null;
// - or request, a deployment request: { sha, tree, creator, rollback }, creator being the login GitHub recorded.
// record: the deployer's own record of past deploys by environment, each { sha, tree, ok }, ok when smoke passed.
// approvers: the logins of AO_APPROVERS.
// Returns { action: 'deploy', sha, tree, via } with via 'branch', 'request' or 'rollback'; { action: 'skip', reason }
// for a commit another environment runs; or { action: 'refuse', reason } for one the deployer reports with deployment
// status error, leaving the environment as it is (spec 2.4: failure is kept for a smoke test that failed).
export function decideTarget({ environment, candidate, request, record, approvers }) {
  if (!ENVIRONMENTS.includes(environment)) throw new Error(`unknown environment ${environment}`);
  if (request) return fromRequest(environment, request, record, approvers);
  if (candidate) return fromBranch(environment, candidate, record);
  throw new Error('decideTarget needs a candidate or a request');
}

// The environment that runs a head of `branch` (spec 2.4): develop on Development; an open release branch, or a hotfix
// merged into main, on Staging; the merge of a release PR into main on Production. Null for any other head.
function environmentOf(branch, pull) {
  if (branch === 'develop') return 'development';
  if (parseBranch(branch)?.kind === 'release') return 'staging';
  if (branch === 'main') {
    const kind = pull ? parseBranch(pull.head)?.kind : null;
    if (kind === 'hotfix') return 'staging';
    if (kind === 'release') return 'production';
  }
  return null;
}

function fromBranch(environment, { sha, tree, branch, audits, pull }, record) {
  const short = sha.slice(0, 7);
  const target = environmentOf(branch, pull);
  if (target && target !== environment) return skip(`${short} on ${branch} goes to ${target}`);

  // Every new commit, not only the head: a commit pushed without a PR cannot slip in under a valid one (spec 2.3).
  // auditRange stops at the first commit that fails, so look for it before checking that the audits reach the head.
  const failed = audits.find(({ ok }) => !ok);
  if (failed) {
    return refuse(`${failed.sha.slice(0, 7)} did not pass audit: ${failed.problems.join('; ')}. Read it, then run /ao-rollback ${environment} <sha> for a later head`);
  }
  if (audits.at(-1)?.sha !== sha) return refuse(`the audit does not reach ${short}`);

  if (!target) {
    return refuse(branch === 'main' ? `main takes release and hotfix PRs only, but ${short} merged ${pull?.head ?? 'no PR'}` : `no environment runs ${branch}`);
  }
  if (environment === 'staging' && branch === 'main' && passed(record, 'production', tree)) return skip(`hotfix ${short} is already on production`);
  if (environment === 'production' && !passed(record, 'staging', tree)) return refuse(notStaged(short));
  return deploy(sha, tree, 'branch');
}

function fromRequest(environment, { sha, tree, creator, rollback }, record, approvers) {
  const short = sha.slice(0, 7);
  // GitHub records the login of the token that created the request, so an agent cannot pass as you (gate ⑤).
  if (!approvers.includes(creator)) return refuse(`the deployment request for ${short} was created by ${creator ?? 'an unknown login'}, who is not in AO_APPROVERS`);
  if (rollback && !passed(record, environment, tree)) return refuse(`${short} never ran with a green smoke test on ${environment}, so it is no release to roll back to`);
  if (environment === 'production' && !passed(record, 'staging', tree)) return refuse(notStaged(short));
  return deploy(sha, tree, rollback ? 'rollback' : 'request');
}

// Whether `tree` ran on `environment` and passed its smoke test, by the deployer's own record (plan decision 3).
const passed = (record, environment, tree) => (record[environment] ?? []).some((run) => run.ok && run.tree === tree);
const notStaged = (short) => `the tree of ${short} has not passed Staging: Production runs only a tree that ran on Staging with a green smoke test`;

const deploy = (sha, tree, via) => ({ action: 'deploy', sha, tree, via });
const skip = (reason) => ({ action: 'skip', reason });
const refuse = (reason) => ({ action: 'refuse', reason });
