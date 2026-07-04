/**
 * auth.spec.ts
 *
 * Smoke tests for login / auth guard.
 * These run WITHOUT the saved storageState (they test the unauthed flow).
 */

import { test, expect } from '@playwright/test';

// Override storageState — these tests need to be unauthenticated
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {
  test('unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('login page renders username and password inputs', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('wrong credentials show error message', async ({ page }) => {
    test.setTimeout(90_000); // Railway cold start can take 45+ s before returning 401
    await page.goto('/login');
    await page.locator('#username').fill('wrong_user');
    await page.locator('#password').fill('wrong_pass');
    await page.locator('button[type="submit"]').click();
    // Should stay on login, not redirect
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    // Error is rendered inside .error-message > pre (auth.service.ts line 68)
    // Give Railway up to 60 s to respond with the 401 so errorMessage() signal is set
    await expect(page.locator('.error-message')).toBeVisible({ timeout: 60_000 });
  });
});
