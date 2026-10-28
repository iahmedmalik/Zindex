import { expect, test } from "@playwright/test";
import { DEMO, createOrder, freshPhone, signIn } from "./helpers";

test.describe("sign-in", () => {
  test("@smoke refuses a wrong password and lets the owner in with the right one", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(DEMO.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await signIn(page);
    await expect(page.getByRole("button", { name: /All stores|Sheen/ })).toBeVisible();
  });

  test("sends a signed-out visitor to sign-in", async ({ page }) => {
    await page.goto("/orders");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("an order from WhatsApp to the door", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("@smoke the form shows what is paid at the door, and the server confirms the same numbers", async ({ page }) => {
    await page.goto("/orders/new");
    await page.getByLabel("WhatsApp number").fill(freshPhone());
    await page.getByLabel("Name", { exact: true }).fill("Test Buyer");
    await page.getByRole("button", { name: "Typed item" }).click();
    await page.getByLabel("Item name").fill("Gift box");
    await page.getByLabel(/Price of/).fill("1000");
    await page.getByRole("button", { name: /One more/ }).click(); // 2 x 1,000
    await page.getByLabel(/Rider fee/).fill("350");
    await page.getByRole("button", { name: "10%", exact: true }).click();
    // 2,000 - 10% = 1,800 for the store; the customer hands the rider 1,800 + 350.
    await expect(page.getByText("At the door 2,150 · store 1,800 + rider 350")).toBeVisible();
    await page.getByRole("button", { name: "Create order" }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    await expect(page.getByText("PKR 1,800").first()).toBeVisible();
    await expect(page.getByText(/hands the rider/)).toContainText("PKR 2,150");
    await expect(page.getByText(/brings 1,800 back to you/)).toBeVisible();
  });

  test("the order moves along the journey line, and Today counts it", async ({ page }) => {
    await createOrder(page, { name: "Journey Buyer", rider: "300" });
    const line = page.getByRole("list", { name: "Order progress" });
    await expect(line.locator("li.now")).toContainText("Ordered");
    await page.getByRole("button", { name: "Confirm order" }).click();
    await expect(line.locator("li.now")).toContainText("Confirmed");
    await page.getByRole("button", { name: "Mark packed" }).click();
    await expect(line.locator("li.now")).toContainText("Packed");
    await page.goto("/");
    await expect(page.getByText("Journey Buyer").first()).toBeVisible();
    await expect(page.getByText("packed, no rider yet").first()).toBeVisible();
  });

  test("an invoice is a draft until finalised, then has the store's next number; A4 and compact both work", async ({ page }) => {
    await createOrder(page, { name: "Invoice Buyer" });
    await page.getByRole("button", { name: "Make invoice" }).click();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Finalise" }).click();
    await expect(page.getByText(/^SF-\d{4}$/)).toBeVisible();
    await page.getByRole("link", { name: /View, print or share the invoice/ }).click();
    const doc = page.locator("article.ivp");
    await expect(doc).toBeVisible();
    await expect(doc).toHaveClass(/compact/);
    await page.getByRole("radio", { name: "A4" }).check({ force: true });
    await expect(doc).toHaveClass(/a4/);
  });

  test("@smoke the customer's delivery card needs no sign-in, shows the rider and what to pay, and a bad link says so", async ({ page, browser }) => {
    await createOrder(page, { name: "Card Buyer", rider: "350" });
    await page.getByLabel("Rider name").fill("Imran");
    await page.getByLabel("Bike number").fill("LEA-1234");
    await page.getByLabel("Rider phone").fill("0345 5551212");
    await page.getByRole("button", { name: "Save rider" }).click();
    await expect(page.getByText("Imran · Yango")).toBeVisible();
    await page.getByRole("button", { name: "Make delivery card link" }).click();
    const link = await page.locator("code").first().innerText();
    const path = new URL(`http://${link}`).pathname;

    const customer = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const card = await customer.newPage();
    await card.goto(path);
    await expect(card.getByRole("heading", { name: "Please have ready" })).toBeVisible();
    await expect(card.getByText("Imran").first()).toBeVisible();
    await expect(card.getByText("LEA-1234")).toBeVisible();
    await expect(card.getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:03455551212");
    await expect(card.getByRole("link", { name: /Track delivery/ })).toHaveCount(0);
    await expect(card.locator("figure.photo")).toHaveCount(0);
    await card.goto("/c/not-a-real-link-0000000000000000");
    await expect(card.getByRole("heading", { name: "This link is not available" })).toBeVisible();
    await customer.close();
  });

  test("a cash-on-delivery order is settled when the rider hands over the cash", async ({ page }) => {
    await createOrder(page, { name: "Cash Buyer", rider: "300" });
    await page.getByLabel("Rider name").fill("Imran");
    await page.getByRole("button", { name: "Save rider" }).click();
    await expect(page.getByText("Imran · Yango")).toBeVisible();
    await page.getByRole("button", { name: "Rider handed over the cash" }).click();
    await expect(page.getByText("Cash handed over")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Rider handed over the cash" })).toBeVisible();
  });
});

test.describe("layout, motion and looks", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("@smoke no screen is wider than the phone, and the main tabs are reachable", async ({ page }) => {
    for (const path of ["/", "/orders", "/orders/new", "/products", "/more", "/reports", "/shipments", "/customers", "/settings"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      expect(scroll, `${path} is wider than the screen`).toBeLessThanOrEqual(inner + 1);
    }
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "New order" })).toBeVisible();
  });

  test("dark mode and reduced motion are remembered", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("radio", { name: "Dark", exact: true }).check({ force: true });
    await page.getByRole("radio", { name: "Less", exact: true }).check({ force: true });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await page.getByRole("radio", { name: "Phone setting" }).first().check({ force: true });
    await page.getByRole("radio", { name: "Phone setting" }).last().check({ force: true });
  });

  test("with reduced motion a page still shows its content at once (no travel)", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await signIn(page);
    const travel = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--travel").trim());
    expect(travel).toBe("0px");
    await ctx.close();
  });

  test("a counted stock adjustment shows on the stock screen at once", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /All stores|Sheen/ }).click();
    await page.getByRole("menuitemradio", { name: "Sheen Food" }).click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Stock" }).click();
    await expect(page.getByRole("heading", { name: "Stock" })).toBeVisible();
    const row = page.getByRole("button", { name: /Turmeric/ });
    await expect(row).toBeVisible();
    const before = Number((await row.locator("b").innerText()).replace(/,/g, ""));
    await row.click();
    await page.getByRole("button", { name: "+10", exact: true }).click();
    await expect(row.locator("b")).toHaveText(String(before + 10));
  });
});
