import { expect, type Page } from "@playwright/test";

export const DEMO = { email: "demo@zindex.test", password: "zindex-demo-1234" };

export async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Needs you now")).toBeVisible();
  await skipTour(page);
}

/** A first sign-in opens the walk-through; every test that is not about it closes it (and so marks it as seen). */
export async function skipTour(page: Page) {
  const skip = page.getByRole("button", { name: "Skip tour" });
  if (await skip.waitFor({ state: "visible", timeout: 6000 }).then(() => true, () => false)) {
    await skip.click();
    await expect(skip).toBeHidden();
  }
}

/** A phone number nobody has used, so the customer lookup does not offer an older customer. */
export const freshPhone = () => `03${Math.floor(10 + Math.random() * 89)}${String(Date.now()).slice(-7)}`;

/** Makes an order through the form and lands on its page. Typed item: 1,000 each, no catalogue needed. */
export async function createOrder(page: Page, o: { name: string; phone?: string; qty?: number; discount?: number; rider?: string; pay?: "COD" | "Paid" | "Later"; kind?: "Courier" | "Pickup" } ) {
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: "Sheen Food" }).check({ force: true }).catch(() => undefined);
  await page.getByLabel("WhatsApp number").fill(o.phone ?? freshPhone());
  await page.getByLabel("Name", { exact: true }).fill(o.name);
  await page.getByRole("button", { name: "Typed item" }).click();
  await page.getByLabel("Item name").fill("Gift box");
  await page.getByLabel(/Price of/).fill("1000");
  for (let i = 1; i < (o.qty ?? 1); i++) await page.getByRole("button", { name: /One more/ }).click();
  if (o.kind) await page.getByRole("radio", { name: o.kind, exact: true }).check({ force: true });
  if (o.rider) await page.getByLabel(/Rider fee/).fill(o.rider);
  if (o.discount) await page.getByRole("button", { name: `${o.discount}%`, exact: true }).click();
  if (o.pay && o.pay !== "COD") await page.getByRole("radio", { name: o.pay, exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Create order" }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Receipt/ })).toBeVisible();
}

/** Opens the rider fields ("Add a rider") and fills them; the caller presses Save rider. */
export async function addRider(page: Page, r: { name: string; bike?: string; phone?: string; tracking?: string }) {
  await page.getByRole("button", { name: "Add a rider" }).click();
  await page.getByLabel("Rider name").fill(r.name);
  if (r.bike) await page.getByLabel("Bike number").fill(r.bike);
  if (r.phone) await page.getByLabel("Rider phone").fill(r.phone);
  if (r.tracking) await page.getByLabel("Tracking link").fill(r.tracking);
}

/** Opens the Stock screen on Sheen Food, waiting for the page to say whether a store still has to be picked. */
export async function openStock(page: Page) {
  await page.goto("/products");
  const pick = page.getByText("Pick a store");
  if (await pick.waitFor({ state: "visible", timeout: 6000 }).then(() => true, () => false)) await page.getByRole("button", { name: /Sheen Food/ }).first().click();
  await expect(page.getByRole("button", { name: "Product", exact: true })).toBeVisible();
}
