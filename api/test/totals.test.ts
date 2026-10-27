import { describe, expect, it } from "vitest";
import { calculateTotals } from "../src/invoice/totals";

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
