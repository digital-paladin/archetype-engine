/**
 * demo.spec.ts — Public Try Demo flow (unauthed).
 *
 * Skips when DEMO is not configured on the API (503).
 * Never requires a password in the client or README.
 */

import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Try demo', () => {
  test('Try demo button is visible on login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#try-demo')).toBeVisible({ timeout: 15_000 });
  });

  test('Try demo navigates to dashboard when configured', async ({ page, request }) => {
    test.setTimeout(90_000);

    const apiUrl =
      process.env['PLAYWRIGHT_API_URL'] ||
      process.env['API_URL'] ||
      'http://127.0.0.1:3000';

    const probe = await request.post(`${apiUrl}/api/auth/demo-login`, {
      data: {},
      failOnStatusCode: false,
    });

    if (probe.status() === 503) {
      test.skip(true, 'DEMO_USER_ID not configured on API — Human gate pending');
    }

    await page.goto('/login');
    await page.locator('#try-demo').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    await expect(page.locator('.level-badge, .overall-level, [class*="level"]').first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
