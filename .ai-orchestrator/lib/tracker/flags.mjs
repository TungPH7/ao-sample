// The Needs you flags the kit raises with the CI token, told apart by the first words of the comment that goes with
// each: merge-gate for a PR you merge yourself (dev-workflow spec 2.7), audit for a commit that skipped a gate, and
// jira-sync for an item at the rework limit. jira-sync clears only merge-gate's, when the PR closes. Anyone who comments
// on the item can write those words, an agent too, so merge-gate and jira-sync count only the comments of the CI
// token's account (ciAccount). Pure.
import { adfText, jiraTime } from './facts.mjs';

const MARKERS = [
  ['merge-gate', /^merge-gate: needs you at ([0-9a-f]{7}) on PR #(\d+)\b/],
  ['audit', /^audit: [0-9a-f]{7} on \S+ was not deployed\b/],
  ['rework', /^jira-sync: \S+ went back \d+ times\b/],
];
const NAMES = { 'merge-gate': 'merge-gate', audit: 'audit', rework: 'the rework limit' };

// The first words of merge-gate's comments for head `sha` of PR `number`, on the PR and on its item.
export const needsYouMarker = (sha, number) => `merge-gate: needs you at ${sha.slice(0, 7)} on PR #${number}`;

// The account id of the identity with the automation role in tracker/jira.yaml: the account of the CI token. A scoped
// token cannot read /myself, so the mapping says it.
export function ciAccount(mapping) {
  const id = mapping.identities.find(({ roles }) => roles.includes('automation'))?.account_id;
  if (!id) throw new Error('tracker/jira.yaml has no account_id for the automation identity: merge-gate and jira-sync need it to know their own comments');
  return id;
}

// The newest flag comment of the kit among `comments` (the comments of GET /issue/{key}/comment), or null:
// { kind, at }, with the head `sha` and the `pr` for merge-gate's. With `author`, an accountId, only its comments count.
export function latestFlagComment(comments, { author } = {}) {
  let latest = null;
  for (const { created, body, author: by } of comments) {
    if (author && by?.accountId !== author) continue;
    const text = typeof body === 'string' ? body : adfText(body).trim();
    for (const [kind, marker] of MARKERS) {
      const found = text.match(marker);
      if (!found) continue;
      const at = jiraTime(created);
      if (!latest || at >= latest.at) latest = { kind, at, ...(kind === 'merge-gate' && { sha: found[1], pr: Number(found[2]) }) };
    }
  }
  return latest;
}

// Whether jira-sync clears the flag of `item` ({ labels }) when PR `number` closes: it is flagged, its newest flag
// comment of the kit is merge-gate's for that PR, and the changelog (`histories`) shows nobody flagged it after that
// comment, as an agent would through MCP. `author` is the CI account (ciAccount). Returns { clear: true } or
// { clear: false, reason }.
export function clearsMergeGateFlag({ comments, histories, item, number, mapping, author }) {
  if (!item.labels.includes(mapping.needs_you_label)) return { clear: false, reason: 'it is not flagged' };
  const latest = latestFlagComment(comments, { author });
  if (!latest) return { clear: false, reason: 'no flag comment of the kit' };
  if (latest.kind !== 'merge-gate') return { clear: false, reason: `its newest flag comment is from ${NAMES[latest.kind]}, not from merge-gate for PR #${number}` };
  if (latest.pr !== number) return { clear: false, reason: `its newest flag comment is from merge-gate for PR #${latest.pr}, not for PR #${number}` };
  const field = mapping.fields.flagged.jira_field;
  const flaggedAgain = histories.some(({ created, items }) => jiraTime(created) > latest.at && items.some((change) => change.field === field && change.toString));
  return flaggedAgain ? { clear: false, reason: 'it was flagged again after merge-gate flagged it' } : { clear: true };
}
