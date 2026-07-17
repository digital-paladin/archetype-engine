import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration.
 *
 * Credentials are read from env vars — never hardcoded.
 * Set them in a local .env.playwright file (gitignored) or in CI secrets:
 *
 *   PLAYWRIGHT_BASE_URL   — e.g. https://your-frontend.vercel.app
 *   PLAYWRIGHT_API_URL    — e.g. https://your-backend.up.railway.app
 *   PLAYWRIGHT_USERNAME   — dashboard login username
 *   PLAYWRIGHT_PASSWORD   — dashboard login password
 */

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,       // dashboard is stateful — run sequentially
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,          // Railway cold starts can be slow
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:4200',
    // storageState applied only on chromium project after setup creates the file
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    // ── 1. Global setup: login once, save storageState ──────────────────────
    {
      name: 'setup',
      testMatch: '**/global.setup.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    // ── 2. Authed smoke tests (depend on setup) ─────────────────────────────
    {
      name: 'chromium',
      testIgnore: ['**/global.setup.ts', '**/onboarding.spec.ts', '**/auth.spec.ts', '**/demo.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/session.json',
      },
      dependencies: ['setup'],
    },

    // ── 3. Unauthed / onboarding flows (no saved session) ───────────────────
    {
      name: 'chromium-onboarding',
      testMatch: ['**/onboarding.spec.ts', '**/auth.spec.ts', '**/demo.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
      },
    },
  ],

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
});
