import { expect, test } from "@playwright/test";
import { createOrder, signIn } from "./helpers";

test.beforeEach(async ({ page }) => { await signIn(page); });

test.describe("the courier delivery card", () => {
  test("@smoke shows the courier, tracking number, parcel photo and a Track button, and removing the photo takes it off", async ({ page, browser }) => {
    await createOrder(page, { name: "Courier Card Buyer", kind: "Courier" });
    await page.getByRole("button", { name: "Add a courier" }).click();
    await expect(page.getByText("Save the courier first, then add a photo.")).toBeVisible(); // the photo needs a saved courier
    await page.getByLabel("Courier", { exact: true }).fill("TCS");
    const no = `TN${Date.now()}`; // desktop and phone runs share one database
    await page.getByLabel("Tracking number").fill(no);
    await page.getByLabel("Tracking link").fill("https://www.tcsexpress.com/track/123");
    await page.getByRole("button", { name: "Save courier" }).click();
    await expect(page.getByText(`Tracking ${no}`)).toBeVisible();
    await page.getByRole("button", { name: "Edit" }).click();
    // a real picture, drawn in the page, handed to the file input as a camera or gallery pick would
    const b64 = await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = 800; c.height = 600;
      const g = c.getContext("2d")!; g.fillStyle = "#c9a77a"; g.fillRect(0, 0, 800, 600); g.fillStyle = "#e8d3a8"; g.fillRect(380, 0, 40, 600);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page.locator('input[type="file"]').setInputFiles({ name: "parcel.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
    await expect(page.getByText("Parcel photo saved")).toBeVisible();
    await page.getByRole("button", { name: "Confirm order", exact: true }).click(); // the card link is made by itself on confirm
    await expect(page.locator("code").first()).toBeVisible();
    const path = new URL(`http://${await page.locator("code").first().innerText()}`).pathname;

    const customer = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const card = await customer.newPage();
    await card.goto(path);
    await expect(card.getByRole("region", { name: "Your courier" })).toContainText("TCS");
    await expect(card.getByRole("region", { name: "Your courier" })).toContainText(no);
    const photo = card.locator("figure.photo img");
    await expect(photo).toBeVisible();
    await expect(card.locator("figure.photo figcaption")).toContainText("Photo of your parcel");
    await expect.poll(() => photo.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const track = card.getByRole("link", { name: /Track delivery/ });
    await expect(track).toHaveAttribute("href", "https://www.tcsexpress.com/track/123");
    await expect(track).toHaveAttribute("rel", /noopener/);
    await expect(card.getByText("Opens your courier's tracking page")).toBeVisible();
    await expect(card.getByRole("link", { name: "Call" })).toHaveCount(0); // a courier has no phone on the card
    await customer.close();

    // removing the photo takes it off the card again; the courier and the Track button stay
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Parcel photo removed")).toBeVisible();
    const other = await browser.newContext();
    const again = await other.newPage();
    await again.goto(path);
    await expect(again.locator("figure.photo")).toHaveCount(0);
    await expect(again.getByRole("link", { name: /Track delivery/ })).toBeVisible();
    await other.close();
  });

  test("a courier with only a name shows just that, with no photo and no Track button", async ({ page, browser }) => {
    await createOrder(page, { name: "Courier Name Only", kind: "Courier" });
    await page.getByRole("button", { name: "Add a courier" }).click();
    await page.getByLabel("Courier", { exact: true }).fill("Leopards");
    await page.getByRole("button", { name: "Save courier" }).click();
    await expect(page.getByText("No tracking number yet")).toBeVisible();
    await page.getByRole("button", { name: "Confirm order", exact: true }).click();
    await expect(page.locator("code").first()).toBeVisible();
    const path = new URL(`http://${await page.locator("code").first().innerText()}`).pathname;
    const customer = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const card = await customer.newPage();
    await card.goto(path);
    await expect(card.getByRole("region", { name: "Your courier" })).toContainText("Leopards");
    await expect(card.locator("figure.photo")).toHaveCount(0);
    await expect(card.getByRole("link", { name: /Track delivery/ })).toHaveCount(0);
    await customer.close();
  });
});
