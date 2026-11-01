// Compares the live Jira configuration of a space with tracker/jira.yaml (tracker-integration spec section 2.10).
// readJiraConfig turns API answers into a snapshot through a client passed in; the other functions have no I/O.
import { expectedBoard, expectedOptions, expectedResolutions, expectedWorkflows } from './expected.mjs';

const CATEGORY_OF = { TODO: 'to-do', IN_PROGRESS: 'in-progress', DONE: 'done' };
const CATEGORY_NAMES = { 'to-do': 'To Do', 'in-progress': 'In Progress', done: 'Done' };
const RESTRICT = 'system:restrict-issue-transition';
const WARN_DAYS = 14;

// Snapshot: {
//   space, issueTypes: [name], scheme: { name, defaultWorkflow, issueTypes: { type: workflow } } | null,
//   workflows: [{ name, statuses: [{ name, category }],
//     transitions: [{ name, type, from: [status], to, restrict: [group] | null, screen: { id, fields } | null, setsResolution }] }],
//   groups: { name: { members: [display name] | undefined } }, resolutions: [name],
//   fields: { name: { options: [name] | undefined } }, board: { filter, columns: [{ name, statuses, max }] } | null }
export async function readJiraConfig(client, { space, mapping }) {
  const project = await client.get(`/rest/api/3/project/${encodeURIComponent(space)}`);
  const issueTypes = await client.get('/rest/api/3/issuetype/project', { projectId: project.id });
  const schemes = await client.get('/rest/api/3/workflowscheme/project', { projectId: project.id });
  const typeName = new Map(issueTypes.map(({ id, name }) => [id, name]));
  const scheme = schemes.values?.[0]?.workflowScheme;
  const resolutions = await client.getAll('/rest/api/3/resolution/search');
  const resolutionName = new Map(resolutions.map(({ id, name }) => [id, name]));
  const { groups, groupName } = await readGroups(client, mapping);

  const statusNames = new Map();
  const screens = new Map();
  const workflows = [];
  for (const { jira_workflow: name } of Object.values(mapping.workflows)) {
    const statuses = new Map();
    let found;
    // The search matches names that contain the query, so keep only the exact name.
    for await (const page of client.pages('/rest/api/3/workflows/search', { queryString: name, expand: 'values.transitions' })) {
      for (const status of page.statuses ?? []) {
        statuses.set(status.statusReference, status);
        statusNames.set(status.id, status.name);
      }
      found ??= page.values?.find((workflow) => workflow.name === name);
    }
    if (!found) continue;
    const statusName = (ref) => statuses.get(ref)?.name ?? ref;
    const transitions = [];
    for (const t of found.transitions) {
      const restrictRules = rulesIn(t.conditions).filter(({ ruleKey }) => ruleKey === RESTRICT);
      const groupIds = restrictRules.flatMap(({ parameters }) => (parameters?.groupIds ?? '').split(',').filter(Boolean));
      const screenId = t.transitionScreen?.parameters?.screenId;
      if (screenId && !screens.has(screenId)) screens.set(screenId, await readScreenFields(client, screenId));
      const update = (t.actions ?? []).find(({ ruleKey, parameters }) => ruleKey === 'system:update-field' && parameters?.field === 'resolution');
      transitions.push({
        name: t.name,
        type: t.type,
        from: (t.links ?? []).map((link) => statusName(link.fromStatusReference)),
        to: statusName(t.toStatusReference),
        restrict: restrictRules.length > 0 ? await Promise.all(groupIds.map((id) => groupName(id))) : null,
        screen: screenId ? { id: screenId, fields: screens.get(screenId) } : null,
        setsResolution: update ? (resolutionName.get(update.parameters.value) ?? update.parameters.value) : null,
      });
    }
    workflows.push({
      name,
      statuses: found.statuses.map(({ statusReference: ref }) => ({ name: statusName(ref), category: CATEGORY_OF[statuses.get(ref)?.statusCategory] })),
      transitions,
    });
  }

  return {
    space: project.key,
    issueTypes: issueTypes.map(({ name }) => name),
    scheme: scheme
      ? {
          name: scheme.name,
          defaultWorkflow: scheme.defaultWorkflow,
          issueTypes: Object.fromEntries(Object.entries(scheme.issueTypeMappings ?? {}).map(([id, workflow]) => [typeName.get(id) ?? id, workflow])),
        }
      : null,
    workflows,
    groups,
    resolutions: resolutions.map(({ name }) => name),
    fields: await readFields(client, mapping),
    board: await readBoard(client, space, statusNames),
  };
}

