import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// The free API sleeps when idle and answers 502/503/504 (a plain page, not JSON) while it wakes.
// The app must keep saying "Opening your shop…" and carry on once the API is back.
test("a sleeping API shows only 'Opening your shop…' and then the shop", async ({ page }) => {
  await signIn(page);

  let asleepFor = 2;
  await page.route("**/backend/v1/me", async (route) => {
    if (asleepFor-- > 0) await route.fulfill({ status: 503, contentType: "text/html", body: "<html>Service Unavailable</html>" });
    else await route.continue();
  });

  await page.reload();
  await expect(page.getByText("Opening your shop…", { exact: true })).toBeVisible();
  await expect(page.getByText(/waking up/i)).toHaveCount(0);
  await expect(page.getByText("Something went wrong.")).toHaveCount(0);
  await expect(page.getByText("Needs you now")).toBeVisible({ timeout: 30_000 });
});

test("an unexpected API error says what failed, with its code", async ({ page }) => {
  await signIn(page);
  await page.route("**/backend/v1/me", (route) => route.fulfill({ status: 500, contentType: "text/html", body: "<html>oops</html>" }));
  await page.reload();
  await expect(page.locator("p.error")).toHaveText("Something went wrong (500).");
});
