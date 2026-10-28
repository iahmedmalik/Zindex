import { expect, test } from "@playwright/test";
import { DEMO } from "./helpers";

// The walk-through tour: it opens on a first sign-in and every time the demo starts, closes with
// Skip (and stays closed), and can be replayed from More. It must also fit a 375 px phone.

test.describe("the walk-through tour", () => {
  test("@smoke opens on a first sign-in, stays closed after Skip, and replays from More", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(DEMO.email);
    await page.getByLabel("Password").fill(DEMO.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    const card = page.getByRole("dialog");
    await expect(card.getByRole("heading", { name: "Today at a glance" })).toBeVisible();
    await expect(card.getByText(/Step 1 of \d/)).toBeVisible();
    await card.getByRole("button", { name: "Next", exact: true }).click();
    await expect(card.getByRole("heading", { name: "What needs you" })).toBeVisible();

    // The card stays on screen on every size (never cut off at the edges).
    const box = (await card.locator(".tour-card").boundingBox())!;
    const view = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(view.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height);

    await page.keyboard.press("Escape"); // Escape is the same as Skip
    await expect(card).toBeHidden();

    await page.reload();
    await expect(page.getByText("Needs you now")).toBeVisible();
    await page.waitForTimeout(2500); // long enough for it to have opened, if it were going to
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto("/more");
    await page.getByRole("button", { name: "Replay the tour" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Today at a glance" })).toBeVisible();
  });

  test("@smoke 'Try the demo' opens the preloaded demo with its reminder and the tour, and signs out cleanly", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Try the demo" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Today at a glance" })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByText(/You're in the demo/)).toBeVisible();
    await expect(page.getByRole("button", { name: /All stores|Sheen/ })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
