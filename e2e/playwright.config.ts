import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the DocFlow end-to-end suite.
 *
 * Prerequisites (see specs/two-org-isolation.spec.ts header):
 *   - the local Supabase stack is running (`supabase start`) with the
 *     deterministic fixtures from supabase/seed.sql applied. CI runs
 *     `supabase db reset` first; locally a reset is NOT required as long as
 *     the seed users/orgs/documents exist (every seed insert is idempotent).
 *   - Node >= 24 on PATH (repo engines requirement).
 *
 * The app itself is started by the webServer block below on a dedicated port
 * (3111) so the suite never fights the conventional dev server on 3001.
 * NOTE: Next 16 holds a lock at apps/DocFlow/.next/dev/lock — only ONE
 * `next dev` instance can run per app directory, so stop a 3001 dev server
 * before running this suite (or point reuseExistingServer at 3111 yourself).
 */
export default defineConfig({
  testDir: './specs',
  /* Generous budgets: dev-mode webpack compiles routes on first hit. */
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3111',
    navigationTimeout: 120_000,
    actionTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm --dir ../apps/DocFlow dev',
    url: 'http://localhost:3111',
    env: { PORT: '3111' },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
