import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Accessibility, checked by machine: axe-core (WCAG 2 A and AA, which includes colour contrast) on every screen, plus
// "nothing is wider than the screen". Each screen is checked in light and dark, on the laptop and the 375 px phone
// (the two Playwright projects). The orders it opens are made through the API so the check does not click through forms.
// A finding fails the test; the screen name and the rule tell what to fix.

const MAP = "https://maps.app.goo.gl/Xk3pQ2mV9a";

type Made = { rider: string; courier: string; pickup: string; storePays: string; cards: { pickup: string; courier: string; rider: string; storePays: string } };

async function seed(page: Page): Promise<Made> {
  const stores = (await (await page.request.get("/backend/v1/stores")).json()).stores as { id: string; name: string }[];
  const store = (stores.find((s) => s.name === "Sheen Food") ?? stores[0]!).id;
  const make = async (body: object) => {
    const res = await page.request.post(`/backend/v1/stores/${store}/orders`, { data: { customerName: "Access Check", items: [{ name: "Gift box", quantity: 1, unitPrice: 1000 }], payment: "cod", ...body } });
    expect(res.ok(), await res.text()).toBe(true);
    return ((await res.json()).order as { id: string }).id;
  };
  const card = async (id: string) => {
    await page.request.post(`/backend/v1/stores/${store}/orders/${id}/status`, { data: { status: "confirmed" } });
    const url = ((await (await page.request.get(`/backend/v1/stores/${store}/orders/${id}/card`)).json()).card.url as string);
    return new URL(url).pathname;
  };
  const rider = await make({ deliveryKind: "local", riderFee: 300 });
  const courier = await make({ deliveryKind: "courier", deliveryCharge: 250 });
  await page.request.put(`/backend/v1/stores/${store}/orders/${courier}/shipment`, { data: { courier: "PostEx", trackingNo: `AX${Date.now() % 1000000}`, trackingUrl: "https://example.com/track" } });
  const pickup = await make({ deliveryKind: "pickup", pickupMapUrl: MAP });
  const storePays = await make({ deliveryKind: "local", riderFee: 300, deliveryPaidBy: "store" });
  const path = (id: string) => `/orders/${store}/${id}`;
  return {
    rider: path(rider), courier: path(courier), pickup: path(pickup), storePays: path(storePays),
    cards: { rider: await card(rider), courier: await card(courier), pickup: await card(pickup), storePays: await card(storePays) },
  };
}

test.describe("accessibility", () => {
  let made: Made;
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3500" });
    await signIn(page);
    made = await seed(page);
    await page.close();
  });

  for (const scheme of ["light", "dark"] as const) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme });

      async function check(page: Page, name: string, path: string) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(900); // entrance animations settle before contrast is measured
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        const summary = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(" ")}`);
        expect(summary, `${name} in ${scheme}`).toEqual([]);
        const wider = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(wider, `${name} is ${wider}px wider than the screen`).toBeLessThanOrEqual(0);
      }

      test("the shop's screens", async ({ page }) => {
        await signIn(page);
        for (const [name, path] of [
          ["Today", "/"], ["Orders", "/orders"], ["New order", "/orders/new"], ["Stock", "/products"], ["Customers", "/customers"],
          ["Reports", "/reports"], ["Costs to fill in", "/reports/costs"], ["Parcels", "/shipments"], ["More", "/more"], ["Settings", "/settings"],
        ] as const) await check(page, name, path);
      });

      test("an order on each kind of delivery, and its edit form", async ({ page }) => {
        await signIn(page);
        await check(page, "Rider order", made.rider);
        await check(page, "Courier order (with parcel)", made.courier);
        await check(page, "Pickup order (with map link)", made.pickup);
        await check(page, "Order the store pays delivery for", made.storePays);
        await check(page, "Edit pickup order", `${made.pickup}/edit`);
        await check(page, "Invoice", `${made.rider}/invoice`);
      });

      test("the customer's delivery cards need no sign-in", async ({ page }) => {
        for (const [name, path] of [["Rider card", made.cards.rider], ["Courier card", made.cards.courier], ["Pickup card", made.cards.pickup], ["Store-pays card", made.cards.storePays]] as const) await check(page, name, path);
        await check(page, "Link not available", "/c/not-a-real-link-0000000000000000");
      });

      test("the public pages", async ({ page }) => {
        await check(page, "Sign in", "/sign-in");
        await check(page, "Reset password", "/reset-password");
        await check(page, "How it's built", "/how-its-built");
      });
    });
  }
});
