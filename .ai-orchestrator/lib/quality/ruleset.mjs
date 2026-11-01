// The ruleset gh:protect applies when a repository supports rulesets (quality-gates spec section 2.8): a public
// repository, or a plan from Pro up. Elsewhere merge-gate and audit enforce the gates, and the repository is left as
// it is (soft mode).
export const RULESET = 'ao-protected';
const SOFT_MODE = 'soft mode: merge-gate and audit enforce the gates';

// The ruleset for the protected branches of quality/gates.yaml: no deletion or force push; changes through a PR with
// one approval, which a new push dismisses; every job of CI green. Nobody bypasses it, the ao-dev App included, since
// merge-gate only merges what meets the gates.
export function rulesetPayload(gates) {
  return {
    name: RULESET,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: gates.protected_branches.map((branch) => `refs/heads/${branch}`), exclude: [] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 1,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: gates.checks.map((context) => ({ context })),
          strict_required_status_checks_policy: false,
          // A new release branch is pushed before any check has run on it.
          do_not_enforce_on_create: true,
        },
      },
    ],
  };
}

// Creates the ruleset, or updates the one with its name, so a second run makes no copy. A repository without rulesets
// answers the list with 403: soft mode, nothing sent.
export async function applyRuleset(github, gates, log = console.log) {
  let rulesets;
  try {
    rulesets = await github.getAll('/rulesets');
  } catch (error) {
    if (error.status !== 403) throw error;
    log(SOFT_MODE);
    return { mode: 'soft' };
  }
  const payload = rulesetPayload(gates);
  const found = rulesets.find(({ name }) => name === RULESET);
  if (found) {
    await github.request('PUT', `/rulesets/${found.id}`, {}, payload);
    log(`updated ruleset ${RULESET} (id ${found.id})`);
    return { mode: 'updated', id: found.id };
  }
  const { id } = await github.request('POST', '/rulesets', {}, payload);
  log(`created ruleset ${RULESET} (id ${id})`);
  return { mode: 'created', id };
}
