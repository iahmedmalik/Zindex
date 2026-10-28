import { expect, test, type Page } from "@playwright/test";
import { freshPhone, openStock, signIn } from "./helpers";

// Profit per store: a cost per piece on an order line, profit and what is missing in Reports, and the list where a
// missing cost is filled in on purpose. Names are unique because the desktop and phone runs share one database.

async function typedOrder(page: Page, item: string, price: number, cost?: number) {
  await page.goto("/orders/new");
  await page.getByLabel("WhatsApp number").fill(freshPhone());
  await page.getByLabel("Name", { exact: true }).fill("Profit Buyer");
  await page.getByRole("button", { name: "Typed item" }).click();
  await page.getByLabel("Item name").fill(item);
  await page.getByLabel(/Price of .* per pc/).fill(String(price));
  if (cost !== undefined) await page.getByLabel(/Cost of .* per pc/).fill(String(cost));
  await page.getByRole("button", { name: "Create order" }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
}

test.describe("profit", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("an item typed with no cost is reported as missing, and filling its cost on purpose clears it", async ({ page }) => {
    const mine = `Costless ${Date.now() % 1000000}`;
    await typedOrder(page, `Costed ${Date.now() % 1000000}`, 1000, 400);
    await typedOrder(page, mine, 500); // no cost: unknown, never guessed

    await page.goto("/reports");
    await page.getByRole("radio", { name: "Today" }).check({ force: true });
    await expect(page.getByRole("heading", { name: "Profit", exact: true })).toBeVisible();
    await expect(page.getByText("Not complete yet")).toBeVisible();
    await expect(page.getByText(/left out of this profit/)).toBeVisible();

    await page.getByRole("link", { name: "Fill in the costs" }).click();
    await expect(page.getByRole("heading", { name: "Costs to fill in" })).toBeVisible();
    const group = page.locator("form.well", { hasText: mine });
    await expect(group).toContainText("typed item");
    await group.getByLabel(/Cost per pc of/).fill("300");
    await group.getByRole("button", { name: "Set cost" }).click();
    await expect(page.getByText(new RegExp(`${mine}: cost set on 1 sold line`))).toBeVisible();
    await expect(page.locator("form.well", { hasText: mine })).toHaveCount(0);
  });

  test("a product shows its price and cost per piece, and a new cost is saved with a note that old sales keep theirs", async ({ page }) => {
    await openStock(page);
    await page.getByRole("button", { name: /Garam masala/ }).first().click();
    await expect(page.getByText(/per pc · /).first()).toBeVisible();
    await page.getByLabel("Cost per pc (optional)").first().fill("310");
    await page.getByRole("button", { name: "Save price and cost" }).click();
    await expect(page.getByText(/orders already made keep their own cost/)).toBeVisible();
  });
});
