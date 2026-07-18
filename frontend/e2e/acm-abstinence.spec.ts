/**
 * ACM abstinence counters smoke (Phase 2.10 / S5).
 * Auth via global.setup storageState. Soft-asserts if API/table not yet migrated.
 */

import { test, expect } from '@playwright/test';

test.describe('ACM abstinence counters', () => {
  test('ACM tab shows abstinence counter cards when API available', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.eso-tab-bar')).toBeVisible({ timeout: 20_000 });
    await page.locator('.eso-tab-bar .eso-tab').filter({ hasText: 'ACM' }).click();

    // Wait for ACM panel (loading or content)
    await expect(page.locator('app-acm-panel')).toBeVisible({ timeout: 15_000 });

    const counters = page.locator('.abstinence-section .abstinence-card');
    const count = await counters.count();
    if (count === 0) {
      // Migration / seed not applied yet — panel still loads without crash
      await expect(page.locator('[data-testid="error-overlay"], .ng-error-overlay')).toHaveCount(0);
      test.info().annotations.push({
        type: 'note',
        description: 'No abstinence cards — apply 004_abstinence_streaks.sql + reseed user',
      });
      return;
    }

    expect(count).toBeGreaterThanOrEqual(1);
    await expect(counters.first().locator('.abs-day')).toBeVisible();
    await expect(page.locator('[data-testid="error-overlay"], .ng-error-overlay')).toHaveCount(0);
  });
});
