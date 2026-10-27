import { normalisePhone } from "../phone";

// Turns the rows of a Shopify "Export orders" CSV into Zindex orders.
//
// How Shopify writes the file: one row per line item; the order's own columns (customer, totals,
// payment) are filled on the order's FIRST row only, and every row carries the order "Name" (#1042).
// The column names below are Shopify's standard export headers. They have not yet been checked
// against a real export from the Sheen stores (sample still owed); unknown headers are ignored.
//
// Mapping rules (to confirm with R1):
//  * Cancelled, refunded or voided orders are skipped and reported.
//  * "paid" / "partially_refunded" -> paid in advance; anything else (pending, authorized) -> COD.
//  * Shipping -> the flat courier delivery fee (website orders go by courier).
//  * Zindex discounts are percentages, Shopify's are amounts: the amount becomes the nearest whole
//    percent, and if that changes the total the order is flagged so the owner can check it.
//  * Prices with paisa are rounded to whole rupees and flagged.
//  * Orders arrive as "pending": nothing touches stock until the owner confirms them.

export type ImportedOrder = {
  externalRef: string;
  customerName: string;
  customerPhone: string | null;
  address: string | null;
  items: { name: string; quantity: number; unitPrice: number }[];
  discountPercent: number;
  deliveryCharge: number;
  payment: "paid" | "cod";
  paymentMethod: string | null;
  notes: string | null;
  shopifyTotal: number | null;
};
export type ImportProblem = { ref: string; reason: string };

const pick = (row: Record<string, string>, ...names: string[]) => {
  for (const n of names) {
    const hit = Object.keys(row).find((k) => k.toLowerCase() === n.toLowerCase());
    if (hit && row[hit]) return row[hit]!;
  }
  return "";
};
const money = (s: string) => (s === "" ? 0 : Number(s.replace(/[^0-9.-]/g, "")));

export function mapShopifyOrders(rows: Record<string, string>[]): { orders: ImportedOrder[]; skipped: ImportProblem[]; warnings: ImportProblem[] } {
  const groups = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const ref = pick(row, "Name");
    if (!ref) continue;
    groups.set(ref, [...(groups.get(ref) ?? []), row]);
  }

  const orders: ImportedOrder[] = [];
  const skipped: ImportProblem[] = [];
  const warnings: ImportProblem[] = [];

  for (const [ref, group] of groups) {
    const first = group[0]!;
    const status = pick(first, "Financial Status").toLowerCase();
    if (pick(first, "Cancelled at")) { skipped.push({ ref, reason: "Cancelled in Shopify" }); continue; }
    if (["refunded", "voided"].includes(status)) { skipped.push({ ref, reason: `Shopify says ${status}` }); continue; }

    const items: ImportedOrder["items"] = [];
    let rounded = false;
    for (const row of group) {
      const name = pick(row, "Lineitem name");
      const quantity = Math.round(money(pick(row, "Lineitem quantity")));
      const raw = money(pick(row, "Lineitem price"));
      if (!name || quantity < 1) continue;
      if (!Number.isInteger(raw)) rounded = true;
      items.push({ name: name.slice(0, 120), quantity, unitPrice: Math.max(0, Math.round(raw)) });
    }
    if (items.length === 0) { skipped.push({ ref, reason: "No line items" }); continue; }
    if (rounded) warnings.push({ ref, reason: "Prices had paisa and were rounded to whole rupees" });

    const subtotal = items.reduce((n, i) => n + i.quantity * i.unitPrice, 0);
    const discountAmount = Math.round(money(pick(first, "Discount Amount")));
    const discountPercent = subtotal > 0 ? Math.min(100, Math.max(0, Math.round((discountAmount * 100) / subtotal))) : 0;
    const deliveryCharge = Math.max(0, Math.round(money(pick(first, "Shipping"))));
    const shopifyTotalRaw = pick(first, "Total");
    const shopifyTotal = shopifyTotalRaw ? Math.round(money(shopifyTotalRaw)) : null;
    const ourTotal = subtotal - Math.round((subtotal * discountPercent) / 100) + deliveryCharge;
    if (shopifyTotal !== null && shopifyTotal !== ourTotal) {
      warnings.push({ ref, reason: `Shopify total ${shopifyTotal} but Zindex works out ${ourTotal} (discounts are whole percents here); check it` });
    }

    const name = pick(first, "Shipping Name", "Billing Name") || pick(first, "Email") || "Shopify customer";
    const phoneRaw = pick(first, "Shipping Phone", "Billing Phone", "Phone");
    const phone = phoneRaw ? normalisePhone(phoneRaw) : "";
    const address = [pick(first, "Shipping Address1", "Billing Address1"), pick(first, "Shipping Address2", "Billing Address2"), pick(first, "Shipping City", "Billing City")]
      .filter(Boolean).join(", ").slice(0, 300) || null;
    const paid = status === "paid" || status === "partially_refunded";

    orders.push({
      externalRef: ref.slice(0, 40),
      customerName: name.slice(0, 120),
      customerPhone: /^[0-9]{7,15}$/.test(phone) ? phone : null,
      address,
      items,
      discountPercent,
      deliveryCharge,
      payment: paid ? "paid" : "cod",
      paymentMethod: (pick(first, "Payment Method") || null)?.slice(0, 40) ?? null,
      notes: (pick(first, "Notes") || null)?.slice(0, 500) ?? null,
      shopifyTotal,
    });
  }
  return { orders, skipped, warnings };
}
