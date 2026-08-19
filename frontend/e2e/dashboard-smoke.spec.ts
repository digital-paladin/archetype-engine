/**
 * dashboard-smoke.spec.ts
 *
 * Structural smoke tests for the main dashboard.
 *
 * Coverage:
 *   1. All nav tab buttons are present
 *   2. Character tab is active by default on load
 *   3. Each tab is clickable and sets the active class — no Angular error overlay
 *
 * Auth: Uses saved storageState from global.setup.ts (pre-authenticated).
 * Intent: Catch deploy-breaking regressions (Angular build error, missing component,
 *         routing breakage) within ~15 s. No API data assertions — loading states
 *         are tested by panel-specific specs (analytics.spec.ts, quests.spec.ts).
 */

import { test, expect, type Page } from '@playwright/test';

// Mirrors dashboard.component.ts NAV_TABS labels exactly. Update when tabs change.
// Click via exact .eso-tab-label — "Quests" is a substring of "Quests (Todoist)".
const NAV_TABS = [
  { id: 'character',   label: 'Character'         },
  { id: 'skills',      label: 'Skills'            },
  { id: 'health',      label: 'Health'            },
  { id: 'sleep',       label: 'Sleep'             },
  { id: 'acm',         label: 'ACM'               },
  { id: 'nutrition',   label: 'Nutrition'         },
  { id: 'quests',      label: 'Quests'            },
  { id: 'analytics',   label: 'Analytics'         },
  { id: 'buffs',       label: 'Buffs'             },
  { id: 'vault',       label: 'Vault'             },
  { id: 'courage',     label: 'Courage'           },
  { id: 'rewards',     label: 'Rewards'           },
  { id: 'treasury',    label: 'Treasury'          },
  { id: 'billing',     label: 'Billing'           },
  { id: 'quest-lines', label: 'Quest Lines'       },
  { id: 'inventory',   label: 'Inventory'         },
  { id: 'crafting',    label: 'Crafting'          },
  { id: 'todoist',     label: 'Quests (Todoist)'  },
];

function navTab(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('.eso-tab-bar .eso-tab').filter({
    has: page.locator('.eso-tab-label', { hasText: new RegExp(`^${escaped}$`) }),
  });
}

test.describe('Dashboard smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    // Nav bar renders synchronously — if this times out, the build is broken
    await expect(page.locator('.eso-tab-bar')).toBeVisible({ timeout: 20_000 });
  });

  // ── 1. All tabs present ───────────────────────────────────────────────────
  test('all nav tab buttons are present', async ({ page }) => {
    const tabs = page.locator('.eso-tab-bar .eso-tab');
    await expect(tabs.first()).toBeVisible();
    const count = await tabs.count();
    expect(count, `Expected ${NAV_TABS.length} nav tabs, found ${count}`).toBe(NAV_TABS.length);
  });

  // ── 2. Default active tab ─────────────────────────────────────────────────
  test('Character tab is active on initial load', async ({ page }) => {
    const activeTab = page.locator('.eso-tab.eso-tab-active .eso-tab-label');
    await expect(activeTab).toBeVisible();
    const label = await activeTab.textContent();
    expect(label?.trim()).toBe('Character');
  });

  // ── 3. Each tab is clickable without crashing ─────────────────────────────
  // These run as individual named tests so failures pinpoint the broken panel.
  for (const tab of NAV_TABS) {
    test(`"${tab.label}" tab: clickable, sets active class, no error overlay`, async ({ page }) => {
      // Exact label only — hasText: 'Quests' also matches 'Quests (Todoist)'
      await navTab(page, tab.label).click();

      // Active class should move to this tab within 3 s (pure CSS + signal update — no API wait)
      const activeLabel = page.locator('.eso-tab.eso-tab-active .eso-tab-label');
      await expect(activeLabel).toHaveText(new RegExp(`^${tab.label}$`, 'i'), { timeout: 3_000 });

      // No Angular crash overlay should be present
      // Angular renders <app-error-overlay> or throws to the console on fatal errors
      await expect(page.locator('[data-testid="error-overlay"], .ng-error-overlay')).toHaveCount(0);
    });
  }
});
