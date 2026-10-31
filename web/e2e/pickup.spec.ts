import { expect, test } from "@playwright/test";
import { createOrder, signIn } from "./helpers";

test.beforeEach(async ({ page }) => { await signIn(page); });

const MAP = "https://maps.app.goo.gl/Xk3pQ2mV9a";
// Desktop and phone runs share one database, so every name is unique.
const stamp = () => String(Date.now() % 1000000);

async function moveOn(page: import("@playwright/test").Page, buttons: string[]) {
  for (const b of buttons) {
    await page.locator("button.btn.grow").filter({ hasText: new RegExp(`^${b}$`) }).click(); // the main button, not a message chip
    await expect(page.getByText(/#\d+ is /)).toBeVisible();
  }
}

test.describe("a pickup order", () => {
  test("@smoke uses pickup wording on the shop screens and the customer's card, with a Get directions button", async ({ page, browser }) => {
    await createOrder(page, { name: `Pickup ${stamp()}`, kind: "Pickup" });
    // add the map link on the edit form
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel(/Pickup location/)).toBeVisible();
    await page.getByLabel(/Pickup location/).fill(MAP);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: /Receipt/ })).toBeVisible();

    // the steps and buttons say pickup, never delivery
    await expect(page.getByLabel("Order progress").getByText("Ready for pickup")).toBeVisible();
    await expect(page.getByLabel("Order progress").getByText("Picked up")).toBeVisible();
    await expect(page.getByLabel("Order progress").getByText("On the way")).toHaveCount(0);
    await page.getByRole("button", { name: "Confirm order", exact: true }).click();
    await expect(page.locator("code").first()).toBeVisible();
    const path = new URL(`http://${await page.locator("code").first().innerText()}`).pathname;
    await moveOn(page, ["Mark packed"]);
    await expect(page.locator("button.btn.grow").filter({ hasText: /Out for delivery/ })).toHaveCount(0);
    await moveOn(page, ["Ready for pickup"]);
    await expect(page.getByText(/is ready for pickup/)).toBeVisible();
    await expect(page.locator("button.btn.grow").filter({ hasText: /Mark delivered/ })).toHaveCount(0);
    // the messages for a pickup leave out the rider ones and add "Ready for pickup"
    await expect(page.locator(".chips").getByRole("button", { name: "Ready for pickup", exact: true })).toBeVisible();
    for (const gone of ["Rider assigned", "On the way", "Delivered"]) await expect(page.locator(".chips").getByRole("button", { name: gone, exact: true })).toHaveCount(0);
    await expect(page.getByText(/hands the rider/)).toHaveCount(0);
    await expect(page.getByText(/when collecting/)).toBeVisible();

    const customer = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const card = await customer.newPage();
    await card.goto(path);
    await expect(card.getByRole("heading", { name: "Ready for you to collect" })).toBeVisible();
    await expect(card.getByLabel("Where to collect")).toContainText("Collect from");
    const dir = card.getByRole("link", { name: /Get directions/ });
    await expect(dir).toHaveAttribute("href", MAP);
    await expect(dir).toHaveAttribute("rel", /noopener/);
    await expect(card.getByLabel("Delivery progress").getByText("Ready", { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: /Track delivery/ })).toHaveCount(0);
    await expect(card.getByText("has your parcel")).toHaveCount(0);

    await moveOn(page, ["Mark picked up"]);
    await card.reload();
    await expect(card.getByRole("heading", { name: /Picked up/ })).toBeVisible();
    await expect(card.getByRole("link", { name: /Get directions/ })).toHaveCount(0); // nothing left to find
    await customer.close();
  });

  test("the map link field is only on a pickup order", async ({ page }) => {
    await page.goto("/orders/new");
    await expect(page.getByLabel(/Pickup location/)).toBeHidden(); // Rider is the default
    await page.locator(".seg label", { hasText: /^Pickup$/ }).click();
    await expect(page.getByLabel(/Pickup location/)).toBeVisible();
    await page.locator(".seg label", { hasText: /^Courier$/ }).click();
    await expect(page.getByLabel(/Pickup location/)).toBeHidden();
  });

  test("@smoke the Orders filters keep 'Ready for pickup' apart from 'Out for delivery'", async ({ page }) => {
    const tag = stamp();
    const rider = `Rider Filter ${tag}`;
    const pick = `Pick Filter ${tag}`;
    await createOrder(page, { name: rider, rider: "300" });
    await moveOn(page, ["Confirm order", "Mark packed", "Out for delivery"]);
    await createOrder(page, { name: pick, kind: "Pickup" });
    await moveOn(page, ["Confirm order", "Mark packed", "Ready for pickup"]);

    await page.goto(`/orders?status=ready_for_pickup&q=${tag}`);
    await expect(page.getByText(pick)).toBeVisible();
    await expect(page.getByText(rider)).toHaveCount(0);
    await expect(page.getByText("Ready for pickup", { exact: true }).first()).toBeVisible(); // the row's own name for the stage

    await page.goto(`/orders?status=out_for_delivery&q=${tag}`);
    await expect(page.getByText(rider)).toBeVisible();
    await expect(page.getByText(pick)).toHaveCount(0);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ready for pickup" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "On the way" })).toBeVisible();
  });
});
