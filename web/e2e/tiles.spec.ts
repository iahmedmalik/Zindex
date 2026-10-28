import { expect, test } from "@playwright/test";
import { createOrder, signIn } from "./helpers";

test.describe("Today tiles", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("@smoke each tile opens the orders it counts, not all orders", async ({ page }) => {
    const name = `Tile Walker ${Date.now() % 1000000}`; // desktop and phone runs share one database
    await createOrder(page, { name, rider: "300" });
    await page.getByRole("button", { name: "Confirm order", exact: true }).click();
    await expect(page.getByText(/#\d+ is confirmed/)).toBeVisible();
    await page.getByRole("link", { name: "Today" }).first().click();

    await page.getByRole("link", { name: /To pack/ }).first().click();
    await expect(page).toHaveURL(/status=confirmed/);
    await expect(page.getByRole("button", { name: /Stage: Confirmed/ })).toBeVisible();
    await expect(page.locator("a.row", { hasText: name })).toBeVisible();
    for (const badge of await page.locator("a.row .badge").allInnerTexts()) expect(badge).toBe("Confirmed");

    await page.getByRole("link", { name: "Today" }).first().click();
    await page.getByRole("link", { name: /On the way/ }).first().click();
    await expect(page).toHaveURL(/status=out_for_delivery/);
    await expect(page.locator("a.row", { hasText: name })).toHaveCount(0);
  });
});
