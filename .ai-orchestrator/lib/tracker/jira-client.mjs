// Thin Jira Cloud REST client over api.atlassian.com (tracker-integration spec section 5). Read-only unless made with
// write: true, which only jira-sync does with the CI token: any method but GET is refused before the request leaves.
// Every request asks for English names, because Jira translates work type and status names into the account's
// language, and the service accounts' language is not English.
const API = 'https://api.atlassian.com/ex/jira';

// Your email and a token with scopes, for jira:check.
export function basicAuth(email, token) {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

// A service account's token, for the hooks and jira-sync.
export function bearerAuth(token) {
  return `Bearer ${token}`;
}

export function createJiraClient({ cloudId, authorization, fetch = globalThis.fetch, write = false }) {
  async function request(method, path, query = {}, body) {
    if (method !== 'GET' && !write) throw new Error(`Read-only Jira client refused ${method} ${path}`);
    const url = new URL(`${API}/${cloudId}${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    const headers = { Authorization: authorization, Accept: 'application/json', 'Accept-Language': 'en-US' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`Jira ${method} ${path} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    // Writes often answer 204 with no body.
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  const get = (path, query) => request('GET', path, query);

  // Pages of a startAt/maxResults list, until isLast, or until total when a page has no isLast. Most lists keep their
  // items under `values`; a few, like comments, use another key.
  async function* pages(path, query = {}, itemsKey = 'values') {
    let startAt = 0;
    for (;;) {
      const page = await get(path, { ...query, startAt });
      yield page;
      const count = page[itemsKey]?.length ?? 0;
      startAt += count;
      if (count === 0 || page.isLast === true || (page.isLast === undefined && startAt >= page.total)) return;
    }
  }

  async function getAll(path, query, itemsKey = 'values') {
    const items = [];
    for await (const page of pages(path, query, itemsKey)) items.push(...page[itemsKey]);
    return items;
  }

  // Every work item a JQL query finds, with the given fields. The search pages with nextPageToken, not startAt.
  async function searchAll(jql, fields) {
    const issues = [];
    let nextPageToken;
    for (;;) {
      const page = await get('/rest/api/3/search/jql', { jql, fields: fields.join(','), maxResults: 100, nextPageToken });
      issues.push(...(page.issues ?? []));
      if (page.isLast !== false || !page.nextPageToken) return issues;
      nextPageToken = page.nextPageToken;
    }
  }

  const issuePath = (key) => `/rest/api/3/issue/${encodeURIComponent(key)}`;

  // The writes of jira-sync. A transition goes by its Jira name, among those the token's account may make on the item.
  async function transition(key, name) {
    const path = `${issuePath(key)}/transitions`;
    const found = (await get(path)).transitions.find((t) => t.name === name);
    if (!found) throw new Error(`${key} has no transition "${name}" for this account`);
    await request('POST', path, {}, { transition: { id: found.id } });
  }

  // changes: the body of PUT /issue, with fields and update.
  const editItem = (key, changes) => request('PUT', issuePath(key), {}, changes);

  const comment = (key, text) =>
    request('POST', `${issuePath(key)}/comment`, {}, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });

  // One file attached to an item, as multipart form data (release-workflow spec 2.5). Jira refuses an upload without
  // X-Atlassian-Token: no-check; fetch writes the multipart Content-Type with its boundary.
  async function attach(key, name, data) {
    const path = `${issuePath(key)}/attachments`;
    if (!write) throw new Error(`Read-only Jira client refused POST ${path}`);
    const form = new FormData();
    form.append('file', new Blob([data]), name);
    const res = await fetch(new URL(`${API}/${cloudId}${path}`), { method: 'POST', headers: { Authorization: authorization, Accept: 'application/json', 'X-Atlassian-Token': 'no-check' }, body: form });
    if (!res.ok) throw new Error(`Jira POST ${path} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  return { request, get, pages, getAll, searchAll, transition, editItem, comment, attach };
}
