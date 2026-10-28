import { expect, test, type Page } from "@playwright/test";
import { createOrder, signIn } from "./helpers";

// The payment ledger: a pay-later order is paid in chunks, shows in Cash to collect once delivered, and the customer's
// card says it is paid to the shop later (not "already paid"). Names are unique: the desktop and phone runs share a database.

async function deliver(page: Page) {
  for (const step of ["Confirm order", "Mark packed", "Out for delivery", "Mark delivered"]) {
    await page.getByRole("button", { name: step, exact: true }).click();
    await expect(page.getByText(/#\d+ is /).first()).toBeVisible();
  }
}

test.describe("payments", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("a pay-later order is paid in chunks, is found in Cash to collect once delivered, and settles", async ({ page }) => {
    const name = `Later Payer ${Date.now() % 1000000}`;
    await createOrder(page, { name, pay: "Later" });
    await page.goto("/orders?view=cash");
    await expect(page.locator("a.row", { hasText: name })).toHaveCount(0); // not in Cash to collect before it is delivered
    await page.goBack();
    await deliver(page);
    const orderUrl = page.url();

    // a part payment from the Payments box
    await page.getByRole("button", { name: "Add payment" }).click();
    await page.getByRole("button", { name: /^Half PKR/ }).click();
    await page.getByRole("button", { name: "Easypaisa", exact: true }).click();
    await page.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByText("PKR 500 recorded")).toBeVisible();
    await expect(page.getByText("Still to collect")).toBeVisible();
    await expect(page.locator("#payments").getByText("PKR 500").first()).toBeVisible();

    // Today's Cash to collect box counts it under "From customers"
    await page.goto("/");
    await expect(page.getByRole("list", { name: "Who owes it" })).toContainText("From customers");

    // it is in Cash to collect, with what is left and how long ago it was delivered
    await page.goto("/orders?view=cash");
    const row = page.locator("a.row", { hasText: name });
    await expect(row).toContainText("PKR 500");
    await expect(row).toContainText("delivered today");
    await expect(row.getByRole("button", { name: "Remind" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Add payment" })).toBeVisible();

    // the rest in one tap
    await row.getByRole("button", { name: "Got the payment" }).click();
    await expect(page.getByText(/payment received/)).toBeVisible();
    await expect(page.locator("a.row", { hasText: name })).toHaveCount(0);
    await page.goto(orderUrl);
    await expect(page.getByText("Paid in full")).toBeVisible();
  });

  test("the customer's card says a pay-later order is paid to the shop later, never 'already paid'", async ({ page, browser }) => {
    await createOrder(page, { name: `Card Later ${Date.now() % 1000000}`, pay: "Later" });
    await page.getByRole("button", { name: "Confirm order", exact: true }).click();
    await expect(page.locator("code").first()).toBeVisible();
    const path = new URL(`http://${await page.locator("code").first().innerText()}`).pathname;
    const customer = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const card = await customer.newPage();
    await card.goto(path);
    const slip = card.getByRole("region", { name: "What to pay" });
    await expect(slip).toContainText(/is paid to .* later/);
    await expect(slip).toContainText("Still to pay");
    await expect(slip).not.toContainText("Already paid");
    await expect(slip).not.toContainText("Your order is paid");
    await customer.close();
  });

  test("COD cash comes back in chunks: a part, then the rest in one tap", async ({ page }) => {
    await createOrder(page, { name: `Chunked Cash ${Date.now() % 1000000}`, rider: "300" });
    await expect(page.getByRole("button", { name: "Add cash received" })).toHaveCount(0); // not before the order is out
    await deliver(page);
    await page.getByRole("button", { name: "Add cash received" }).click();
    await page.getByRole("button", { name: /^Half PKR/ }).click();
    await page.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByText("PKR 500 recorded")).toBeVisible();
    await page.getByRole("button", { name: "Rider handed over the cash" }).click();
    await expect(page.getByText("Cash received", { exact: true })).toBeVisible();
  });
});
