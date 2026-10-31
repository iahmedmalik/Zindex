import type { ItemDiscount, Stage } from "./types";

export const pkr = (n: number) => `PKR ${n.toLocaleString("en-US")}`;

export const stageLabel: Record<Stage, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  packed: "Packed",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
};

export const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** What a discount on one item takes off the line (quantity x price): a percent of it, or rupees, never more than the line. */
export const lineOff = (l: { quantity: number; unitPrice: number; discount?: ItemDiscount | null }) => {
  const gross = l.quantity * l.unitPrice;
  const d = l.discount;
  if (!d || d.value <= 0) return 0;
  return d.kind === "percent" ? Math.round((gross * Math.min(d.value, 100)) / 100) : Math.min(d.value, gross);
};
export const offLabel = (d: ItemDiscount) => (d.kind === "percent" ? `${d.value}% off` : `Rs ${d.value.toLocaleString("en-US")} off`);

// A display-only preview of the totals while the order is being typed. The server recalculates
// everything on save with the real rules (api/src/invoice/totals.ts) and its numbers win.
export function previewTotals(lines: { quantity: number; unitPrice: number; discount?: ItemDiscount | null }[], discountPercent: number, deliveryCharge: number, riderFee: number, payment: "paid" | "cod" | "unpaid", storePays = false) {
  const subtotal = lines.reduce((n, l) => n + l.quantity * l.unitPrice - lineOff(l), 0);
  const discount = Math.round((subtotal * Math.min(Math.max(discountPercent, 0), 100)) / 100);
  const total = subtotal - discount + (storePays ? 0 : deliveryCharge);
  const codAmount = payment === "cod" ? total : 0;
  return { subtotal, discount, total, codAmount, collectAtDoor: codAmount + (storePays ? 0 : riderFee) };
}

/** The order as the customer sees it: delivery money the store pays is not shown to them at all. */
export function forCustomer<T extends { deliveryPaidBy: "customer" | "store"; riderFee: number; deliveryCharge: number }>(order: T): T {
  return order.deliveryPaidBy === "store" ? { ...order, riderFee: 0, deliveryCharge: 0 } : order;
}

/** What the store itself pays for delivery on this order (0 when the customer pays it). */
export const deliveryCost = (o: { deliveryPaidBy: "customer" | "store"; riderFee: number; deliveryCharge: number }) => (o.deliveryPaidBy === "store" ? o.riderFee + o.deliveryCharge : 0);
