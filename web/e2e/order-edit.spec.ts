import { expect, test } from "@playwright/test";
import { createOrder, signIn } from "./helpers";

// An order can be edited at any stage except cancelled or returned, with the same form as a new order.
// Names are unique because the desktop and phone runs share one database.

test.describe("editing an order", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("the Edit button opens the order's own details; saving changes the bill and keeps the status", async ({ page }) => {
    const stamp = String(Date.now() % 1000000);
    await createOrder(page, { name: `Edit Me ${stamp}` });
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Edit order #\d+/ })).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`Edit Me ${stamp}`);

    await page.getByLabel("Name", { exact: true }).fill(`Edited ${stamp}`);
    await page.getByRole("button", { name: /One more Gift box/ }).click(); // 2 x 1,000
    await page.getByRole("button", { name: "Add discount" }).click();
    await page.getByRole("dialog").getByLabel("Discount percent").fill("10");
    await page.getByRole("button", { name: "Apply discount" }).click();
    await expect(page.locator(".dock")).toContainText("PKR 1,800");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("heading", { name: new RegExp(`Edited ${stamp}`) })).toBeVisible();
    const slip = page.getByRole("group", { name: /Receipt for order/ });
    await expect(slip).toContainText("10% off");
    await expect(slip).toContainText("1,800");
    await expect(slip).toContainText("Pending"); // the status did not change
  });

  test("a delivered order can still be edited", async ({ page }) => {
    await createOrder(page, { name: `Delivered Edit ${Date.now() % 1000000}` });
    for (const step of ["Confirm order", "Mark packed", "Out for delivery", "Mark delivered"]) {
      await page.getByRole("button", { name: step, exact: true }).click();
      await expect(page.getByText(/is (confirmed|packed|out for delivery|delivered)/).first()).toBeVisible();
    }
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await page.getByLabel(/Note for packing/).fill("Corrected after delivery");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: /Receipt for order/ })).toContainText("Delivered");
  });

  test("a cancelled order has no Edit button, and its edit page says why", async ({ page }) => {
    await createOrder(page, { name: `Cancelled Edit ${Date.now() % 1000000}` });
    const editUrl = `${page.url()}/edit`;
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel the order" }).click();
    await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await page.goto(editUrl);
    await expect(page.getByText(/cannot be edited/)).toBeVisible();
  });
});
