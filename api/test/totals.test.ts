import { describe, expect, it } from "vitest";
import { calculateTotals, lineDiscount } from "../src/invoice/totals";

const base = { discount: { kind: "none" } as const, deliveryCharge: 0, riderFee: 0, payment: "unpaid" as const };

describe("calculateTotals", () => {
  it("adds up quantity x price for each line", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 2, unitPrice: 1500 }, { quantity: 1, unitPrice: 800 }] });
    expect(t.subtotal).toBe(3800);
    expect(t.total).toBe(3800);
  });

  it("gives zeros for an invoice with no lines", () => {
    const t = calculateTotals({ ...base, lines: [] });
    expect(t).toMatchObject({ subtotal: 0, discount: 0, total: 0 });
  });

  it("takes off a percent discount", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 5000 }], discount: { kind: "percent", percent: 10 } });
    expect(t.discount).toBe(500);
    expect(t.total).toBe(4500);
  });

  it("takes off a percent discount, rounded to the nearest rupee with halves up", () => {
    const lines = [{ quantity: 1, unitPrice: 999 }];
    expect(calculateTotals({ ...base, lines, discount: { kind: "percent", percent: 10 } }).discount).toBe(100); // 99.9
    expect(calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 1005 }], discount: { kind: "percent", percent: 10 } }).discount).toBe(101); // 100.5
  });

  it("a 100% discount makes the goods free but the delivery charge is still owed", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 300 }], discount: { kind: "percent", percent: 100 }, deliveryCharge: 150 });
    expect(t.discount).toBe(300);
    expect(t.total).toBe(150);
  });

  it("adds the delivery charge after the discount", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 2000 }], discount: { kind: "percent", percent: 10 }, deliveryCharge: 250 });
    expect(t.total).toBe(2050);
  });

  it("paid: nothing is owed to the store and the store collects no cash", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 2000 }], deliveryCharge: 250, payment: "paid" });
    expect(t).toMatchObject({ total: 2250, codAmount: 0, amountDue: 0, collectAtDoor: 0 });
  });

  it("cod: the rider collects the whole total for the store", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 2000 }], deliveryCharge: 250, payment: "cod" });
    expect(t).toMatchObject({ total: 2250, codAmount: 2250, amountDue: 2250, collectAtDoor: 2250 });
  });

  it("unpaid: the whole total is due, but the rider collects nothing for the store", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 2000 }], payment: "unpaid" });
    expect(t).toMatchObject({ total: 2000, codAmount: 0, amountDue: 2000, collectAtDoor: 0 });
  });

  it("the rider fee is not part of the store's total", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 2000 }], riderFee: 350, payment: "unpaid" });
    expect(t).toMatchObject({ subtotal: 2000, total: 2000, riderFee: 350, amountDue: 2000 });
  });

  it("cod with a rider fee: the recipient hands over goods + rider fee, the store only gets the goods", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 2000 }], riderFee: 350, payment: "cod" });
    expect(t).toMatchObject({ total: 2000, codAmount: 2000, collectAtDoor: 2350 });
  });

  it("paid online with a rider fee: the recipient still pays the rider his fee at the door", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 2000 }], riderFee: 350, payment: "paid" });
    expect(t).toMatchObject({ total: 2000, codAmount: 0, amountDue: 0, collectAtDoor: 350 });
  });

  it("rejects anything that is not a whole, non-negative number of rupees or a positive quantity", () => {
    expect(() => calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 10.5 }] })).toThrow();
    expect(() => calculateTotals({ ...base, lines: [{ quantity: 0, unitPrice: 100 }] })).toThrow();
    expect(() => calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: -5 }] })).toThrow();
    expect(() => calculateTotals({ ...base, lines: [], deliveryCharge: -1 })).toThrow();
    expect(() => calculateTotals({ ...base, lines: [], riderFee: -1 })).toThrow();
    expect(() => calculateTotals({ ...base, lines: [], riderFee: 10.5 })).toThrow();
    expect(() => calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 100 }], discount: { kind: "percent", percent: 101 } })).toThrow();
  });
});

