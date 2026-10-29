import { expect, test } from "@playwright/test";
import { createOrder, freshPhone, openCustomers, signIn } from "./helpers";

// An old customer is found by typing their name or their number, and a customer can be saved with a name only.
// Names are unique because the desktop and phone runs share one database.

test.describe("customers", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("typing part of a name offers the old customer, and tapping fills the number too", async ({ page }) => {
    const stamp = String(Date.now() % 1000000);
    const phone = freshPhone();
    await createOrder(page, { name: `Findable ${stamp}`, phone });

    await page.goto("/orders/new");
    await page.getByLabel("Name", { exact: true }).fill(`Findable ${stamp}`.slice(0, 14));
    const match = page.getByRole("button", { name: new RegExp(`Findable ${stamp}`) });
    await expect(match).toBeVisible();
    await match.click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`Findable ${stamp}`);
    await expect(page.getByLabel("WhatsApp number")).toHaveValue(phone);
    await expect(match).toHaveCount(0); // the offer closes and does not come back for the name just picked
  });

  test("an order with a name and no number saves the customer, and the Customers list shows them", async ({ page }) => {
    const name = `Nameonly ${Date.now() % 1000000}`;
    await createOrder(page, { name, phone: "" });

    await openCustomers(page);
    await page.getByLabel("Search customers").fill(name);
    const row = page.locator("li.row", { hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("No number");
    await expect(row.getByRole("link", { name: /WhatsApp/ })).toHaveCount(0); // no number, so no WhatsApp button
  });

  test("a customer can be edited from the Customers page, and deleted behind the confirm card", async ({ page }) => {
    const stamp = String(Date.now() % 1000000);
    await createOrder(page, { name: `Typo Nme ${stamp}`, phone: freshPhone() });

    await openCustomers(page);
    await page.getByLabel("Search customers").fill(`Typo Nme ${stamp}`);
    await page.getByRole("button", { name: `Edit Typo Nme ${stamp}` }).click();
    const card = page.getByRole("dialog", { name: "Edit customer" });
    await card.getByLabel("Name").fill(`Fixed Name ${stamp}`);
    await card.getByLabel(/Addresses/).fill("House 1, Model Town\nShop 4, Main Market");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Fixed Name ${stamp} saved`)).toBeVisible();

    await page.getByLabel("Search customers").fill(`Fixed Name ${stamp}`);
    const row = page.locator("li.row", { hasText: `Fixed Name ${stamp}` });
    await expect(row).toContainText("House 1, Model Town (+1)");

    await row.getByRole("button", { name: /^Edit / }).click();
    await page.getByRole("dialog", { name: "Edit customer" }).getByRole("button", { name: "Delete customer" }).click();
    await page.getByRole("dialog", { name: /^Delete / }).getByRole("button", { name: "Delete customer" }).click();
    await expect(page.getByText(`Fixed Name ${stamp} deleted`)).toBeVisible();
    await expect(page.locator("li.row", { hasText: `Fixed Name ${stamp}` })).toHaveCount(0);
  });
});
