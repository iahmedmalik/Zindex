// The demo account's starting data: three stores, products with stock, and a handful of orders in
// different stages (one with an invoice, one with a rider and a delivery card link). It goes through
// the real API, so the demo shows exactly what a real owner would have. `call` is how requests are made
// (the demo route uses the server's own address with the demo owner's session cookie).
export type Call = <T = any>(method: string, path: string, body?: unknown) => Promise<{ status: number; data: T }>;

export async function seedDemo(call: Call): Promise<void> {
  const store = async (name: string, invoicePrefix: string, accent: string, phone: string, email: string, address: string) =>
    (await call<{ store: { id: string } }>("POST", "/stores", { name, invoicePrefix, accent, phone, email, address })).data.store.id;
  const food = await store("Sheen Food", "SF", "#8a3b12", "0300 1112223", "hello@sheenfood.example", "Shop 3, Main Market, Model Town, Lahore");
  const perfumes = await store("Sheen Perfumes", "SP", "#5d1b23", "0300 1112224", "orders@sheenperfumes.example", "Office 2, Gulberg III, Lahore");
  const clothes = await store("The Sheen Store", "TS", "#1f3a5f", "0300 1112225", "support@sheenstore.example", "Shop 9, Liberty Market, Lahore");

  const product = async (storeId: string, name: string, price: number, cost: number, stock: number) => {
    const id = (await call<{ product: { id: string } }>("POST", `/stores/${storeId}/products`, { name, price, cost })).data.product.id;
    if (stock) await call("POST", `/stores/${storeId}/stock/adjust`, { productId: id, delta: stock, note: "Opening stock" });
    return id;
  };
  const garam = await product(food, "Garam masala 100 g", 450, 300, 40);
  const chilli = await product(food, "Red chilli powder 250 g", 380, 250, 25);
  const haldi = await product(food, "Turmeric 200 g", 320, 200, 3);
  const oud = await product(perfumes, "Oud Royale 50 ml", 6500, 4200, 12);
  const musk = await product(perfumes, "White Musk 30 ml", 3200, 1900, 18);
  await product(clothes, "Cotton kurta (M)", 4200, 2600, 10);
  await product(clothes, "Lawn dupatta", 1800, 900, 22);

  const order = async (storeId: string, body: object) => (await call<{ order: { id: string } }>("POST", `/stores/${storeId}/orders`, body)).data.order.id;
  const status = async (storeId: string, id: string, ...steps: string[]) => {
    for (const s of steps) await call("POST", `/stores/${storeId}/orders/${id}/status`, { status: s });
  };

  const o1 = await order(food, { customerName: "Ayesha Khan", customerPhone: "0300 1234567", address: "House 4, Street 2, Model Town, Lahore", payment: "cod", riderFee: 350, items: [{ productId: garam, quantity: 2 }, { productId: chilli, quantity: 1 }], discountPercent: 10 });
  await status(food, o1, "confirmed", "packed");

  const o2 = await order(food, { customerName: "Bilal Ahmed", customerPhone: "0321 7654321", address: "Flat 12, Johar Town, Lahore", payment: "paid", paymentMethod: "Easypaisa", riderFee: 300, items: [{ productId: haldi, quantity: 4 }] });
  await status(food, o2, "confirmed", "packed", "out_for_delivery");
  await call("PUT", `/stores/${food}/orders/${o2}/delivery`, { service: "yango", riderName: "Imran", riderPhone: "0345 5551212", bikeNumber: "LEA-1234" });
  await call("POST", `/stores/${food}/orders/${o2}/payment/confirm`);
  await call("POST", `/stores/${food}/orders/${o2}/card`, { days: 7 });

  const o3 = await order(perfumes, { customerName: "Hira Malik", customerPhone: "0333 1239876", address: "Block C, DHA Phase 5, Lahore", payment: "cod", deliveryKind: "courier", deliveryCharge: 250, items: [{ productId: oud, quantity: 1 }, { productId: musk, quantity: 2 }] });
  await status(perfumes, o3, "confirmed");

  await order(clothes, { customerName: "Sana Iqbal", customerPhone: "0300 5550001", address: "Wapda Town, Lahore", payment: "cod", riderFee: 400, items: [{ name: "Cotton kurta (M)", quantity: 1, unitPrice: 4200 }] });
  const o5 = await order(food, { customerName: "Omar Farooq", customerPhone: "0302 4443210", address: "Samanabad, Lahore", payment: "unpaid", riderFee: 250, items: [{ productId: garam, quantity: 1 }] });
  await status(food, o5, "confirmed", "packed", "out_for_delivery", "delivered");
}
