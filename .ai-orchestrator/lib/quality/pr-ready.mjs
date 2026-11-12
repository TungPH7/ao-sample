// Marks a draft PR ready for review (human-loop spec 4.6). The REST API cannot, so this is the one GraphQL call of the
// kit: the mutation markPullRequestReadyForReview, with an installation token of ao-dev. The token needs both
// pull_requests: write and contents: write: with the first alone GitHub answers "Resource not accessible by integration"
// (T2, premise 3). `fetch` is a parameter, for tests.
const API = 'https://api.github.com';
const MUTATION = 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { number isDraft } } }';
export const READY_PERMISSIONS = { pull_requests: 'write', contents: 'write' };

// Resolves true when it marked the PR ready, false when the PR was not a draft; throws when GitHub refuses.
export async function markReadyForReview({ token, repo, number, fetch = globalThis.fetch }) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ai-orchestrator' };
  const read = await fetch(`${API}/repos/${repo}/pulls/${number}`, { headers });
  if (!read.ok) throw new Error(`GitHub returned ${read.status} for PR #${number}`);
  const pr = await read.json();
  if (!pr.draft) return false;
  const res = await fetch(`${API}/graphql`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: MUTATION, variables: { id: pr.node_id } }) });
  const answer = await res.json();
  if (!res.ok || answer.errors?.length) throw new Error(`GitHub did not mark PR #${number} ready: ${(answer.errors ?? []).map(({ message }) => message).join('; ') || `status ${res.status}`}`);
  if (answer.data?.markPullRequestReadyForReview?.pullRequest?.isDraft !== false) throw new Error(`PR #${number} is still a draft after the mutation`);
  return true;
}
