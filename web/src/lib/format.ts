import type { Stage } from "./types";

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

// A display-only preview of the totals while the order is being typed. The server recalculates
// everything on save with the real rules (api/src/invoice/totals.ts) and its numbers win.
export function previewTotals(lines: { quantity: number; unitPrice: number }[], discountPercent: number, deliveryCharge: number, riderFee: number, payment: "paid" | "cod" | "unpaid") {
  const subtotal = lines.reduce((n, l) => n + l.quantity * l.unitPrice, 0);
  const discount = Math.round((subtotal * Math.min(Math.max(discountPercent, 0), 100)) / 100);
  const total = subtotal - discount + deliveryCharge;
  const codAmount = payment === "cod" ? total : 0;
  return { subtotal, discount, total, codAmount, collectAtDoor: codAmount + riderFee };
}