// Every rule of a condition group, nested groups included.
function rulesIn(group) {
  if (!group) return [];
  return [...(group.conditions ?? []), ...(group.conditionGroups ?? []).flatMap(rulesIn)];
}

// The mapped groups that exist, with the members of the service accounts' groups, and a lookup from group id to name.
async function readGroups(client, mapping) {
  const groups = {};
  const names = new Map();
  for (const { kind, group } of mapping.identities) {
    const [found] = await client.getAll('/rest/api/3/group/bulk', { groupName: group });
    if (!found) continue;
    names.set(found.groupId, found.name);
    const members =
      kind === 'service-account'
        ? (await client.getAll('/rest/api/3/group/member', { groupname: group, includeInactiveUsers: true })).map(({ displayName }) => displayName)
        : undefined;
    groups[group] = { members };
  }
  const groupName = async (id) => {
    if (!names.has(id)) names.set(id, (await client.getAll('/rest/api/3/group/bulk', { groupId: id }))[0]?.name ?? id);
    return names.get(id);
  };
  return { groups, groupName };
}

async function readScreenFields(client, screenId) {
  const fields = [];
  for (const tab of await client.get(`/rest/api/3/screens/${screenId}/tabs`)) {
    fields.push(...(await client.get(`/rest/api/3/screens/${screenId}/tabs/${tab.id}/fields`)).map(({ name }) => name));
  }
  return fields;
}

// The mapped fields that exist; a select field also gets the enabled options of its global context.
async function readFields(client, mapping) {
  const all = await client.get('/rest/api/3/field');
  const fields = {};
  for (const [id, { jira_field: name, type }] of Object.entries(mapping.fields)) {
    if (!name || id === 'resolution') continue;
    const field = all.find((f) => f.name === name);
    if (!field) continue;
    if (type !== 'select') {
      fields[name] = {};
      continue;
    }
    const contexts = await client.getAll(`/rest/api/3/field/${field.id}/context`);
    const context = contexts.find((c) => c.isGlobalContext) ?? contexts[0];
    const options = context ? await client.getAll(`/rest/api/3/field/${field.id}/context/${context.id}/option`) : [];
    fields[name] = { options: options.filter((o) => !o.disabled).map(({ value }) => value) };
  }
  return fields;
}

async function readBoard(client, space, statusNames) {
  const [board] = await client.getAll('/rest/agile/1.0/board', { projectKeyOrId: space, type: 'kanban' });
  if (!board) return null;
  const config = await client.get(`/rest/agile/1.0/board/${board.id}/configuration`);
  const filter = await client.get(`/rest/api/3/filter/${config.filter.id}`);
  return {
    filter: filter.jql,
    columns: config.columnConfig.columns.map(({ name, statuses, max }) => ({
      name,
      statuses: statuses.map(({ id }) => statusNames.get(id) ?? `status ${id}`),
      max: max ?? undefined,
    })),
  };
}

