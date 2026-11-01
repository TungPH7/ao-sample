// Requests between roles (dev-workflow spec 2.8): an agent asks another role on the item with a comment whose text,
// after the author's Agent name, starts with "Cần <role>:". The request is done once that role comments on the same
// item after it, which it does with its Agent name first (agents/rules.md). /ao-status lists the open ones. Pure.
import { adfText, jiraTime } from '../tracker/facts.mjs';

// comments: the comments of an item as GET /issue/{key}/comment gives them (ADF or plain text body). agentNames: role
// → Agent field value, such as { ba: 'Business Analyst' }. Returns the open requests, oldest first:
// [{ from, to, text, at }], where from is the asking role, or null when the comment has no Agent name (you).
export function openRequests(comments, agentNames) {
  const roleOf = new Map(Object.entries(agentNames).map(([role, name]) => [name, role]));
  const read = comments
    .map(({ created, body }) => {
      const text = (typeof body === 'string' ? body : adfText(body)).trim();
      const author = [...roleOf.keys()].find((name) => text.startsWith(`${name}:`));
      return { at: jiraTime(created), from: author ? roleOf.get(author) : null, rest: author ? text.slice(author.length + 1).trim() : text };
    })
    .sort((a, b) => a.at - b.at);
  const open = [];
  for (const { at, from, rest } of read) {
    const asked = rest.match(/^Cần ([\w-]+):\s*([\s\S]*)$/);
    if (asked && Object.hasOwn(agentNames, asked[1])) open.push({ from, to: asked[1], text: asked[2].trim(), at });
  }
  return open.filter(({ to, at }) => !read.some((comment) => comment.from === to && comment.at > at));
}
