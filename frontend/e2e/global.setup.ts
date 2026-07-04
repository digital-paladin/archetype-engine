/**
 * global.setup.ts
 *
 * Runs once before all tests.  Navigates to /login, submits credentials,
 * and saves storageState (localStorage with auth_token) to e2e/.auth/session.json.
 * All subsequent tests load that file via `use.storageState` in playwright.config.ts.
 */

import { test as setup, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const SESSION_PATH = path.resolve(__dirname, '.auth/session.json');

setup('authenticate', async ({ page }) => {
  const username = process.env['PLAYWRIGHT_USERNAME'];
  const password = process.env['PLAYWRIGHT_PASSWORD'];

  if (!username || !password) {
    throw new Error(
      'PLAYWRIGHT_USERNAME and PLAYWRIGHT_PASSWORD env vars must be set.\n' +
      'Copy e2e/.env.example to e2e/.env.playwright and fill in credentials.'
    );
  }

  await page.goto('/login');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').click();

  // Wait for successful redirect to dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  // Confirm the nav bar is visible — proves auth worked
  await expect(page.locator('app-root')).toBeVisible();

  // Save auth state (localStorage contains auth_token)
  await page.context().storageState({ path: SESSION_PATH });
  console.log(`[setup] Session saved to ${SESSION_PATH}`);
});
