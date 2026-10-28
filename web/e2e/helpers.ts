import { expect, type Page } from "@playwright/test";

export const DEMO = { email: "demo@zindex.test", password: "zindex-demo-1234" };

export async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Needs you now")).toBeVisible();
}

/** A phone number nobody has used, so the customer lookup does not offer an older customer. */
export const freshPhone = () => `03${Math.floor(10 + Math.random() * 89)}${String(Date.now()).slice(-7)}`;

/** Makes an order through the form and lands on its page. Typed item: 1,000 each, no catalogue needed. */
export async function createOrder(page: Page, o: { name: string; phone?: string; qty?: number; discount?: number; rider?: string; pay?: "COD" | "Paid" | "Later" } ) {
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: "Sheen Food" }).check({ force: true }).catch(() => undefined);
  await page.getByLabel("WhatsApp number").fill(o.phone ?? freshPhone());
  await page.getByLabel("Name", { exact: true }).fill(o.name);
  await page.getByRole("button", { name: "Typed item" }).click();
  await page.getByLabel("Item name").fill("Gift box");
  await page.getByLabel(/Price of/).fill("1000");
  for (let i = 1; i < (o.qty ?? 1); i++) await page.getByRole("button", { name: /One more/ }).click();
  if (o.rider) await page.getByLabel(/Rider fee/).fill(o.rider);
  if (o.discount) await page.getByRole("button", { name: `${o.discount}%`, exact: true }).click();
  if (o.pay && o.pay !== "COD") await page.getByRole("radio", { name: o.pay, exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Create order" }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Receipt/ })).toBeVisible();
}
