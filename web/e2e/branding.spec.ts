import { expect, test, type Page } from "@playwright/test";
import { createOrder, signIn } from "./helpers";

// A store's logo and watermark: added in Settings, shown on the receipt, the invoice and the customer's card, with the
// watermark switch hiding the watermark. The pictures are removed at the end so other tests see the store as it was.

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAZUlEQVR4nO3PMQ0AIADAMHxwogv/MkAER0OyY3839lzn54YGNKABDWhAAxrQgAY0oAENaEADGtCABjSgAQ1oQAMa0IAGNKABDWhAAxrQgAY0oAENaEADGtCABjSgAQ1oQAMa8NoFrZxq00AUJEYAAAAASUVORK5CYII=", "base64");
const file = { name: "logo.png", mimeType: "image/png", buffer: png };

async function openEditor(page: Page) {
  await page.goto("/settings");
  const row = page.locator("li", { hasText: "Sheen Food" }).first();
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  return row;
}

test.describe("store logo and watermark", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("show on the receipt, the invoice and the customer's card, and the switch hides the watermark", async ({ page, browser }) => {
    let row = await openEditor(page);
    try {
      await row.getByLabel(/(Add|Replace) logo/).setInputFiles(file);
      await expect(page.getByText("Logo saved")).toBeVisible();
      row = await openEditor(page);
      await row.getByLabel(/(Add|Replace) watermark/).setInputFiles(file);
      await expect(page.getByText("Watermark saved")).toBeVisible();

      await createOrder(page, { name: `Brand Buyer ${Date.now() % 1000000}`, rider: "300" });
      await expect(page.locator(".slip .slip-logo")).toBeVisible();
      await page.getByRole("button", { name: "Confirm order", exact: true }).click();
      await expect(page.locator("code").first()).toBeVisible();
      const path = new URL(`http://${await page.locator("code").first().innerText()}`).pathname;

      await page.getByRole("link", { name: /View, print or share the invoice/ }).click();
      await expect(page.locator("article.ivp .iv-mark.logo img")).toBeVisible();
      await expect(page.locator("article.ivp img.iv-wmimg")).toBeAttached();
      const invoiceUrl = page.url();

      const customer = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
      const card = await customer.newPage();
      await card.goto(path);
      await expect(card.locator("img.card-logo")).toBeVisible();
      await expect.poll(() => card.locator("img.card-logo").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
      await customer.close();

      // the switch: the picture stays saved, the invoice drops it
      row = await openEditor(page);
      await row.getByLabel("Show the watermark on invoices").click();
      await expect(page.getByText("Watermark off")).toBeVisible();
      await page.goto(invoiceUrl);
      await expect(page.locator("article.ivp .iv-mark.logo img")).toBeVisible();
      await expect(page.locator("article.ivp img.iv-wmimg")).toHaveCount(0);
    } catch (e) { console.log("BODY FAIL", String(e).slice(0, 700)); throw e;
    } finally {
      for (let i = 0; i < 3; i++) {
        row = await openEditor(page);
        const sw = row.getByLabel("Show the watermark on invoices");
        if (await sw.isVisible().catch(() => false) && !(await sw.isChecked())) await sw.click();
        const remove = row.getByRole("button", { name: "Remove" }).first();
        if (!(await remove.isVisible().catch(() => false))) break;
        await remove.click();
        await expect(page.getByText(/(Logo|Watermark) removed/)).toBeVisible();
      }
    }
  });
});
