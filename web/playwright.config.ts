import { defineConfig, devices } from "@playwright/test";

// System tests drive the real app (web + API + database) as the demo owner made by `npm run seed -w @zindex/api`.
// Start the stack first: dev database, API (port 4000), web (port 3500). Point E2E_BASE_URL at a deployed
// copy to run the @smoke set after a deploy. Every test creates its own orders, so reruns are safe.
// Layout, touch and accessibility checks run in a 375 px phone view as well as desktop. On this PC the
// browser is desktop Edge (it is Chromium); in CI the bundled Chromium is used.
const channel = process.env.CI ? undefined : "msedge";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  // Live runs talk to a free server that is sometimes slow to answer, so each check may wait longer there.
  expect: { timeout: process.env.E2E_LIVE_DEMO === "1" ? 30_000 : 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3500", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], channel, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
});
