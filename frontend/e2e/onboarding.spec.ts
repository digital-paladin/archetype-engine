/**
 * onboarding.spec.ts
 *
 * Thin SaaS onboarding: Create account → birth date → dashboard with age level.
 * Runs WITHOUT storageState (fresh Hunter).
 *
 * Demo credentials (optional — if unset, generates a unique email):
 *   PLAYWRIGHT_DEMO_EMAIL
 *   PLAYWRIGHT_DEMO_PASSWORD
 *   PLAYWRIGHT_DEMO_BIRTH_DATE  (YYYY-MM-DD, default 1995-03-01 → age 31 on 2026-07-13)
 */

import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

function expectedAge(birthDate: string, now = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = now.getUTCFullYear() - y;
  const hadBirthday =
    now.getUTCMonth() + 1 > m ||
    (now.getUTCMonth() + 1 === m && now.getUTCDate() >= d);
  if (!hadBirthday) age--;
  return age;
}

test.describe('Thin onboarding', () => {
  test('create account with birth date lands on dashboard at age level', async ({ page }) => {
    test.setTimeout(120_000);

    const stamp = Date.now();
    const email =
      process.env['PLAYWRIGHT_DEMO_EMAIL'] ||
      `demo.hunter+${stamp}@digitalpaladin.test`;
    const password =
      process.env['PLAYWRIGHT_DEMO_PASSWORD'] ||
      `DemoHunter_${stamp}_Aa1!`;
    const birthDate = process.env['PLAYWRIGHT_DEMO_BIRTH_DATE'] || '1995-03-01';
    const age = expectedAge(birthDate);

    await page.goto('/login');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.locator('#signup-email')).toBeVisible();
    await page.locator('#signup-email').fill(email);
    await page.locator('#signup-password').fill(password);
    await page.locator('#signup-password2').fill(password);
    await page.locator('#birth-date').fill(birthDate);

    await page.getByRole('button', { name: 'Begin journey' }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });

    // Character display level badge: "Level {{ characterLevel }}"
    await expect(page.locator('.level-badge')).toContainText(String(age), {
      timeout: 30_000,
    });
  });
});
