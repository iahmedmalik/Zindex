// Invoice totals. All money is whole PKR rupees (integers), never decimals.
//
// Rules (R1 confirmed 28 Oct: percent discounts only, normal rounding; rider fee explained 28 Oct):
//  - line total = quantity x unit price
//  - discount is a percent (0 to 100) of the subtotal, rounded to the nearest whole rupee,
//    halves going up
//  - deliveryCharge is the store's flat courier fee (part of the store's money); riderFee is the
//    inDrive/Yango fee typed in per parcel, paid by the recipient straight to the rider, and is
//    NOT part of the store's total
//  - total (the store's invoice total) = subtotal - discount + deliveryCharge
//  - payment: "paid" owes nothing, "cod" means the rider collects the total for the store,
//    "unpaid" owes the total later (ASSUMED: the rider collects only his own fee)
//  - collectAtDoor = what the recipient hands the rider = codAmount + riderFee

export type Line = { quantity: number; unitPrice: number };
export type Discount = { kind: "none" } | { kind: "percent"; percent: number };
export type Payment = "paid" | "cod" | "unpaid";

export type Totals = {
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  riderFee: number;
  codAmount: number;
  collectAtDoor: number;
  amountDue: number;
};

const whole = (n: number) => Number.isInteger(n) && n >= 0;

export function calculateTotals(input: { lines: Line[]; discount: Discount; deliveryCharge: number; riderFee: number; payment: Payment }): Totals {
  if (!whole(input.deliveryCharge)) throw new Error("Delivery charge must be a whole, non-negative number of rupees.");
  if (!whole(input.riderFee)) throw new Error("Rider fee must be a whole, non-negative number of rupees.");
  let subtotal = 0;
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new Error("Quantity must be a whole number of at least 1.");
    if (!whole(l.unitPrice)) throw new Error("Unit price must be a whole, non-negative number of rupees.");
    subtotal += l.quantity * l.unitPrice;
  }
  let discount = 0;
  const d = input.discount;
  if (d.kind === "percent") {
    if (d.percent < 0 || d.percent > 100) throw new Error("Percent must be between 0 and 100.");
    discount = Math.round((subtotal * d.percent) / 100);
  }
  const total = subtotal - discount + input.deliveryCharge;
  const codAmount = input.payment === "cod" ? total : 0;
  return {
    subtotal,
    discount,
    deliveryCharge: input.deliveryCharge,
    total,
    riderFee: input.riderFee,
    codAmount,
    collectAtDoor: codAmount + input.riderFee,
    amountDue: input.payment === "paid" ? 0 : total,
  };
}
