import { defineConfig } from "@playwright/test";

/**
 * Visual-review config: walks every public page at four viewports and writes
 * `fullPage` PNGs to `web/screenshots/`. Not a regression suite — we do not
 * diff against baselines here. Run when you want to eyeball responsive
 * behaviour across the site.
 *
 * Run: `pnpm screenshots`
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
