import { sql } from "drizzle-orm";
import { Router } from "express";
import { asOwner, type Db } from "../db/client";
import { rows } from "../db/query";

// One query over every store the owner has (row-level security already limits it to theirs).
// "Needs action" is what the owner has to do something about today:
//   pending          -> confirm it
//   toPack           -> confirmed, not packed yet
//   awaitingRider    -> packed local delivery with no rider booked yet
//   cashOutstanding  -> COD cash a rider has not handed over
type Counts = {
  storeId: string;
  name: string;
  accent: string;
  pending: number;
  toPack: number;
  awaitingRider: number;
  outForDelivery: number;
  delivered: number;
  problems: number;
  cashOutstanding: number;
  needsAction: number;
  ordersToday: number;
  salesToday: number;
};

export function dashboardRouter(db: Db): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const stores = await asOwner(db, req.user!.id, (tx) =>
      rows<Counts>(
        tx,
        sql`select s.id as store_id, s.name, s.accent,
              count(o.id) filter (where o.status = 'pending')::int as pending,
              count(o.id) filter (where o.status = 'confirmed')::int as to_pack,
              count(o.id) filter (where o.status = 'packed' and o.delivery_kind = 'local' and coalesce(d.status, 'pending') = 'pending')::int as awaiting_rider,
              count(o.id) filter (where o.status = 'out_for_delivery')::int as out_for_delivery,
              count(o.id) filter (where o.status = 'delivered')::int as delivered,
              count(o.id) filter (where o.status = 'returned')::int as problems,
              count(o.id) filter (where o.payment = 'cod' and o.cod_amount > 0 and o.status in ('out_for_delivery', 'delivered')
                                    and not coalesce(d.cash_handed_over, false))::int as cash_outstanding,
              count(o.id) filter (where (o.created_at at time zone 'Asia/Karachi')::date = (now() at time zone 'Asia/Karachi')::date
                                    and o.status <> 'cancelled')::int as orders_today,
              coalesce(sum(o.total) filter (where (o.created_at at time zone 'Asia/Karachi')::date = (now() at time zone 'Asia/Karachi')::date
                                              and o.status <> 'cancelled'), 0)::int as sales_today
            from stores s
            left join orders o on o.store_id = s.id
            left join deliveries d on d.order_id = o.id
           group by s.id order by s.created_at`,
      ),
    );
    const withAction = stores.map((s) => ({ ...s, needsAction: s.pending + s.toPack + s.awaitingRider + s.cashOutstanding }));
    const sum = (key: keyof Counts) => withAction.reduce((n, s) => n + (s[key] as number), 0);
    res.json({
      stores: withAction,
      totals: {
        pending: sum("pending"), toPack: sum("toPack"), awaitingRider: sum("awaitingRider"), outForDelivery: sum("outForDelivery"),
        delivered: sum("delivered"), problems: sum("problems"), cashOutstanding: sum("cashOutstanding"), needsAction: sum("needsAction"),
        ordersToday: sum("ordersToday"), salesToday: sum("salesToday"),
      },
    });
  });

  return router;
}
