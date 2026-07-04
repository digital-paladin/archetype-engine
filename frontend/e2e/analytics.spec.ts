/**
 * analytics.spec.ts
 *
 * Smoke tests for the Analytics panel.
 *
 * NOTE on heatmap data: Analytics are now Supabase-first (Phase 1 migration complete).
 * xp_history table has 193 rows (Mar 9 → Apr 30, 2026). CHARACTER_FILE_PATH has been
 * removed from Railway env vars — the file-parser path is fully retired.
 * Heatmap labels come from xp_history.earned_at formatted by the frontend.
 *
 * Architecture note: All 5 tests share a single browser context loaded in beforeAll.
 * This avoids repeated Railway cold-start latency per test (each fresh context = new
 * /api/character/analytics request = possible timeout/cold-start). The panel is loaded
 * once; subsequent tests validate different sections of the same loaded data.
 *
 * Coverage:
 *   1. Panel renders without error (TTL section visible)
 *   2. Heatmap shows substantial entries (>10), not stuck empty — arrow fix regression
 *   3. Time-to-next-level lists all 7 classes
 *   4. XP Velocity section heading renders (rows depend on data availability)
 *   5. Grit Score trend section renders (bars depend on data availability)
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';

test.describe.serial('Analytics panel', () => {
  let ctx: BrowserContext;
  let pg: Page;

  test.beforeAll(async ({ browser }) => {
    // Create ONE context for all analytics tests so the panel is loaded only once.
    // Each fresh context triggers a new /api/character/analytics call; reusing the
    // same context means Railway only has to warm up once.
    ctx = await browser.newContext({ storageState: 'e2e/.auth/session.json' });
    pg  = await ctx.newPage();
    await pg.goto('/dashboard');
    await pg.getByRole('button', { name: /analytics/i }).click();
    // Wait for loading state to clear — Railway cold starts can take 20-40s
    await expect(pg.locator('.pa-loading')).not.toBeVisible({ timeout: 45_000 });
  });

  test.afterAll(async () => {
    await ctx.close();
  });

  // ── 1. Panel renders ──────────────────────────────────────────────────────
  test('analytics panel loads without error state', async () => {
    // Root container should be visible
    await expect(pg.locator('.pa-root')).toBeVisible();
    // TTL section is always present when data loads
    await expect(pg.locator('.pa-ttl-row').first()).toBeVisible();
  });

  // ── 2. Heatmap renders entries — regression for arrow regex (→ vs ->) ─────
  // The arrow-format fix ensures parseRecentEntries() works for both → and -> headers.
  test('heatmap renders substantial entries (arrow regex regression)', async () => {
    const heatmapLabels = pg.locator('.pa-heat-label');
    await expect(heatmapLabels.first()).toBeVisible({ timeout: 10_000 });

    const labelTexts = await heatmapLabels.allTextContents();

    // Should have 10+ entries — proves the parser found real data, not stuck empty
    // (Live Railway env shows ~16 entries from xp_history DB; threshold is intentionally
    // loose to survive data fluctuations while still catching a fully-empty heatmap)
    expect(
      labelTexts.length,
      `Expected 10+ heatmap entries (arrow regex fix), got: ${labelTexts.length}`
    ).toBeGreaterThanOrEqual(10);

    // All labels should match a date pattern ("Mar 7", "Dec 28", etc.)
    const allAreDates = labelTexts.every(t => /^[A-Z][a-z]{2} \d{1,2}$/.test(t));
    expect(allAreDates, `Non-date label found in: ${labelTexts.slice(0, 3).join(', ')}`).toBe(true);
  });

  // ── 3. Time to next level — all 7 classes ────────────────────────────────
  test('Time to Next Level section lists all 7 classes', async () => {
    const rows = pg.locator('.pa-ttl-row');
    await expect(rows.first()).toBeVisible();

    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(7);

    // Spot-check key classes by name
    const names = pg.locator('.pa-ttl-name');
    const nameTexts = await names.allTextContents();
    const normalised = nameTexts.map(n => n.toLowerCase());

    expect(normalised).toContain('developer');
    expect(normalised).toContain('sage');
    expect(normalised).toContain('warrior');
    expect(normalised).toContain('redteamer');
  });

  // ── 4. XP Velocity section renders ───────────────────────────────────────
  test('XP Velocity section renders', async () => {
    // The section heading always renders
    await expect(pg.getByText(/xp velocity/i)).toBeVisible();

    // Rows appear when projection data is available; check if any exist
    const projRows = pg.locator('.pa-proj-row');
    const rowCount = await projRows.count();
    if (rowCount > 0) {
      // If rows exist, Developer should be one of them
      await expect(pg.locator('.pa-proj-row').filter({ hasText: /developer/i })).toBeVisible();
    }
    // If 0 rows: projection data unavailable in this environment (not a test failure)
  });

  // ── 5. Grit Score section renders ────────────────────────────────────────
  // Section is conditionally rendered (*ngIf="gritEntries().length > 0").
  // If no grit data is logged (e.g. Railway env without a seeded journal), the section
  // is simply absent — that is not a test failure.
  test('Grit Score trend section renders when data present', async () => {
    const heading = pg.getByText(/grit score trend/i);
    const visible = await heading.isVisible().catch(() => false);

    if (!visible) {
      // No grit data in this environment — section hidden by *ngIf, skip assertions
      test.skip(true, 'Grit Score section hidden (*ngIf): no grit entries in this environment');
      return;
    }

    await expect(heading).toBeVisible();
    const bars = pg.locator('.pa-grit-bar');
    const barCount = await bars.count();
    if (barCount > 0) {
      expect(barCount).toBeGreaterThanOrEqual(7);
    }
  });
});