describe("a discount on one item", () => {
  it("percent: takes the percent off the whole line (quantity x price)", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 2, unitPrice: 1500, discount: { kind: "percent", value: 10 } }, { quantity: 1, unitPrice: 800 }] });
    expect(t.lineDiscounts).toEqual([300, 0]);
    expect(t.subtotal).toBe(3500); // 2700 + 800
    expect(t.total).toBe(3500);
  });

  it("rupees: takes a fixed amount off the whole line, not per piece", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 2, unitPrice: 1500, discount: { kind: "amount", value: 500 } }] });
    expect(t.lineDiscounts).toEqual([500]);
    expect(t.subtotal).toBe(2500);
  });

  it("percent is rounded to the nearest rupee with halves up, like the order discount", () => {
    expect(lineDiscount({ quantity: 1, unitPrice: 1005, discount: { kind: "percent", value: 10 } })).toBe(101); // 100.5
    expect(lineDiscount({ quantity: 1, unitPrice: 999, discount: { kind: "percent", value: 10 } })).toBe(100); // 99.9
  });

  it("a line with no discount, or a discount of 0, takes nothing off", () => {
    expect(lineDiscount({ quantity: 3, unitPrice: 400 })).toBe(0);
    expect(lineDiscount({ quantity: 3, unitPrice: 400, discount: { kind: "percent", value: 0 } })).toBe(0);
    expect(lineDiscount({ quantity: 3, unitPrice: 400, discount: { kind: "amount", value: 0 } })).toBe(0);
  });

  it("100% or the whole line in rupees makes the item free; more than the line is refused", () => {
    expect(lineDiscount({ quantity: 1, unitPrice: 300, discount: { kind: "percent", value: 100 } })).toBe(300);
    expect(lineDiscount({ quantity: 1, unitPrice: 300, discount: { kind: "amount", value: 300 } })).toBe(300);
    expect(() => lineDiscount({ quantity: 1, unitPrice: 300, discount: { kind: "amount", value: 301 } })).toThrow(/more than/);
    expect(() => lineDiscount({ quantity: 1, unitPrice: 300, discount: { kind: "percent", value: 101 } })).toThrow(/between 0 and 100/);
  });

  it("refuses a discount that is not a whole, non-negative number", () => {
    expect(() => lineDiscount({ quantity: 1, unitPrice: 300, discount: { kind: "amount", value: -5 } })).toThrow(/whole/);
    expect(() => lineDiscount({ quantity: 1, unitPrice: 300, discount: { kind: "amount", value: 2.5 } })).toThrow(/whole/);
    expect(() => lineDiscount({ quantity: 1, unitPrice: 300, discount: { kind: "percent", value: 12.5 } })).toThrow(/whole/);
  });

  it("the order discount then applies to what is left after the line discounts", () => {
    const t = calculateTotals({
      ...base,
      lines: [{ quantity: 2, unitPrice: 1500, discount: { kind: "percent", value: 10 } }, { quantity: 1, unitPrice: 1000 }],
      discount: { kind: "percent", percent: 10 },
    });
    expect(t.subtotal).toBe(3700); // 2700 + 1000
    expect(t.discount).toBe(370); // the order discount only
    expect(t.total).toBe(3330);
  });

  it("works with delivery and cash on delivery as before", () => {
    const t = calculateTotals({ ...base, lines: [{ quantity: 1, unitPrice: 2000, discount: { kind: "amount", value: 200 } }], deliveryCharge: 250, riderFee: 150, payment: "cod" });
    expect(t).toMatchObject({ subtotal: 1800, total: 2050, codAmount: 2050, collectAtDoor: 2200 });
  });
});

describe("who pays for delivery", () => {
  const goods = [{ quantity: 2, unitPrice: 1000 }]; // 2,000
  it("customer pays a rider: the fee is collected at the door and is not in the total (as always)", () => {
    const t = calculateTotals({ ...base, lines: goods, riderFee: 300, payment: "cod", deliveryPaidBy: "customer" });
    expect(t).toMatchObject({ total: 2000, collectAtDoor: 2300, deliveryCost: 0 });
  });
  it("store pays a rider: nothing extra at the door and the fee is the store's cost", () => {
    const t = calculateTotals({ ...base, lines: goods, riderFee: 300, payment: "cod", deliveryPaidBy: "store" });
    expect(t).toMatchObject({ total: 2000, codAmount: 2000, collectAtDoor: 2000, deliveryCost: 300 });
    expect(calculateTotals({ ...base, lines: goods, riderFee: 300, payment: "paid", deliveryPaidBy: "store" }).collectAtDoor).toBe(0);
  });
  it("customer pays a courier: the charge is in the total, paid with the order", () => {
    const t = calculateTotals({ ...base, lines: goods, deliveryCharge: 250, payment: "cod", deliveryPaidBy: "customer" });
    expect(t).toMatchObject({ total: 2250, collectAtDoor: 2250, deliveryCost: 0 });
  });
  it("store pays a courier: the total is goods only and the charge is the store's cost", () => {
    const t = calculateTotals({ ...base, lines: goods, deliveryCharge: 250, payment: "cod", deliveryPaidBy: "store" });
    expect(t).toMatchObject({ total: 2000, collectAtDoor: 2000, deliveryCost: 250 });
  });
  it("asking for nothing means the customer pays, so old callers do not change", () => {
    const t = calculateTotals({ ...base, lines: goods, deliveryCharge: 250, riderFee: 0, payment: "unpaid" });
    expect(t).toMatchObject({ total: 2250, deliveryCost: 0 });
  });
});
