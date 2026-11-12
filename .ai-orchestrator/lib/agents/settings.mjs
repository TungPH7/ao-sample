// .claude/settings.json of a project (project-scaffold spec 2.1): the hooks, permissions and attribution of the kit from
// agents/settings.json, and the env of the project from its project.yaml. Before, a kit copy left the file as the
// project had it, so a new hook of the kit never reached a project. In the kit, with no project, the placeholders stay:
// that is kit/.claude/settings.json. The text is plain JSON with two spaces. Pure.

// The env the kit reads from a project, in this order, then the other env of agents/settings.json.
const fromProject = (config) => ({
  AO_JIRA_SPACE: config.jira.space,
  AO_APPROVERS: config.github.approvers.join(','),
  AO_DEV_APP: config.github.apps.dev,
  AO_DEV_APP_ID: String(config.github.apps.dev_id),
  AO_REVIEW_APP: config.github.apps.review,
  AO_REVIEW_APP_ID: String(config.github.apps.review_id),
  ...(config.github.kit_peers?.length > 0 && { AO_KIT_PEERS: config.github.kit_peers.join(',') }),
});

// template: agents/settings.json, parsed; config: project.yaml, parsed and valid, or null in the kit.
export function renderSettings(template, config) {
  const settings = structuredClone(template);
  if (config) {
    const own = fromProject(config);
    const rest = Object.fromEntries(Object.entries(template.env ?? {}).filter(([name]) => !name.startsWith('AO_')));
    settings.env = { ...own, ...rest };
    const allow = settings.permissions?.allow ?? [];
    const extra = (config.claude?.allow ?? []).filter((rule) => !allow.includes(rule));
    if (extra.length > 0) settings.permissions = { ...settings.permissions, allow: [...allow, ...new Set(extra)] };
  }
  return `${JSON.stringify(settings, null, 2)}\n`;
}
