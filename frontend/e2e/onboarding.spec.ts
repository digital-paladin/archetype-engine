/**
 * onboarding.spec.ts — thin signup + identity scaffold (domains → class).
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
  test('create account with domains lands on dashboard at age level', async ({ page }) => {
    test.setTimeout(120_000);

    const stamp = Date.now();
    const emailLocal =
      (process.env['PLAYWRIGHT_DEMO_EMAIL'] || 'demo.hunter').split('@')[0].replace(/\+.*/, '');
    const email = `${emailLocal}+${stamp}@digitalpaladin.test`;
    const password =
      process.env['PLAYWRIGHT_DEMO_PASSWORD'] || `DemoHunter_${stamp}_Aa1!`;
    const birthDate = process.env['PLAYWRIGHT_DEMO_BIRTH_DATE'] || '1995-03-01';
    const age = expectedAge(birthDate);
    console.log(`[onboarding] signing up as ${email} (expect Level ${age})`);

    await page.goto('/login');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.locator('#signup-email')).toBeVisible();
    await page.locator('#signup-email').fill(email);
    await page.locator('#signup-password').fill(password);
    await page.locator('#signup-password2').fill(password);
    await page.locator('#birth-date').fill(birthDate);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.locator('#domain-grid')).toBeVisible({ timeout: 15_000 });
    const chips = page.locator('.domain-chip');
    await chips.nth(0).click();
    await chips.nth(1).click();
    await chips.nth(2).click();
    await expect(page.locator('#suggested-class')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Begin journey' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    await expect(page.locator('.level-badge')).toContainText(String(age), {
      timeout: 30_000,
    });
  });
});
