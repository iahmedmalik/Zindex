import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// error.tsx catches a page that breaks while it draws, so nobody sees a crash. An order without a total is not
// something the server sends, and drawing it throws, which makes it a safe way to break the Orders page on purpose.
test.describe("when a page breaks while it draws", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.route("**/backend/v1/stores/*/orders?*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ orders: [{ id: "broken", storeId: "x", orderNo: 1, customerName: "Broken", status: "pending", createdAt: "2026-10-31T10:00:00Z" }] }) }),
    );
  });

  test("@smoke it shows a calm screen with Try again and a way back to Today", async ({ page }) => {
    await page.goto("/orders");
    const panel = page.getByRole("alert").filter({ hasText: "Something went wrong" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/That.s on us, not you\./)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Go to Today" })).toBeVisible();
  });

  test("Try again works once the problem is gone", async ({ page }) => {
    await page.goto("/orders");
    const panel = page.getByRole("alert").filter({ hasText: "Something went wrong" });
    await expect(panel).toBeVisible();
    await page.unroute("**/backend/v1/stores/*/orders?*");
    await panel.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  });
});
