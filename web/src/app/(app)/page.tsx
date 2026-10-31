"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Road } from "@/components/graphics";
import { Count, Icon, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { pkr } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Board, BoardCounts, Order } from "@/lib/types";

type Row = Order & { storeName: string };
type Bucket = { orders: number; amount: number };
type Cod = { expected: number; collected: number; outstanding: number; buckets: { riders: Bucket; customers: Bucket; couriers: Bucket } };
const noBuckets = { riders: { orders: 0, amount: 0 }, customers: { orders: 0, amount: 0 }, couriers: { orders: 0, amount: 0 } };

const action: Partial<Record<Order["status"], { to: string; label: string }>> = {
  pending: { to: "confirmed", label: "Confirm" },
  confirmed: { to: "packed", label: "Mark packed" },
};

// Today: where every order is on the journey line, what needs the owner now, and the cash with riders.
export default function TodayPage() {
  const { stores, storeId } = useSession();
  const toast = useToast();
  const [board, setBoard] = useState<Board | null>(null);
  const [orders, setOrders] = useState<Row[] | null>(null);
  const [cod, setCod] = useState<Cod | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const targets = storeId ? stores.filter((s) => s.id === storeId) : stores;
      const [b, lists, cods] = await Promise.all([
        api<Board>("/dashboard"),
        Promise.all(targets.map(async (s) => (await api<{ orders: Order[] }>(`/stores/${s.id}/orders`)).orders.map((o) => ({ ...o, storeName: s.name })))),
        Promise.all(targets.map((s) => api<Cod>(`/stores/${s.id}/cod-summary`))),
      ]);
      setBoard(b);
      setOrders(lists.flat().sort((x, y) => y.createdAt.localeCompare(x.createdAt)));
      setCod(cods.reduce((n, c) => ({
        expected: n.expected + c.expected, collected: n.collected + c.collected, outstanding: n.outstanding + c.outstanding,
        buckets: {
          riders: { orders: n.buckets.riders.orders + c.buckets.riders.orders, amount: n.buckets.riders.amount + c.buckets.riders.amount },
          customers: { orders: n.buckets.customers.orders + c.buckets.customers.orders, amount: n.buckets.customers.amount + c.buckets.customers.amount },
          couriers: { orders: n.buckets.couriers.orders + c.buckets.couriers.orders, amount: n.buckets.couriers.amount + c.buckets.couriers.amount },
        },
      }), { expected: 0, collected: 0, outstanding: 0, buckets: noBuckets }));
      setError("");
    } catch (err) {
      setError(messageOf(err));
    }
  }, [stores, storeId]);
  useEffect(() => { void load(); }, [load]);

  async function act(o: Row, to: string) {
    try {
      const r = await api<{ stockWarnings?: { name: string; onHand: number }[] }>(`/stores/${o.storeId}/orders/${o.id}/status`, { method: "POST", body: { status: to } });
      setLeaving((s) => new Set(s).add(o.id));
      const warn = r.stockWarnings?.length ? ` · ${r.stockWarnings.map((w) => `${w.name} now ${w.onHand}`).join(", ")}` : "";
      toast(to === "confirmed" ? `#${o.orderNo} confirmed · stock taken out${warn}` : `#${o.orderNo} packed`);
      setTimeout(() => { setLeaving(new Set()); void load(); }, 260);
    } catch (err) {
      toast(messageOf(err), "bad");
    }
  }

  if (stores.length === 0) {
    return (
      <div className="empty">
        <b>Add your first store</b>
        <span>Each store keeps its own products, prices, customers and invoice numbers.</span>
        <Link className="btn" href="/settings">Add a store</Link>
      </div>
    );
  }
  if (error) return <div className="stack"><p className="error" role="alert">{error}</p><button className="btn quiet" onClick={() => void load()}>Try again</button></div>;
  if (!board || !orders) return <div className="skel" aria-busy="true"><span /><span /><span /></div>;

  const c: BoardCounts = storeId ? (board.stores.find((s) => s.storeId === storeId) ?? board.totals) : board.totals;
  const needs = orders.filter((o) => o.status === "pending" || o.status === "confirmed" || o.status === "packed");
  const onWay = orders.filter((o) => o.status === "out_for_delivery" && o.deliveryKind !== "pickup");
  const readyPickup = orders.filter((o) => o.status === "out_for_delivery" && o.deliveryKind === "pickup");
  const todayKey = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const doneToday = orders.filter((o) => o.status === "delivered" && new Date(new Date(o.createdAt).getTime() + 5 * 3600_000).toISOString().slice(0, 10) === todayKey);
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="split">
      <div className="stack" style={{ gap: 28 }}>
        <h1 className="sr">Today</h1>
        <section className="hero arrive" aria-label="Sales today">
          <p className="lbl">Sales today · {date}</p>
          <p className="figure"><small>PKR</small><Count value={c.salesToday} money /></p>
          <div className="pills"><span><Count value={c.ordersToday} /> orders</span><span><Count value={c.outForDelivery} /> out for delivery</span></div>
          <Road />
        </section>

        <section className="section">
          <header><h2>{c.needsAction === 0 ? "All caught up" : `${c.needsAction} need${c.needsAction === 1 ? "s" : ""} you`}</h2><Link className="linkbtn" href="/orders">See all</Link></header>
          <div className="tiles">
            {[
              { n: c.pending, t: "To confirm", icon: "check", hot: true, href: "/orders?status=pending" },
              { n: c.toPack, t: "To pack", icon: "stock", href: "/orders?status=confirmed" },
              { n: c.awaitingRider, t: "Needs a rider", icon: "bike", href: "/orders?view=needs_rider" },
              { n: c.outForDelivery, t: "On the way", icon: "truck", href: "/orders?status=out_for_delivery" },
              { n: c.cashOutstanding, t: "Cash to collect", icon: "cash", href: "/orders?view=cash" },
              { n: doneToday.length, t: "Delivered", icon: "check", href: "/orders?view=delivered_today" },
            ].map((x, i) => (
              <Link key={x.t} href={x.href} className={`tile arrive${x.hot && x.n > 0 ? " hot" : ""}${x.n === 0 ? " zero" : ""}`} style={{ ["--i" as string]: i }}>
                <Icon name={x.icon} size={24} />
                <span className="n"><Count value={x.n} /></span>
                <span className="t">{x.t}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="section">
          <header><h2>Needs you now</h2><span className="note num">{needs.length}</span></header>
          {needs.length === 0 ? <p className="note">Nothing waiting. New orders from WhatsApp go in with the + button.</p> : (
            <ul className="rows">
              {needs.map((o, i) => {
                const a = action[o.status];
                return (
                  <li key={o.id} className={`collapse arrive${leaving.has(o.id) ? " gone" : ""}`} style={{ ["--i" as string]: i }}>
                    <div>
                      <Link className="row" href={`/orders/${o.storeId}/${o.id}`}>
                        <span className={`stage ${o.status}`} aria-hidden="true" />
                        <span><span className="ttl">#{o.orderNo} {o.customerName}</span><br /><span className="meta">{!storeId && `${o.storeName} · `}{o.status === "packed" ? (o.deliveryKind === "courier" ? "packed, to ship" : o.deliveryKind === "pickup" ? "packed, for pickup" : "packed, no rider yet") : `${o.items.length} item${o.items.length === 1 ? "" : "s"}`}</span></span>
                        <span className="end">
                          <span className="amt num">{pkr(o.total)}</span>
                          {a ? (
                            <button className={`btn small${o.status === "pending" ? "" : " quiet"}`} onClick={(e) => { e.preventDefault(); void act(o, a.to); }}>{a.label}</button>
                          ) : <span className="btn small quiet">{o.deliveryKind === "courier" ? "Ship" : o.deliveryKind === "pickup" ? "Open" : "Book rider"}</span>}
                        </span>
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {onWay.length > 0 && (
          <section className="section">
            <header><h2>On the way</h2></header>
            <ul className="rows">
              {onWay.map((o, i) => (
                <li key={o.id} className="arrive" style={{ ["--i" as string]: i }}>
                  <Link className="row" href={`/orders/${o.storeId}/${o.id}`}>
                    <span className="stage out_for_delivery" aria-hidden="true" />
                    <span><span className="ttl">#{o.orderNo} {o.customerName}</span><br /><span className="meta">{!storeId && `${o.storeName} · `}{o.deliveryKind === "courier" ? "with the courier" : "with the rider"}</span></span>
                    <span className="end"><span className="amt num">{pkr(o.collectAtDoor)}</span><span className="meta">at the door</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {readyPickup.length > 0 && (
          <section className="section">
            <header><h2>Ready for pickup</h2><Link className="linkbtn" href="/orders?status=ready_for_pickup">See all</Link></header>
            <ul className="rows">
              {readyPickup.map((o, i) => (
                <li key={o.id} className="arrive" style={{ ["--i" as string]: i }}>
                  <Link className="row" href={`/orders/${o.storeId}/${o.id}`}>
                    <span className="stage out_for_delivery" aria-hidden="true" />
                    <span><span className="ttl">#{o.orderNo} {o.customerName}</span><br /><span className="meta">{!storeId && `${o.storeName} · `}waiting at the shop</span></span>
                    <span className="end"><span className="amt num">{pkr(o.collectAtDoor)}</span><span className="meta">{o.collectAtDoor > 0 ? "to collect" : "paid"}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {doneToday.length > 0 && (
          <section className="section">
            <header><h2>Delivered today</h2></header>
            <ul className="rows">
              {doneToday.map((o) => (
                <li key={o.id}>
                  <Link className="row" href={`/orders/${o.storeId}/${o.id}`}>
                    <span className="stage delivered" aria-hidden="true" />
                    <span><span className="ttl">#{o.orderNo} {o.customerName}</span><br /><span className="meta">{!storeId && `${o.storeName} · `}{o.payment === "unpaid" ? "pay later" : o.payment === "cod" ? "cash on delivery" : "paid"}</span></span>
                    <span className="end"><span className="amt num">{pkr(o.total)}</span>{o.payment === "unpaid" && !o.paymentConfirmedAt && <span className="badge warn">Due</span>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="side">
        {cod && (
          <section className="well">
            <h2>Cash to collect</h2>
            <ul className="ledger">
              <li><span>Expected</span><span className="lead" /><span className="num">PKR <Count value={cod.expected} money /></span></li>
              <li><span>Received</span><span className="lead" /><span className="num">PKR <Count value={cod.collected} money /></span></li>
              <li className="total"><span>Still to collect</span><span className="lead" /><span className="num">PKR <Count value={cod.outstanding} money /></span></li>
            </ul>
            <ul className="ledger" aria-label="Who owes it">
              {([["riders", "With riders"], ["customers", "From customers"], ["couriers", "From couriers"]] as const).map(([key, label]) => (
                <li key={key} style={{ fontSize: "var(--t-sm)" }}>
                  <Link href={`/orders?view=cash&bucket=${key}`} style={{ textDecoration: "none", display: "contents" }}>
                    <span>{label}{cod.buckets[key].orders > 0 && <span className="note"> · {cod.buckets[key].orders} order{cod.buckets[key].orders === 1 ? "" : "s"}</span>}</span><span className="lead" /><span className="num">PKR {cod.buckets[key].amount.toLocaleString("en-US")}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="note">Cash-on-delivery cash still with riders and couriers, and what pay-later customers have not paid yet once their order is delivered. <Link href="/orders?view=cash">See these orders</Link> and record each payment as it comes in.</p>
          </section>
        )}
        {!storeId && board.stores.length > 1 && (
          <section className="section">
            <h2>By store, today</h2>
            <ul className="ledger" style={{ gap: 0 }}>
              {board.stores.map((s) => (
                <li key={s.storeId} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)", gap: 10, fontSize: "var(--t-sm)" }}>
                  <span className="dot" style={{ background: s.accent }} /><span style={{ flex: 1 }}>{s.name}</span><span className="num">{s.ordersToday} · {pkr(s.salesToday)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Link className="btn quiet" href="/reports"><Icon name="chart" size={18} />Reports</Link>
      </aside>
    </div>
  );
}
