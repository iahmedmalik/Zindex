import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// The free API sleeps when idle and answers 502/503/504 (a plain page, not JSON) while it wakes.
// The app keeps saying "Opening your shop…", shows the "Waking the server…" bar, and carries on once the API is back.
test("a sleeping API shows only 'Opening your shop…' and then the shop", async ({ page }) => {
  await signIn(page);

  let asleepFor = 2;
  await page.route("**/backend/v1/me", async (route) => {
    if (asleepFor-- > 0) await route.fulfill({ status: 503, contentType: "text/html", body: "<html>Service Unavailable</html>" });
    else await route.continue();
  });

  await page.reload();
  await expect(page.getByText("Opening your shop…", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Waking the server…" })).toBeVisible();
  await expect(page.getByText("Something went wrong.")).toHaveCount(0);
  await expect(page.getByText("Needs you now")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: "Waking the server…" })).toHaveCount(0);
});

test("an unexpected API error says what failed, with its code", async ({ page }) => {
  await signIn(page);
  await page.route("**/backend/v1/me", (route) => route.fulfill({ status: 500, contentType: "text/html", body: "<html>oops</html>" }));
  await page.reload();
  await expect(page.locator("p.error")).toHaveText("Something went wrong (500).");
});

test("sign-in waits for a sleeping server, then opens up, and sends nothing in between", async ({ page }) => {
  let asleepFor = 2;
  const writes: string[] = [];
  page.on("request", (r) => r.method() === "POST" && writes.push(r.url()));
  await page.route("**/backend/health", async (route) => {
    if (asleepFor-- > 0) await route.fulfill({ status: 503, contentType: "text/html", body: "<html>Service Unavailable</html>" });
    else await route.continue();
  });

  await page.goto("/sign-in");
  await expect(page.getByRole("status").filter({ hasText: "Waking Zindex up" })).toBeVisible();
  await expect(page.getByText("This takes about 30 seconds, then you're in.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Waiting for the server" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Try the demo" })).toBeDisabled();

  await expect(page.getByText("Zindex is awake")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Try the demo" })).toBeEnabled();
  expect(writes).toEqual([]);
});

test("@smoke an awake server shows no waking card at all", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await expect(page.getByText("Waking Zindex up")).toHaveCount(0);
  await expect(page.getByText("Zindex is awake")).toHaveCount(0);
});

test("a server that never answers ends in 'Can't reach the server' with a way to try again", async ({ page }) => {
  test.setTimeout(150_000);
  await page.route("**/backend/health", (route) => route.abort());
  await page.goto("/sign-in");
  await expect(page.getByRole("alert").filter({ hasText: "Can't reach the server" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Waiting for the server" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await page.unroute("**/backend/health");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled({ timeout: 30_000 });
});
