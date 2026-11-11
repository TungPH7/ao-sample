// Requests between roles (dev-workflow spec 2.8): an agent asks another role on the item with a comment whose text,
// after the author's Agent name, starts with "Cần <role>:". The request is done once that role comments on the same
// item after it, which it does with its Agent name first (agents/rules.md). /ao-status lists the open ones. Pure.
import { adfText, jiraTime } from '../tracker/facts.mjs';

// The asker of a request written by the agents' Jira account without an Agent name: an agent, but not which one. Every
// agent writes with that one account, and the name is only a rule of its prompt, so such a comment is never taken for
// the human's (review of ao-sample PR #21).
export const UNSIGNED_AGENT = 'agent';

// comments: the comments of an item as GET /issue/{key}/comment gives them (ADF or plain text body, with their author).
// agentNames: role → Agent field value, such as { ba: 'Business Analyst' }. agentAccount: the account id of the agents'
// identity in tracker/jira.yaml. Returns the open requests, oldest first: [{ from, to, text, at }], where from is the
// asking role, UNSIGNED_AGENT for a comment of the agents' account with no Agent name, or null for the human.
export function openRequests(comments, agentNames, { agentAccount } = {}) {
  const roleOf = new Map(Object.entries(agentNames).map(([role, name]) => [name, role]));
  const read = comments
    .map(({ created, body, author }) => {
      const text = (typeof body === 'string' ? body : adfText(body)).trim();
      const name = [...roleOf.keys()].find((agentName) => text.startsWith(`${agentName}:`));
      const byAgents = Boolean(agentAccount) && author?.accountId === agentAccount;
      const from = name ? roleOf.get(name) : byAgents ? UNSIGNED_AGENT : null;
      return { at: jiraTime(created), from, rest: name ? text.slice(name.length + 1).trim() : text };
    })
    .sort((a, b) => a.at - b.at);
  const open = [];
  for (const { at, from, rest } of read) {
    const asked = rest.match(/^Cần ([\w-]+):\s*([\s\S]*)$/);
    if (asked && Object.hasOwn(agentNames, asked[1])) open.push({ from, to: asked[1], text: asked[2].trim(), at });
  }
  return open.filter(({ to, at }) => !read.some((comment) => comment.from === to && comment.at > at));
}
