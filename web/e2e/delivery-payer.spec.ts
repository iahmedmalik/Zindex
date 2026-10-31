import { expect, test } from "@playwright/test";
import { createOrder, freshPhone, signIn } from "./helpers";

test.beforeEach(async ({ page }) => { await signIn(page); });

// Who pays for delivery: the customer or "We pay". Goods in createOrder are PKR 1,000.
test.describe("who pays for delivery", () => {
  test("@smoke a rider paid by the store: the customer owes the goods only and the card shows no rider fee", async ({ page, browser }) => {
    await createOrder(page, { name: "Store Pays Rider", rider: "300", paidBy: "store" });
    await expect(page.getByText("Delivery costs you PKR 300: you pay the rider. The customer does not see this.")).toBeVisible();
    await expect(page.getByRole("group", { name: /Receipt for order/ })).toContainText("1,000");
    await expect(page.getByRole("group", { name: /Receipt for order/ })).not.toContainText("Rider fee");
    await expect(page.getByText(/hands the rider/)).toContainText("PKR 1,000"); // not 1,300
    await page.getByRole("button", { name: "Confirm order", exact: true }).click();
    await expect(page.locator("code").first()).toBeVisible();
    const path = new URL(`http://${await page.locator("code").first().innerText()}`).pathname;

    const customer = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const card = await customer.newPage();
    await card.goto(path);
    await expect(card.locator(".due")).toHaveText("PKR 1,000");
    await expect(card.getByText(/for the rider/)).toHaveCount(0);
    await expect(card.getByText("Rider fee, to the rider")).toHaveCount(0);
    await customer.close();

    await page.goto("/reports"); // the store's own delivery cost is on the reports and comes off profit
    await expect(page.getByText("Delivery paid by the store", { exact: true })).toBeVisible();
    await expect(page.getByText("Delivery you paid", { exact: true })).toBeVisible();
  });

  test("@smoke a courier paid by the store leaves the total at the goods; paid by the customer it is added", async ({ page }) => {
    await page.goto("/orders/new");
    await page.getByLabel("WhatsApp number").fill(freshPhone());
    await page.getByLabel("Name", { exact: true }).fill("Courier Payer");
    await page.getByRole("button", { name: "Typed item" }).click();
    await page.getByLabel("Item name").fill("Gift box");
    await page.getByLabel(/Price of/).fill("1000");
    await page.locator(".seg label", { hasText: /^Courier$/ }).click();
    await page.getByLabel(/Delivery fee/).fill("250");
    await page.locator(".seg label", { hasText: /^We pay$/ }).click();
    await expect(page.getByLabel(/Delivery cost/)).toBeVisible();
    await expect(page.getByText("Customer pays PKR 1,000 for the goods. Delivery costs you PKR 250.")).toBeVisible();
    await page.getByRole("button", { name: "Create order" }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("group", { name: /Receipt for order/ })).toContainText("1,000");
    await expect(page.getByRole("group", { name: /Receipt for order/ })).not.toContainText("Delivery fee");
    await expect(page.getByText("Delivery costs you PKR 250: you pay the courier. The customer does not see this.")).toBeVisible();
  });

  test("the choice can be changed when editing the order, and the pickup form has no such choice", async ({ page }) => {
    await createOrder(page, { name: "Edit Payer", rider: "300" });
    await expect(page.getByText(/hands the rider/)).toContainText("PKR 1,300");
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await expect(page.locator(".dock")).toContainText("rider 300"); // the customer pays the rider at the door
    await page.locator(".seg label", { hasText: /^We pay$/ }).click();
    await expect(page.locator(".dock")).not.toContainText("rider 300");
    await expect(page.locator(".dock")).toContainText("Collect 1,000 for the store");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/hands the rider/)).toContainText("PKR 1,000");
    await page.goto("/orders/new");
    await page.locator(".seg label", { hasText: /^Pickup$/ }).click();
    await expect(page.getByRole("radiogroup", { name: "Who pays for delivery" })).toBeHidden();
  });
});
