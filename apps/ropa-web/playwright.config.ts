import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { e2eDatabaseUrl } from './e2e/database.ts';
import { loadRootEnvFile } from './src/lib/root-env.ts';

// The smoke test runs the real thing: the built API on its own database with
// the Hireloop story replayed, and the built web app in front of it, reading
// through the rewrite (open question 5). Locally the secrets come from the
// root .env; in CI from the job.
const root = fileURLToPath(new URL('../..', import.meta.url));
loadRootEnvFile(`${root}.env`);

// Ports of their own. Never reused: a run always seeds and builds afresh, and
// if something else holds a port the run stops, saying so, rather than
// testing whatever answers there.
const API = 'http://127.0.0.1:3310';
const WEB = 'http://127.0.0.1:3311';
const CI = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: CI,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: WEB, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'api',
      cwd: root,
      command: [
        'node apps/ropa-web/e2e/create-database.ts',
        'npm run db:migrate',
        'npm run db:seed -- --reset',
        'npm run start -w apps/ropa-api',
      ].join(' && '),
      env: { DATABASE_URL: e2eDatabaseUrl(process.env), PORT: '3310', LOG_LEVEL: 'warn' },
      url: `${API}/healthz`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
    },
    {
      name: 'web',
      cwd: root,
      // Built each run: the rewrite compiles in the API's address.
      command: 'npm run build -w apps/ropa-web && npm run start -w apps/ropa-web',
      env: { ROPA_API_URL: API, PORT: '3311' },
      url: `${WEB}/healthz`,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: 'ignore',
    },
  ],
});
