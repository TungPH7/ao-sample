// The two GitHub Apps of the agents (quality-gates spec section 2.2) as manifests for GitHub's manifest flow, and the
// local page that sends them to GitHub. Pure: scripts/github-app-create.mjs serves the page and talks to GitHub.
// Workflows, Actions and checks come from dev-workflow spec 2.3: devops pushes workflow files with ao-dev, and every
// role reads CI with a read-only ao-review token. Each token asks only for the part of these it needs.

export const HOMEPAGE = 'https://github.com/TungPH7/ai-orchestrator-v1';

export const APPS = {
  dev: {
    suffix: 'ao-dev',
    description: 'Opens and merges pull requests for the ai-orchestrator agents.',
    permissions: { contents: 'write', pull_requests: 'write', workflows: 'write', actions: 'read', checks: 'read' },
  },
  review: {
    suffix: 'ao-review',
    description: 'Posts review reports for the ai-orchestrator agents.',
    permissions: { contents: 'read', pull_requests: 'write', actions: 'read', checks: 'read' },
  },
};

// One App: installable only on your account, no webhook (GitHub still wants its URL), no user sign-in. GitHub comes back
// to `redirect_url` after you create the App, and to `setup_url` after you install it.
export function appManifest(kind, { owner, baseUrl }) {
  const app = APPS[kind];
  if (!app) throw new Error(`unknown App kind '${kind}', use one of: ${Object.keys(APPS).join(', ')}`);
  return {
    name: `${owner.toLowerCase()}-${app.suffix}`,
    url: HOMEPAGE,
    description: app.description,
    public: false,
    hook_attributes: { url: HOMEPAGE, active: false },
    redirect_url: `${baseUrl}/created/${kind}`,
    setup_url: `${baseUrl}/installed/${kind}`,
    setup_on_update: false,
    request_oauth_on_install: false,
    default_permissions: { ...app.permissions },
    default_events: [],
  };
}

// The page that installs an App. With the account and repository ids, GitHub preselects them.
export function installUrl(slug, { ownerId, repoId } = {}) {
  const base = `https://github.com/apps/${slug}/installations/new`;
  if (!ownerId || !repoId) return base;
  const query = new URLSearchParams({ suggested_target_id: String(ownerId), 'repository_ids[]': String(repoId) });
  return `${base}/permissions?${query}`;
}

const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// apps: [{ kind, manifest, created?: { slug }, installed?: true }]. Each App shows its next step: a button that posts
// the manifest to GitHub, a link to install it on the repository, or that it is done.
export function registrationPage({ owner, repo, state, apps, ids }) {
  const rows = apps.map(({ kind, manifest, created, installed }) => {
    if (installed) return `<li><b>${escape(created.slug)}</b>: Đã tạo và đã cài.</li>`;
    if (created) {
      const link = escape(installUrl(created.slug, ids));
      return `<li><b>${escape(created.slug)}</b>: đã tạo. <a href="${link}">Cài App vào ${escape(`${owner}/${repo}`)}</a>: chọn <b>Only select repositories</b>, chọn <b>${escape(repo)}</b>, bấm <b>Install</b>.</li>`;
    }
    return `<li><form action="https://github.com/settings/apps/new?state=${escape(state)}" method="post">
<input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}">
<b>${escape(manifest.name)}</b> (${kind}): <button type="submit">Tạo App trên GitHub</button>
</form></li>`;
  });
  const done = apps.every(({ installed }) => installed);
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Tạo GitHub App cho agent</title>
<style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.6}li{margin:.8rem 0}</style>
</head><body>
<h1>Tạo GitHub App cho agent</h1>
<p>Làm lần lượt từng App: bấm <b>Tạo App trên GitHub</b>, rồi trên GitHub bấm <b>Create GitHub App</b>. GitHub quay lại đây và mở trang cài App; cài xong, GitHub lại quay về trang này.</p>
<ol>
${rows.join('\n')}
</ol>
${done ? '<p><b>Xong cả hai App.</b> Bạn có thể đóng trang này.</p>' : ''}
</body></html>
`;
}
