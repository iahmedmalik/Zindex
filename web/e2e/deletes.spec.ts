import { expect, test } from "@playwright/test";
import { createOrder, freshPhone, openStock, signIn } from "./helpers";

// Deleting a product keeps every past number; deleting an order is strict (pending or cancelled, latest invoice number).
// Names are unique because the desktop and phone runs share one database.

test.describe("deleting", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("a deleted product leaves the catalogue, and the old order that sold it keeps its line", async ({ page }) => {
    const name = `Delete Me ${Date.now() % 1000000}`;
    await openStock(page);
    await page.getByRole("button", { name: "Product", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel(/Price per pc \(PKR\)/).first().fill("100");
    await page.getByLabel(/Cost per pc \(for profit/).fill("60");
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByText(`${name} added`)).toBeVisible();

    // sell it
    await page.goto("/orders/new");
    await page.getByLabel("WhatsApp number").fill(freshPhone());
    await page.getByLabel("Name", { exact: true }).fill("Product Seller");
    await page.locator("button.chip", { hasText: name }).first().click();
    await page.getByRole("button", { name: "Create order" }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    const orderUrl = page.url();

    // delete it
    await openStock(page);
    await page.getByRole("button", { name: new RegExp(name) }).first().click();
    page.once("dialog", (d) => { expect(d.message()).toMatch(/sales, profit and invoices do not change/); void d.accept(); });
    await page.getByRole("button", { name: "Delete product" }).click();
    await expect(page.getByText(`${name} deleted`)).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(name) })).toHaveCount(0);

    // the old order still shows what was sold
    await page.goto(orderUrl);
    await expect(page.getByRole("group", { name: /Receipt for order/ })).toContainText(name);
  });

  test("a pending order with the store's latest invoice can be deleted, and it is gone from the list", async ({ page }) => {
    const buyer = `Delete Buyer ${Date.now() % 1000000}`;
    await createOrder(page, { name: buyer });
    await expect(page.getByRole("heading", { name: "Delete this order" })).toBeVisible();
    page.once("dialog", (d) => { void d.accept(); });
    await page.getByRole("button", { name: "Delete order" }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByText(/Order #\d+ deleted/)).toBeVisible();
    await expect(page.locator("a.row", { hasText: buyer })).toHaveCount(0);
  });

  test("an older order cannot be deleted: the page says why, and Cancel is the way", async ({ page }) => {
    await createOrder(page, { name: `Older Order ${Date.now() % 1000000}` });
    const olderUrl = page.url();
    await createOrder(page, { name: `Newer Order ${Date.now() % 1000000}` });
    await page.goto(olderUrl);
    await expect(page.getByText(/is not the store's latest/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete order" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  });

  test("a price edited on an order line says it is for this order only", async ({ page }) => {
    await page.goto("/orders/new");
    await page.locator("button.chip", { hasText: "Garam masala" }).first().click();
    const price = page.getByLabel(/Price of Garam masala .* per pc/);
    await price.fill("410");
    await expect(page.getByText(/Price per pc · this order only/)).toBeVisible();
  });
});
