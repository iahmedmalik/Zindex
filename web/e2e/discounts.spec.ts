import { expect, test } from "@playwright/test";
import { freshPhone, signIn } from "./helpers";

// A discount on one item: a card over a blurred page, a percent or rupees, shown on the order, the receipt and the invoice.

test.describe("a discount on one item", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  async function startOrder(page: import("@playwright/test").Page, buyer: string) {
    await page.goto("/orders/new");
    await page.getByRole("radio", { name: "Sheen Food" }).check({ force: true }).catch(() => undefined);
    await page.getByLabel("WhatsApp number").fill(freshPhone());
    await page.getByLabel("Name", { exact: true }).fill(buyer);
    await page.getByRole("button", { name: "Typed item" }).click();
    await page.getByLabel("Item name").fill("Rose Oud");
    await page.getByLabel(/Price of/).fill("1000");
  }

  test("a percent discount: the card shows what the item becomes, and the order, receipt and invoice follow", async ({ page }) => {
    await startOrder(page, `Percent Buyer ${Date.now() % 1000000}`);
    await page.getByRole("button", { name: "Add discount" }).click();
    const card = page.getByRole("dialog", { name: /Discount on Rose Oud/ });
    await expect(card).toBeVisible();
    await page.waitForTimeout(600); // let it finish rising
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1); // the card fits the screen (it once ran off the right edge on a phone)
    const apply = (await card.getByRole("button", { name: "Apply discount" }).boundingBox())!;
    expect(apply.x + apply.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await card.getByLabel("Discount percent").fill("10");
    await expect(card.locator(".dc-pre")).toContainText("900");
    await card.getByRole("button", { name: "Apply discount" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /10% off · − 100/ })).toBeVisible();
    await expect(page.locator(".dock")).toContainText("PKR 900");

    await page.getByRole("button", { name: "Create order" }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    const slip = page.getByRole("group", { name: /Receipt for order/ });
    await expect(slip).toContainText("10% off");
    await expect(slip).toContainText("900");

    await page.getByRole("link", { name: /View, print or share the invoice/ }).click();
    await expect(page.getByText(/each · 10% off/)).toBeVisible();
  });

  test("rupees off the whole line, changed later and then removed; a number larger than the line is held at the line", async ({ page }) => {
    await startOrder(page, `Rupee Buyer ${Date.now() % 1000000}`);
    await page.getByRole("button", { name: "One more Rose Oud" }).click(); // 2 x 1,000
    await page.getByRole("button", { name: "Add discount" }).click();
    const card = page.getByRole("dialog", { name: /Discount on Rose Oud/ });
    await card.getByRole("radio", { name: "Rupees Rs" }).check({ force: true });
    await card.getByLabel("Discount in rupees").fill("99999");
    await expect(card.getByLabel("Discount in rupees")).toHaveValue("2000"); // never more than the line
    await card.getByLabel("Discount in rupees").fill("300");
    await expect(card.locator(".dc-pre")).toContainText("1,700");
    await card.getByRole("button", { name: "Apply discount" }).click();
    await expect(page.getByRole("button", { name: /Rs 300 off · − 300/ })).toBeVisible();
    await expect(page.locator(".dock")).toContainText("PKR 1,700");

    await page.getByRole("button", { name: /Rs 300 off/ }).click(); // open it again
    await page.getByRole("dialog", { name: /Discount on Rose Oud/ }).getByRole("button", { name: "Remove discount" }).click();
    await expect(page.getByRole("button", { name: "Add discount" })).toBeVisible();
    await expect(page.locator(".dock")).toContainText("PKR 2,000");
  });
});