const quote = (names) => names.map((n) => `"${n}"`).join(', ');
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// Returns every difference as { kind, message }: workflow by workflow in contract order, then the scheme, groups,
// resolutions, fields and board.
export function findDrift(snapshot, { contract, mapping }) {
  const drift = [];
  const add = (kind, message) => drift.push({ kind, message });
  const space = snapshot.space;

  for (const workflow of expectedWorkflows(contract, mapping)) {
    const name = workflow.name;
    const jira = snapshot.workflows.find((w) => w.name === name);
    if (!jira) {
      add('workflow-missing', `${name}: workflow not found`);
      continue;
    }

    const initial = jira.transitions.find((t) => t.type === 'INITIAL');
    if (initial && initial.to !== workflow.initial) add('initial-status', `${name}: items are created in "${initial.to}", expected "${workflow.initial}"`);

    for (const { name: status, category } of workflow.statuses) {
      const found = jira.statuses.find((s) => s.name === status);
      if (!found) add('status-missing', `${name}: status "${status}" is missing`);
      else if (found.category !== category) {
        add('status-category', `${name}: status "${status}" is in category ${CATEGORY_NAMES[found.category] ?? found.category}, expected ${CATEGORY_NAMES[category]}`);
      }
    }
    for (const { name: status } of jira.statuses.filter((s) => !workflow.statuses.some((e) => e.name === s.name))) {
      add('status-extra', `${name}: status "${status}" is not in the mapping`);
    }

    // A Jira transition with several `from` counts once for each of them; one from any status has no `from`.
    const actual = jira.transitions
      .filter((t) => t.type !== 'INITIAL')
      .flatMap((t) => (t.from.length > 0 ? t.from : [null]).map((from) => ({ ...t, from })));
    const same = (a, b) => a.name === b.name && a.from === b.from && a.to === b.to;
    const extra = actual.filter((a) => !workflow.transitions.some((e) => same(a, e)));
    const path = (t) => `from ${t.from === null ? 'any status' : `"${t.from}"`} to "${t.to}"`;
    for (const e of workflow.transitions) {
      const found = actual.find((a) => same(a, e));
      if (found) {
        checkRules(found, e, (kind, problem) => add(kind, `${name}: transition "${e.name}" ${path(e)} ${problem}`));
        continue;
      }
      // A Jira transition with the same name but another path is the same transition drawn wrong.
      const index = extra.findIndex((a) => a.name === e.name);
      if (index === -1) {
        add('transition-missing', `${name}: transition "${e.name}" ${path(e)} is missing`);
        continue;
      }
      const [wrong] = extra.splice(index, 1);
      add('transition-path', `${name}: transition "${e.name}" goes ${path(wrong)}, expected ${path(e)}`);
    }
    for (const a of extra) add('transition-extra', `${name}: transition "${a.name}" ${path(a)} is not in the mapping`);
  }

  if (!snapshot.scheme) add('scheme-missing', `${space}: the space has no workflow scheme`);
  else if (snapshot.scheme.name !== mapping.workflow_scheme) {
    add('scheme-name', `${space}: the space uses workflow scheme "${snapshot.scheme.name}", expected "${mapping.workflow_scheme}"`);
  }
  for (const { id, jira_issue_type: type } of contract.work_types) {
    if (!snapshot.issueTypes.includes(type)) {
      add('type-missing', `${space}: work type "${type}" is not in the space`);
      continue;
    }
    if (!snapshot.scheme) continue;
    const workflowId = Object.keys(contract.workflows).find((w) => contract.workflows[w].applies_to.includes(id));
    const want = mapping.workflows[workflowId].jira_workflow;
    const uses = snapshot.scheme.issueTypes[type] ?? snapshot.scheme.defaultWorkflow;
    if (uses !== want) add('type-workflow', `${space}: work type "${type}" uses workflow "${uses}", expected "${want}"`);
  }

  for (const { kind, account, group } of mapping.identities) {
    const found = snapshot.groups[group];
    if (!found) add('group-missing', `group "${group}" not found`);
    else if (kind === 'service-account' && !found.members?.includes(account)) add('group-member', `group "${group}" does not contain "${account}"`);
  }

  for (const resolution of expectedResolutions(contract, mapping).filter((r) => !snapshot.resolutions.includes(r))) {
    add('resolution-missing', `resolution "${resolution}" not found`);
  }

  for (const [id, { jira_field: name, type }] of Object.entries(mapping.fields)) {
    if (!name || id === 'resolution') continue;
    const found = snapshot.fields[name];
    if (!found) {
      add('field-missing', `field "${name}" not found`);
      continue;
    }
    if (type !== 'select') continue;
    const want = expectedOptions(contract, mapping, id);
    if (found.options.join('\n') !== want.join('\n')) add('field-options', `field "${name}" has options ${quote(found.options)}, expected ${quote(want)}`);
  }

  checkBoard(snapshot, contract, mapping, add);
  return drift;
}

