import { defineConfig, devices, type Project } from '@playwright/test';

// E2E tests start both apps here: web on :3000, api on :3001. The tests reach the API through /api/notes of the web
// (ADR-0002), as the browser does, so they run the same way on an environment of the VPS, where the API is not public.
//
// With E2E_BASE_URL, such as https://sample-dev.ao.t2g.io.vn for /ao-qa, one `playwright test` runs two projects:
// - local: the tests tagged @local, on the apps started here. They call the API itself, which only the apps of an
//   environment reach.
// - environment: every other test, on E2E_BASE_URL, with basic auth from E2E_HTTP_USER and E2E_HTTP_PASSWORD when both
//   are set. Chrome and the request fixture send that basic auth to the origin of E2E_BASE_URL only.
// Without E2E_BASE_URL every test runs on the apps started here, as before.
//
// Playwright writes the context options into a trace, httpCredentials with the password in clear, so the trace of an
// environment test holds the basic auth of Development or Staging. The kit keeps those traces off Jira: behind basic
// auth, ao-step keeps them on this machine (.ai-orchestrator/lib/workflow/qa.mjs). Do not upload test-results/ anywhere
// else either.
const LOCAL_URL = 'http://localhost:3000';
const BASE_URL = process.env.E2E_BASE_URL || undefined;
const USER = process.env.E2E_HTTP_USER;
const PASSWORD = process.env.E2E_HTTP_PASSWORD;

const chrome = devices['Desktop Chrome'];
const projects: Project[] =
  BASE_URL === undefined
    ? [{ name: 'chromium', use: { ...chrome } }]
    : [
        { name: 'local', grep: /@local/, use: { ...chrome } },
        {
          name: 'environment',
          grepInvert: /@local/,
          use: {
            ...chrome,
            baseURL: BASE_URL,
            ...(USER && PASSWORD ? { httpCredentials: { username: USER, password: PASSWORD, origin: new URL(BASE_URL).origin } } : {}),
          },
        },
      ];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: LOCAL_URL,
    trace: 'on-first-retry',
  },
  projects,
  webServer: [
    {
      command: 'npm run start -w api',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -w web',
      url: LOCAL_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
