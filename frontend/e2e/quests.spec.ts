/**
 * quests.spec.ts
 *
 * Smoke tests for the Quest Journal panel.
 * Selectors verified against quests-panel.component.ts DOM structure:
 *   - .qj-zone-block  — each class accordion block
 *   - .zone-name      — class name label (uppercase)
 *   - .qj-date-label  — date display (YYYY-MM-DD format)
 *   - .qj-nav-btn     — prev (‹) and next (›) buttons
 */

import { test, expect } from '@playwright/test';

test.describe('Quest Journal panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /quests/i }).click();
    // Wait for the quest journal shell to appear
    await expect(page.locator('.qj-shell')).toBeVisible({ timeout: 20_000 });
    // Wait for data to load — Railway can be slow; give up to 45 s for the quests API
    await expect(page.locator('.qj-loading')).not.toBeVisible({ timeout: 45_000 });
  });

  test('quest panel renders with at least one class section', async ({ page }) => {
    // Each class is a .qj-zone-block; the name is in .zone-name (uppercased)
    const zoneBlocks = page.locator('.qj-zone-block');
    // 30 s: Railway can be slow after a cold start; zone-blocks only render once
    // questClasses signal is populated (requires a successful Supabase round-trip).
    await expect(zoneBlocks.first()).toBeVisible({ timeout: 30_000 });

    const count = await zoneBlocks.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Spot-check that at least one class name matches expected values
    const zoneNames = page.locator('.zone-name');
    const nameTexts = await zoneNames.allTextContents();
    const hasExpectedClass = nameTexts.some(t =>
      /paladin|developer|redteam|artist|warrior/i.test(t)
    );
    expect(hasExpectedClass, `No expected class name found in: ${nameTexts.join(', ')}`).toBe(true);
  });

  test('date label displays a valid YYYY-MM-DD date', async ({ page }) => {
    // selectedDate() renders in .qj-date-label (YYYY-MM-DD format)
    const dateLabel = page.locator('.qj-date-label');
    await expect(dateLabel).toBeVisible({ timeout: 10_000 });

    const dateText = await dateLabel.textContent();
    expect(dateText?.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('previous/next date navigation buttons are present', async ({ page }) => {
    // .qj-nav-btn contains ‹ (prev) and › (next)
    const navBtns = page.locator('.qj-nav-btn');
    const count = await navBtns.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Both should be visible
    await expect(navBtns.first()).toBeVisible();
    await expect(navBtns.last()).toBeVisible();
  });
});