// The rules of a Jira transition that matches the mapping: who may make it, and how it handles Resolution.
function checkRules(jira, expected, add) {
  if (!jira.restrict) add('restrict-missing', `has no Restrict rule, expected groups ${quote(expected.groups)}`);
  else if (!sameSet(jira.restrict, expected.groups)) add('restrict-groups', `is restricted to ${quote(jira.restrict)}, expected ${quote(expected.groups)}`);
  if (expected.asksResolution) {
    if (!jira.screen) add('resolution-screen', 'does not ask for a Resolution');
    else if (!jira.screen.fields.includes('Resolution')) add('resolution-screen', `shows screen ${jira.screen.id}, which has no Resolution field`);
  }
  if (expected.setResolution && jira.setsResolution !== expected.setResolution) {
    add('resolution-set', jira.setsResolution ? `sets Resolution "${jira.setsResolution}", expected "${expected.setResolution}"` : `does not set Resolution "${expected.setResolution}"`);
  }
}

function checkBoard(snapshot, contract, mapping, add) {
  const space = snapshot.space;
  const board = snapshot.board;
  if (!board) {
    add('board-missing', `${space}: the space has no Kanban board`);
    return;
  }
  const filter = mapping.board.filter.replaceAll('{key}', space);
  const normalize = (jql) => jql.replaceAll('"', '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalize(board.filter) !== normalize(filter)) add('board-filter', `${space}: the board filter is "${board.filter}", expected "${filter}"`);

  const { columns, unplaced } = expectedBoard(contract, mapping);
  const names = board.columns.map(({ name }) => name);
  if (names.join('\n') !== columns.map(({ name }) => name).join('\n')) {
    add('board-columns', `${space}: the board columns are ${quote(names)}, expected ${quote(columns.map(({ name }) => name))}`);
  }
  for (const column of columns) {
    const found = board.columns.find(({ name }) => name === column.name);
    if (!found) continue;
    if (!sameSet(found.statuses, column.statuses)) {
      add('board-column-statuses', `${space}: column "${column.name}" has statuses ${quote(found.statuses)}, expected ${quote(column.statuses)}`);
    }
    if (found.max !== column.max) {
      const has = found.max === undefined ? 'has no limit' : `allows ${found.max} work items`;
      add('board-wip', `${space}: column "${column.name}" ${has}, expected ${column.max === undefined ? 'no limit' : column.max}`);
    }
  }
  for (const status of unplaced) {
    const column = board.columns.find(({ statuses }) => statuses.includes(status));
    if (column) add('board-unplaced', `${space}: status "${status}" is in column "${column.name}", expected off the board`);
  }
}

// What the REST API cannot show, so jira:check asks for a look instead of passing it.
export function manualChecks(contract, mapping) {
  const [backlog] = expectedBoard(contract, mapping).columns;
  return [
    `The Kanban backlog is on and holds ${quote(backlog.statuses)} (Board settings → Columns)`,
    'The Atlassian MCP server accepts API tokens (admin.atlassian.com → Connectors)',
    'GitHub for Atlassian is connected to the project repository',
    'Each field is on the screens of the work types that use it (Space settings → Work items → Screens)',
  ];
}

// Tokens that expire within 14 days, or have expired, from the dates in tracker/jira.yaml.
export function tokenWarnings(mapping, today = new Date()) {
  return mapping.identities.flatMap(({ account, token_env: env, token_expires_on: date }) => {
    if (!date) return [];
    const days = Math.ceil((Date.parse(`${date}T00:00:00Z`) - Date.parse(today.toISOString().slice(0, 10) + 'T00:00:00Z')) / 86_400_000);
    if (days >= WARN_DAYS) return [];
    return [days < 0 ? `the token of "${account}" (${env}) expired on ${date}` : `the token of "${account}" (${env}) expires on ${date}, in ${days} days`];
  });
}
