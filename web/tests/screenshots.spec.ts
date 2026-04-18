import { test } from "@playwright/test";

/**
 * Walk every public page at four viewports and write full-page PNGs to
 * `web/screenshots/`. To extend: add to PAGES or VIEWPORTS.
 *
 * Naming convention: `{viewport}-{page}.png`. Flat directory so they sort
 * alphabetically and you can eyeball a whole viewport in one glance.
 *
 * Each page declares how to know it has rendered:
 *   - `waitFor` CSS selector — wait for that element to be visible (preferred)
 *   - `settle` milliseconds — explicit wait (used for map pages that have no
 *     reliable DOM signal)
 *   - neither — wait for the Bulgarian loading indicator to disappear
 */

type PageSpec = {
  name: string;
  path: string;
  waitFor?: string;
  settle?: number;
};

const PAGES: PageSpec[] = [
  { name: "landing", path: "/", waitFor: 'a[href^="/browse/district/"]' },
  // Map-heavy pages — MapLibre tiles + data have no reliable DOM signal, so
  // we just wait long enough for them to settle.
  { name: "results", path: "/1/results", settle: 5000 },
  { name: "sections-map", path: "/1/sections", settle: 5000 },
  { name: "sections-map-benford", path: "/1/sections?m=benford", settle: 5000 },
  { name: "sections-table", path: "/1/table", waitFor: "tbody tr" },
  { name: "persistence", path: "/persistence", waitFor: "tbody tr" },
  // Section with a known high anomaly score so the detail page is densely
  // populated — good for eyeballing the three-context layout at once.
  { name: "section-detail", path: "/section/013300091" },
  { name: "help-explorer", path: "/help/explorer", settle: 500 },
  { name: "design-system", path: "/design-system", settle: 500 },
];

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
  { name: "wide", width: 1600, height: 900 },
];

for (const v of VIEWPORTS) {
  test.describe(v.name, () => {
    test.use({ viewport: { width: v.width, height: v.height } });
    for (const p of PAGES) {
      test(p.name, async ({ page }) => {
        await page.goto(p.path, { waitUntil: "load" });

        if (p.waitFor) {
          // Wait for the data-ready selector. Non-fatal — if it does not
          // show up, we screenshot what is there.
          await page
            .locator(p.waitFor)
            .first()
            .waitFor({ state: "visible", timeout: 10_000 })
            .catch(() => {});
        } else if (p.settle === undefined) {
          // Default: wait for the Bulgarian loading indicator to disappear.
          await page
            .waitForFunction(
              () => !document.body.innerText.includes("Зареждане"),
              undefined,
              { timeout: 10_000 },
            )
            .catch(() => {});
        }

        // Final settle for async renders (map animations, fade-ins).
        await page.waitForTimeout(p.settle ?? 800);

        await page.screenshot({
          path: `screenshots/${v.name}-${p.name}.png`,
          fullPage: true,
        });
      });
    }
  });
}
