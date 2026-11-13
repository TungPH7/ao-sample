// ao-kit setup jira (project-scaffold spec 2.4, as T2 found it on 2026-11-12): over REST, with your classic API token,
// a company-managed space with the workflow, issue type, screen and notification schemes of a sample space, then its
// board filter and kanban board, then jira:check. The Free plan refuses a permission scheme at creation, so none is
// sent: the space gets its own default one. Board columns have no write API, so they stay steps for you. Each step
// reads first: a second run writes nothing.
//   jira(method, path, body)   a REST call on the site, resolving { status, json }
//   run(argv, cwd)             node for jira-check.mjs, which reads the contract of the kit from cwd: { status, stdout, stderr }

export async function setupJira({ kitDir, space, name, template, mapping, jira, run }) {
  const notes = [];
  const me = await jira('GET', '/rest/api/3/myself');
  if (me.status !== 200) return { ok: false, notes: [`Jira cannot sign in with JIRA_ADMIN_EMAIL and JIRA_ADMIN_CLASSIC_TOKEN (${me.status}): make a classic API token as docs/getting-started.md says`] };

  let project = await jira('GET', `/rest/api/3/project/${space}`);
  if (project.status === 200) notes.push(`The space ${space} exists: its schemes are left as they are`);
  else {
    const sample = await jira('GET', `/rest/api/3/project/${template}`);
    if (sample.status !== 200) return { ok: false, notes: [`The sample space ${template} cannot be read (${sample.status}): give another with --template <KEY>`] };
    const id = sample.json.id;
    const pick = async (path, read) => {
      const answer = await jira('GET', path);
      return answer.status === 200 ? read(answer.json) : undefined;
    };
    const schemes = {
      workflowScheme: await pick(`/rest/api/3/workflowscheme/project?projectId=${id}`, (j) => j.values?.[0]?.workflowScheme?.id),
      issueTypeScheme: await pick(`/rest/api/3/issuetypescheme/project?projectId=${id}`, (j) => j.values?.[0]?.issueTypeScheme?.id),
      issueTypeScreenScheme: await pick(`/rest/api/3/issuetypescreenscheme/project?projectId=${id}`, (j) => j.values?.[0]?.issueTypeScreenScheme?.id),
      notificationScheme: await pick(`/rest/api/3/project/${template}/notificationscheme`, (j) => j.id),
    };
    const body = {
      key: space,
      name,
      projectTypeKey: 'software',
      leadAccountId: me.json.accountId,
      assigneeType: 'UNASSIGNED',
      ...Object.fromEntries(Object.entries(schemes).filter(([, value]) => value !== undefined).map(([key, value]) => [key, Number(value)])),
    };
    const made = await jira('POST', '/rest/api/3/project', body);
    if (made.status !== 201) return { ok: false, notes: [...notes, `Jira refused to create ${space} (${made.status}): ${JSON.stringify(made.json ?? '').slice(0, 300)}`] };
    notes.push(`Created the space ${space} with the schemes of ${template}: ${Object.keys(schemes).filter((k) => schemes[k] !== undefined).join(', ')}`);
    project = { status: 200, json: made.json };
  }

  const jql = mapping.board.filter.replaceAll('{key}', space);
  const boards = (await jira('GET', `/rest/agile/1.0/board?projectKeyOrId=${space}`)).json?.values ?? [];
  if (boards.length === 0) {
    const filter = await jira('POST', '/rest/api/3/filter', { name: `Filter for ${space} board`, jql, sharePermissions: [{ type: 'project', project: { id: project.json.id } }] });
    if (filter.status !== 200) return { ok: false, notes: [...notes, `Jira refused the board filter (${filter.status})`] };
    const board = await jira('POST', '/rest/agile/1.0/board', { name: `${space} board`, type: mapping.board.type, filterId: Number(filter.json.id), location: { type: 'project', projectKeyOrId: space } });
    if (board.status !== 201) return { ok: false, notes: [...notes, `Jira refused the board (${board.status})`] };
    notes.push(`Created the ${mapping.board.type} board of ${space}, with its filter`);
  } else {
    const filterId = (await jira('GET', `/rest/agile/1.0/board/${boards[0].id}/configuration`)).json?.filter?.id;
    const current = filterId ? (await jira('GET', `/rest/api/3/filter/${filterId}`)).json?.jql : null;
    if (filterId && current !== jql) {
      await jira('PUT', `/rest/api/3/filter/${filterId}`, { name: `Filter for ${space} board`, jql });
      notes.push(`Set the board filter of ${space} to ${jql}`);
    } else notes.push(`The board of ${space} exists, with its filter`);
  }

  const check = run(['node', `${kitDir.replaceAll('\\', '/').replace(/\/+$/, '')}/scripts/jira-check.mjs`, '--space', space], kitDir);
  const lines = `${check.stdout ?? ''}${check.stderr ?? ''}`.trim().split('\n').filter((line) => !line.startsWith('Check by hand'));
  notes.push(`jira:check: ${lines.at(-1) || `exit ${check.status}`}`);
  if (check.status === 0) return { ok: true, notes };
  // Each difference, so a limit forgotten on one column shows (T16).
  notes.push(...lines.filter((line) => line.startsWith(`${space}:`)).map((line) => `jira:check found ${line}`));
  notes.push('By hand: the columns of the board and its Kanban backlog, as the board step of docs/jira-setup.md says; then run ao-kit setup jira again, until jira:check finds no difference');
  return { ok: false, notes };
}
