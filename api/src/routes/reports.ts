import { sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { asOwner, type Db } from "../db/client";
import { rows } from "../db/query";
import { HttpError } from "../http-error";
import { toCsv } from "../reports/csv";

// Sales and inventory reports, per store and combined. Dates are Pakistan dates (Asia/Karachi).
// What counts as a sale: every order that is not cancelled. Returned orders are counted separately
// and taken off net sales. The rider fee is never sales: it goes to the rider.

const day = /^\d{4}-\d{2}-\d{2}$/;
const uuid = /^[0-9a-f-]{36}$/i;

function range(req: Request) {
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const from = typeof req.query.from === "string" ? req.query.from : today;
  const to = typeof req.query.to === "string" ? req.query.to : today;
  if (!day.test(from) || !day.test(to) || from > to) throw new HttpError(400, "Use from and to as YYYY-MM-DD, with from on or before to.");
  const storeId = typeof req.query.storeId === "string" && req.query.storeId ? req.query.storeId : null;
  if (storeId && !uuid.test(storeId)) throw new HttpError(404, "Store not found.");
  return { from, to, storeId, csv: req.query.format === "csv" };
}

const sendCsv = (res: Response, name: string, body: string) =>
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" }).send(body);

type StoreSales = {
  storeId: string; name: string; orders: number; returned: number; gross: number; discounts: number; deliveryFees: number;
  netSales: number; returnedValue: number; codCollected: number; onlineReceived: number; riderFeesPassedOn: number;
  costOfGoods: number; linesWithoutCost: number; salesWithCost: number; salesWithoutCost: number; profit: number; marginPercent: number | null;
};

export function reportsRouter(db: Db): Router {
  const router = Router();

  router.get("/sales", async (req, res) => {
    const { from, to, storeId, csv } = range(req);
    const result = await asOwner(db, req.user!.id, async (tx) => {
      const inRange = sql`(o.created_at at time zone 'Asia/Karachi')::date between ${from}::date and ${to}::date and o.status <> 'cancelled' and (${storeId}::uuid is null or o.store_id = ${storeId}::uuid)`;
      const stores = await rows<StoreSales>(
        tx,
        sql`select s.id as store_id, s.name,
                   count(o.id)::int as orders,
                   count(o.id) filter (where o.status = 'returned')::int as returned,
                   coalesce(sum(o.subtotal), 0)::int as gross,
                   coalesce(sum(o.discount), 0)::int as discounts,
                   coalesce(sum(o.delivery_charge), 0)::int as delivery_fees,
                   coalesce(sum(o.total) filter (where o.status <> 'returned'), 0)::int as net_sales,
                   coalesce(sum(o.total) filter (where o.status = 'returned'), 0)::int as returned_value,
                   coalesce(sum(o.cod_amount) filter (where o.payment = 'cod' and o.payment_confirmed_at is not null), 0)::int as cod_collected,
                   coalesce(sum(o.total) filter (where o.payment = 'paid' and o.payment_confirmed_at is not null), 0)::int as online_received,
                   coalesce(sum(o.rider_fee), 0)::int as rider_fees_passed_on,
                   -- Profit is goods margin: what the items sold for (after the order's discount, shared across its lines) minus what
                   -- they cost. Only lines with a cost count; a line with no cost is unknown and is reported, never guessed.
                   -- The cost is the one saved on the line when the order was made. Delivery and rider fees are left out.
                   coalesce((select sum(i.quantity * i.unit_cost) from order_items i join orders o2 on o2.id = i.order_id
                              where o2.store_id = s.id and o2.status not in ('cancelled', 'returned') and i.unit_cost is not null
                                and (o2.created_at at time zone 'Asia/Karachi')::date between ${from}::date and ${to}::date), 0)::int as cost_of_goods,
                   coalesce((select count(*) from order_items i join orders o2 on o2.id = i.order_id
                              where o2.store_id = s.id and o2.status not in ('cancelled', 'returned') and i.unit_cost is null
                                and (o2.created_at at time zone 'Asia/Karachi')::date between ${from}::date and ${to}::date), 0)::int as lines_without_cost,
                   coalesce((select round(sum(i.quantity * i.unit_price * (o2.subtotal - o2.discount)::numeric / nullif(o2.subtotal, 0))) from order_items i join orders o2 on o2.id = i.order_id
                              where o2.store_id = s.id and o2.status not in ('cancelled', 'returned') and i.unit_cost is not null
                                and (o2.created_at at time zone 'Asia/Karachi')::date between ${from}::date and ${to}::date), 0)::int as sales_with_cost,
                   coalesce((select round(sum(i.quantity * i.unit_price * (o2.subtotal - o2.discount)::numeric / nullif(o2.subtotal, 0))) from order_items i join orders o2 on o2.id = i.order_id
                              where o2.store_id = s.id and o2.status not in ('cancelled', 'returned') and i.unit_cost is null
                                and (o2.created_at at time zone 'Asia/Karachi')::date between ${from}::date and ${to}::date), 0)::int as sales_without_cost
              from stores s
              left join orders o on o.store_id = s.id and ${inRange}
              left join deliveries d on d.order_id = o.id
             where (${storeId}::uuid is null or s.id = ${storeId}::uuid)
             group by s.id order by s.created_at`,
      );
      if (storeId && stores.length === 0) throw new HttpError(404, "Store not found.");
      const withProfit = (s: { salesWithCost: number; costOfGoods: number }) => ({ profit: s.salesWithCost - s.costOfGoods, marginPercent: s.salesWithCost > 0 ? Math.round(((s.salesWithCost - s.costOfGoods) * 1000) / s.salesWithCost) / 10 : null });
      for (const s of stores) Object.assign(s, withProfit(s));
      const bestSellers = await rows<{ storeName: string; name: string; quantity: number; amount: number }>(
        tx,
        sql`select s.name as store_name, i.name, sum(i.quantity)::int as quantity, sum(i.quantity * i.unit_price)::int as amount
              from order_items i join orders o on o.id = i.order_id join stores s on s.id = o.store_id
             where ${inRange} and o.status <> 'returned'
             group by s.name, i.name order by quantity desc, amount desc limit 10`,
      );
      const sum = (k: keyof StoreSales) => stores.reduce((n, s) => n + (s[k] as number), 0);
      const totals = Object.fromEntries((["orders", "returned", "gross", "discounts", "deliveryFees", "netSales", "returnedValue", "codCollected", "onlineReceived", "riderFeesPassedOn", "costOfGoods", "linesWithoutCost", "salesWithCost", "salesWithoutCost"] as const).map((k) => [k, sum(k)]));
      return { from, to, stores, totals: { ...totals, ...withProfit(totals as { salesWithCost: number; costOfGoods: number }) }, bestSellers };
    });

    if (!csv) return void res.json(result);
    const head = ["Store", "Orders", "Returned", "Gross", "Discounts", "Delivery fees", "Net sales", "Returned value", "COD collected", "Online received", "Rider fees (to riders)", "Cost of goods", "Sales with a cost", "Sales without a cost (not in profit)", "Profit (goods margin)", "Margin %"];
    const line = (name: string, s: Record<string, number>) => [name, s.orders!, s.returned!, s.gross!, s.discounts!, s.deliveryFees!, s.netSales!, s.returnedValue!, s.codCollected!, s.onlineReceived!, s.riderFeesPassedOn!, s.costOfGoods!, s.salesWithCost!, s.salesWithoutCost!, s.profit!, s.marginPercent ?? ""];
    const body = toCsv(head, [...result.stores.map((s) => line(s.name, s as unknown as Record<string, number>)), line("All stores", result.totals as Record<string, number>)]);
    sendCsv(res, `zindex-sales-${from}-to-${to}.csv`, body);
  });

  router.get("/inventory", async (req, res) => {
    const storeId = typeof req.query.storeId === "string" && req.query.storeId ? req.query.storeId : null;
    if (storeId && !uuid.test(storeId)) throw new HttpError(404, "Store not found.");
    const list = await asOwner(db, req.user!.id, (tx) =>
      rows<{ storeName: string; name: string; price: number; cost: number | null; onHand: number; unitsSold: number; valueAtCost: number | null }>(
        tx,
        sql`select s.name as store_name, p.name, p.price, p.cost,
                   coalesce(sum(m.delta), 0)::int as on_hand,
                   coalesce(-sum(m.delta) filter (where m.reason in ('sale', 'restore')), 0)::int as units_sold,
                   case when p.cost is null then null else (greatest(coalesce(sum(m.delta), 0), 0) * p.cost)::int end as value_at_cost
              from products p join stores s on s.id = p.store_id
              left join stock_movements m on m.product_id = p.id
             where (${storeId}::uuid is null or p.store_id = ${storeId}::uuid)
             group by s.name, s.created_at, p.id order by s.created_at, lower(p.name)`,
      ),
    );
    if (req.query.format !== "csv") return void res.json({ inventory: list });
    sendCsv(res, `zindex-inventory-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(["Store", "Product", "Price", "Cost", "On hand", "Units sold", "Stock value at cost"], list.map((r) => [r.storeName, r.name, r.price, r.cost, r.onHand, r.unitsSold, r.valueAtCost])));
  });

  return router;
}
