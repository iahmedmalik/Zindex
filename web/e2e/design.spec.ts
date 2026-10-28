import { expect, test } from "@playwright/test";
import { addRider, createOrder, signIn } from "./helpers";

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
    await addRider(page, { name: "Bilal", tracking: "https://indrive.example/trip/abc123" });
    await page.getByRole("button", { name: "Save rider" }).click();
    await expect(page.getByText("Bilal · Yango")).toBeVisible();
    await page.getByRole("button", { name: "Edit" }).click(); // the fields close after saving; Edit opens them again for the photo
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
    // The card is drawn on a server that may run in UTC (Vercel does); the time must still be Pakistan time.
    const caption = await card.locator("figure.photo figcaption").innerText();
    const shown = caption.match(/taken (\d{1,2}):(\d{2}) (am|pm)/i);
    expect(shown, `no time in "${caption}"`).not.toBeNull();
    const shownMinutes = ((Number(shown![1]) % 12) + (shown![3]!.toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(shown![2]);
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
    const nowMinutes = (Number(parts.find((p) => p.type === "hour")!.value) % 24) * 60 + Number(parts.find((p) => p.type === "minute")!.value);
    const apart = Math.min((shownMinutes - nowMinutes + 1440) % 1440, (nowMinutes - shownMinutes + 1440) % 1440);
    expect(apart, `the card said "${caption}" but it is ${nowMinutes} minutes into the day in Pakistan`).toBeLessThanOrEqual(3);
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
    await expect(page.getByLabel("Rider name")).toBeHidden(); // the order page stays simple until a rider is added
    await expect(page.getByRole("button", { name: "Add a rider" })).toBeVisible();
    await addRider(page, { name: "Imran" });
    await page.getByRole("button", { name: "Save rider" }).click();
    await expect(page.getByText("Imran · Yango")).toBeVisible();
    await expect(page.getByLabel("Rider name")).toBeHidden(); // closed again after saving
    await expect(page.getByRole("button", { name: /Mark (booked|picked up)/ })).toHaveCount(0);
    await expect(page.getByText(/^Ride:/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirm order", exact: true })).toBeVisible();
  });

  test("a courier order stays simple until a courier is added, and the courier has no status of its own", async ({ page }) => {
    await createOrder(page, { name: "Courier Simple", kind: "Courier" });
    await expect(page.getByLabel("Tracking number")).toBeHidden(); // closed until "Add a courier"
    await expect(page.getByRole("button", { name: "Add a courier" })).toBeVisible();
    await page.getByRole("button", { name: "Add a courier" }).click();
    await page.getByLabel("Courier", { exact: true }).fill("TCS");
    await page.getByLabel("Tracking number").fill(`TN${Date.now()}`); // desktop and phone runs share one database
    await page.getByRole("button", { name: "Save courier" }).click();
    await expect(page.getByLabel("Tracking number")).toBeHidden(); // closed again after saving
    await expect(page.getByText(/^Tracking TN\d+/)).toBeVisible(); // the short summary
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    // The order's main button is the only thing that moves it: no courier status buttons, no reason field.
    for (const name of [/^Shipped$/, /^Delayed$/, /^Failed$/, /^Returned$/, /Mark shipped/]) await expect(page.getByRole("button", { name })).toHaveCount(0);
    await expect(page.getByLabel(/Reason/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirm order", exact: true })).toBeVisible();
  });

  test("a tracking link that is not https is refused with a clear message", async ({ page }) => {
    await createOrder(page, { name: "Bad Link Buyer", rider: "300" });
    await addRider(page, { name: "Imran", tracking: "http://indrive.example/trip/1" });
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

test.describe("new store", () => {
  test("starts with maroon selected as its colour, not orange", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings");
    const form = page.locator("details", { hasText: "Add a store" });
    await form.getByText("Add a store", { exact: true }).click();
    await expect(form.getByRole("radio", { name: "#5d1b23", checked: true })).toBeVisible();
    await expect(form.getByRole("radio", { name: "#8a3b12", checked: true })).toHaveCount(0); // orange is still there to pick
    await expect(form.getByRole("radio", { name: "#8a3b12" })).toBeVisible();
  });
});
