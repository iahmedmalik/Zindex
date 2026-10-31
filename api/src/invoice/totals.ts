// Invoice totals. All money is whole PKR rupees (integers), never decimals.
//
// Rules (R1 confirmed 28 Oct: percent discounts only, normal rounding; rider fee explained 28 Oct):
//  - line total = quantity x unit price, minus the line's own discount if it has one (a percent of the line, rounded to
//    the nearest whole rupee with halves up, or a fixed number of rupees off the WHOLE line, never more than the line)
//  - subtotal = the sum of the line totals (so it is after the line discounts)
//  - the order discount is a percent (0 to 100) of the subtotal, rounded to the nearest whole rupee,
//    halves going up; it comes on top of the line discounts
//  - deliveryCharge is the store's flat courier fee (part of the store's money); riderFee is the
//    inDrive/Yango fee typed in per parcel, paid by the recipient straight to the rider, and is
//    NOT part of the store's total
//  - who pays delivery (31 Oct, from the owner's brother): "customer" is the rules above and below. "store" means the
//    store bears the delivery: the customer's total is goods only (no deliveryCharge in it), no rider fee is collected at
//    the door, and the typed fee or charge is the store's own delivery cost (deliveryCost), which reports take off profit
//  - total (the store's invoice total) = subtotal - discount + deliveryCharge (only when the customer pays delivery)
//  - payment: "paid" owes nothing, "cod" means the rider collects the total for the store,
//    "unpaid" owes the total later (ASSUMED: the rider collects only his own fee)
//  - collectAtDoor = what the recipient hands the rider = codAmount + riderFee

export type LineDiscount = { kind: "percent"; value: number } | { kind: "amount"; value: number };
export type Line = { quantity: number; unitPrice: number; discount?: LineDiscount | null };
export type Discount = { kind: "none" } | { kind: "percent"; percent: number };
export type Payment = "paid" | "cod" | "unpaid";

export type Totals = {
  /** What each line is reduced by, in the order of the lines. */
  lineDiscounts: number[];
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  riderFee: number;
  codAmount: number;
  collectAtDoor: number;
  amountDue: number;
  /** What the store itself pays for delivery on this order (0 when the customer pays it). */
  deliveryCost: number;
};
export type DeliveryPaidBy = "customer" | "store";

const whole = (n: number) => Number.isInteger(n) && n >= 0;

/** How many rupees one line is reduced by (0 when it has no discount). Throws a plain sentence when the discount is not valid. */
export function lineDiscount(line: Line): number {
  const d = line.discount;
  if (!d) return 0;
  if (!whole(d.value)) throw new Error("A discount must be a whole, non-negative number.");
  const gross = line.quantity * line.unitPrice;
  if (d.kind === "percent") {
    if (d.value > 100) throw new Error("A percent discount must be between 0 and 100.");
    return Math.round((gross * d.value) / 100);
  }
  if (d.value > gross) throw new Error("A discount in rupees cannot be more than the item's total.");
  return d.value;
}

export function calculateTotals(input: { lines: Line[]; discount: Discount; deliveryCharge: number; riderFee: number; payment: Payment; deliveryPaidBy?: DeliveryPaidBy }): Totals {
  const storePays = input.deliveryPaidBy === "store";
  if (!whole(input.deliveryCharge)) throw new Error("Delivery charge must be a whole, non-negative number of rupees.");
  if (!whole(input.riderFee)) throw new Error("Rider fee must be a whole, non-negative number of rupees.");
  let subtotal = 0;
  const lineDiscounts: number[] = [];
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new Error("Quantity must be a whole number of at least 1.");
    if (!whole(l.unitPrice)) throw new Error("Unit price must be a whole, non-negative number of rupees.");
    const off = lineDiscount(l);
    lineDiscounts.push(off);
    subtotal += l.quantity * l.unitPrice - off;
  }
  let discount = 0;
  const d = input.discount;
  if (d.kind === "percent") {
    if (d.percent < 0 || d.percent > 100) throw new Error("Percent must be between 0 and 100.");
    discount = Math.round((subtotal * d.percent) / 100);
  }
  const total = subtotal - discount + (storePays ? 0 : input.deliveryCharge);
  const codAmount = input.payment === "cod" ? total : 0;
  return {
    lineDiscounts,
    subtotal,
    discount,
    deliveryCharge: input.deliveryCharge,
    total,
    riderFee: input.riderFee,
    codAmount,
    collectAtDoor: codAmount + (storePays ? 0 : input.riderFee),
    amountDue: input.payment === "paid" ? 0 : total,
    deliveryCost: storePays ? input.deliveryCharge + input.riderFee : 0,
  };
}
