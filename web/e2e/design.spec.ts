import { expect, test } from "@playwright/test";
import { createOrder, signIn } from "./helpers";

// The approved redesign: the store switcher lives on Today only, the whole app follows the pick,
// and the rider photo, tracking link and store contact details reach the customer's card.

test.describe("the store switcher", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("@smoke is a dropdown on Today only; other pages show the picked store as plain text, and the pick sticks", async ({ page }) => {
    await page.getByRole("button", { name: /All stores|Sheen/ }).click();
    await page.getByRole("menuitemradio", { name: "Sheen Perfumes" }).click();
    await expect(page.getByRole("button", { name: /Sheen Perfumes/ })).toBeVisible();

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Orders" }).click();
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    // no dropdown here, but the store name is still shown
    await expect(page.getByRole("button", { name: /Sheen Perfumes/ })).toHaveCount(0);
    await expect(page.locator(".store-pill.static")).toContainText("Sheen Perfumes");
    // and the list only holds that store's orders
    await expect(page.locator("a.row", { hasText: "Sheen Food" })).toHaveCount(0);

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
    await page.getByRole("button", { name: /Sheen Perfumes/ }).click();
    await page.getByRole("menuitemradio", { name: "All stores" }).click();
    await expect(page.getByRole("button", { name: /All stores/ })).toBeVisible();
  });
});

test.describe("receipt and delivery card", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("the receipt carries the store's email, set in the store's details", async ({ page }) => {
    await page.goto("/settings");
    const email = `hello-${Date.now()}@sheenfood.pk`;
    const food = page.locator("ul.rows > li").filter({ hasText: "Sheen Food" }).first();
    await food.getByRole("button", { name: "Edit" }).click();
    await food.getByLabel("Store email").fill(email);
    await food.getByRole("button", { name: "Save store" }).click();
    await expect(page.getByText("Store saved")).toBeVisible();
    await createOrder(page, { name: "Contact Buyer" });
    await expect(page.getByRole("group", { name: /Receipt for order/ })).toContainText(email);
  });

  test("@smoke a rider photo and a tracking link show on the customer's card, with a Track button; removing the photo takes it off", async ({ page, browser }) => {
    await createOrder(page, { name: "Photo Buyer", rider: "300" });
    await page.getByLabel("Rider name").fill("Bilal");
    await page.getByLabel("Tracking link").fill("https://indrive.example/trip/abc123");
    await page.getByRole("button", { name: "Save rider" }).click();
    await expect(page.getByText("Bilal · Yango")).toBeVisible();
    // a real picture, drawn in the page, handed to the file input as a camera or gallery pick would
    const b64 = await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = 800; c.height = 600;
      const g = c.getContext("2d")!; g.fillStyle = "#7d2a35"; g.fillRect(0, 0, 800, 600); g.fillStyle = "#fff"; g.fillRect(300, 150, 200, 300);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page.locator('input[type="file"]').setInputFiles({ name: "rider.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
    await expect(page.getByText("Rider photo saved")).toBeVisible();
    await page.getByRole("button", { name: "Confirm order", exact: true }).click(); // the card link is made by itself on confirm
    await expect(page.locator("code").first()).toBeVisible();
    const path = new URL(`http://${await page.locator("code").first().innerText()}`).pathname;

    const customer = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const card = await customer.newPage();
    await card.goto(path);
    const photo = card.locator("figure.photo img");
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const track = card.getByRole("link", { name: /Track delivery/ });
    await expect(track).toHaveAttribute("href", "https://indrive.example/trip/abc123");
    await expect(track).toHaveAttribute("rel", /noopener/);
    await customer.close();

    // removing the photo takes it off the card again; the Track button stays
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Rider photo removed")).toBeVisible();
    const other = await browser.newContext();
    const again = await other.newPage();
    await again.goto(path);
    await expect(again.locator("figure.photo")).toHaveCount(0);
    await expect(again.getByRole("link", { name: /Track delivery/ })).toBeVisible();
    await other.close();
  });

  test("@smoke the customer's card follows the main button alone, with no rider saved, and there is no second status button", async ({ page, browser }) => {
    await createOrder(page, { name: "Card Follower", rider: "300" });
    await expect(page.getByText(/made as soon as you confirm/)).toBeVisible(); // nothing to copy until the order is confirmed
    await page.getByRole("button", { name: "Confirm order", exact: true }).click();
    await expect(page.locator("code").first()).toBeVisible(); // made by itself, no button to press
    const path = new URL(`http://${await page.locator("code").first().innerText()}`).pathname;
    const customer = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const card = await customer.newPage();
    await card.goto(path);
    await expect(card.getByRole("heading", { level: 1 })).toHaveText("Your order is confirmed");

    for (const [button, said, headline] of [["Mark packed", "packed", "Your order is packed"], ["Out for delivery", "out for delivery", "On its way to you"], ["Mark delivered", "delivered", "Delivered. Enjoy!"]] as const) {
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(page.getByText(new RegExp(String.raw`#\d+ is ` + said))).toBeVisible(); // this step's own message, not the last one's
      await card.reload();
      await expect(card.getByRole("heading", { level: 1 })).toHaveText(headline);
    }
    await customer.close();
  });

  test("saving a rider does not add a second status: only the main button moves the order", async ({ page }) => {
    await createOrder(page, { name: "One Button", rider: "300" });
    await page.getByLabel("Rider name").fill("Imran");
    await page.getByRole("button", { name: "Save rider" }).click();
    await expect(page.getByText("Imran · Yango")).toBeVisible();
    await expect(page.getByRole("button", { name: /Mark (booked|picked up)/ })).toHaveCount(0);
    await expect(page.getByText(/^Ride:/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirm order", exact: true })).toBeVisible();
  });

  test("a tracking link that is not https is refused with a clear message", async ({ page }) => {
    await createOrder(page, { name: "Bad Link Buyer", rider: "300" });
    await page.getByLabel("Rider name").fill("Imran");
    await page.getByLabel("Tracking link").fill("http://indrive.example/trip/1");
    await page.getByRole("button", { name: "Save rider" }).click();
    await expect(page.getByText(/https/).first()).toBeVisible();
  });
});

test.describe("looks", () => {
  test("the sign-in page shows the wordmark, and Today has a heading and the moving hero", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Zindex" })).toBeVisible();
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeAttached();
    await expect(page.getByRole("region", { name: "Sales today" })).toBeVisible();
  });

  test("with reduced motion no animation loops on Today", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await signIn(page);
    await page.waitForTimeout(800);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getTiming().iterations === Infinity).length);
    expect(running).toBe(0);
    await ctx.close();
  });
});
