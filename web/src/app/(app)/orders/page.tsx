"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Picker } from "@/components/Picker";
import { Icon, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { pkr, stageLabel, stageName, when } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Order, Stage } from "@/lib/types";

// "Out for delivery" and "Ready for pickup" (and "Delivered" and "Picked up") are the same stored status; the filter tells
// them apart by whether the order is a pickup.
type Filter = Stage | "ready_for_pickup" | "picked_up" | "";
const filters: Filter[] = ["", "pending", "confirmed", "packed", "out_for_delivery", "ready_for_pickup", "delivered", "picked_up", "returned", "cancelled"];
const filterLabel = (f: Filter) => (f === "" ? "All" : f === "ready_for_pickup" ? "Ready for pickup" : f === "picked_up" ? "Picked up" : stageLabel[f]);
const stageOptions = filters.map((f) => ({ value: f, label: filterLabel(f) }));
const query = (f: Filter): [string, string | null] =>
  f === "ready_for_pickup" ? ["out_for_delivery", "1"] : f === "picked_up" ? ["delivered", "1"] : f === "out_for_delivery" || f === "delivered" ? [f, "0"] : [f, null];
// The views the Today tiles open. They combine with the stage and payment dropdowns.
const views = { needs_rider: "Needs a rider", cash: "Cash to collect", delivered_today: "Delivered today" } as const;
type View = keyof typeof views | "";
const bucketOptions = [{ value: "", label: "Everyone" }, { value: "riders", label: "With riders" }, { value: "customers", label: "From customers" }, { value: "couriers", label: "From couriers" }];
const bucketOf = (o: Order) => (o.payment === "unpaid" ? "From the customer" : o.deliveryKind === "courier" ? "With the courier" : o.deliveryKind === "local" ? "With the rider" : "From the customer");
const delivered = (iso: string | null) => {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "delivered today" : days === 1 ? "delivered yesterday" : `delivered ${days} days ago`;
};
const payOptions = [{ value: "", label: "Any" }, { value: "cod", label: "COD" }, { value: "paid", label: "Paid" }, { value: "unpaid", label: "Pay later" }];

// Every order for the chosen store (or all stores), searchable by customer, phone or #number.
export default function OrdersPage() {
  const { stores, storeId } = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Filter>("");
  const [payment, setPayment] = useState("");
  const [view, setView] = useState<View>("");
  const [bucket, setBucket] = useState("");
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const toast = useToast();
  const [orders, setOrders] = useState<(Order & { storeName: string })[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("status");
    if (fromUrl && (filters as string[]).includes(fromUrl)) setStatus(fromUrl as Filter);
    const v = params.get("view");
    if (v && v in views) setView(v as View);
    const bk = params.get("bucket");
    if (bk && bucketOptions.some((b) => b.value === bk)) setBucket(bk);
    if (params.get("q")) setQ(params.get("q")!);
  }, []);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const targets = storeId ? stores.filter((s) => s.id === storeId) : stores;
        const qs = new URLSearchParams();
        if (q.trim()) qs.set("q", q.trim());
        const [st, pk] = query(status);
        if (st) qs.set("status", st);
        if (pk) qs.set("pickup", pk);
        if (payment) qs.set("payment", payment);
        if (view) qs.set("view", view);
        if (view === "cash" && bucket) qs.set("bucket", bucket);
        const lists = await Promise.all(targets.map(async (s) => (await api<{ orders: Order[] }>(`/stores/${s.id}/orders?${qs}`)).orders.map((o) => ({ ...o, storeName: s.name }))));
        if (live) { setOrders(lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt))); setError(""); }
      } catch (err) {
        if (live) setError(messageOf(err));
      }
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, status, payment, view, bucket, tick, storeId, stores]);

  // One tap records what is left on the order: the COD cash handed over, or the pay-later customer's payment.
  async function received(o: Order) {
    try {
      if (o.payment === "cod") await api(`/stores/${o.storeId}/orders/${o.id}/payment/cash-handover`, { method: "POST", body: {} });
      else await api(`/stores/${o.storeId}/orders/${o.id}/payments`, { method: "POST", body: { amount: o.expected - o.paid } });
      toast(`#${o.orderNo} ${o.payment === "cod" ? "cash" : "payment"} received`);
      setTick((n) => n + 1);
    } catch (err) {
      toast(messageOf(err), "bad");
    }
  }
  // The shop's own payment reminder message, with what is still to pay filled in, opened in WhatsApp.
  async function remind(o: Order) {
    try {
      const m = await api<{ waLink: string }>(`/stores/${o.storeId}/orders/${o.id}/whatsapp?template=payment_reminder`);
      window.open(m.waLink, "_blank", "noopener");
    } catch (err) {
      toast(messageOf(err), "bad");
    }
  }

  return (
    <>
      <div className="inline between">
        <h1>Orders</h1>
      </div>
      <div className="stack">
        <label className="field" style={{ position: "relative" }}>
          <span className="sr">Search orders</span>
          <span style={{ position: "absolute", left: 12, top: 13, color: "var(--ink-2)" }}><Icon name="search" /></span>
          <input className="input" type="search" placeholder="Name, phone or #number" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 42 }} />
        </label>
        {view && (
          <div className="inline">
            <button className="chip" aria-pressed="true" onClick={() => setView("")} aria-label={`${views[view]}: show all orders again`}>{views[view]}<Icon name="x" size={16} /></button>
          </div>
        )}
        <div className="pickers">
          <Picker label="Stage" value={status} options={stageOptions} onChange={setStatus} />
          <Picker label="Payment" value={payment} options={payOptions} onChange={setPayment} />
        </div>
        {view === "cash" && <div className="pickers"><Picker label="From" value={bucket} options={bucketOptions} onChange={setBucket} /></div>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!orders ? <div className="skel" aria-busy="true"><span /><span /><span /></div> : orders.length === 0 ? (
        <div className="empty"><b>No orders match</b><span>Try another stage or clear the search.</span></div>
      ) : (
        <ul className="rows">
          {orders.map((o, i) => (
            <li key={o.id} className="arrive" style={{ ["--i" as string]: i }}>
              {view === "cash" ? (
                <Link className="row" href={`/orders/${o.storeId}/${o.id}`} style={{ gridTemplateColumns: "auto 1fr", alignItems: "start" }}>
                  <span className={`stage ${o.status}`} aria-hidden="true" style={{ marginTop: 8 }} />
                  <span className="stack" style={{ gap: 6 }}>
                    <span className="inline between" style={{ gap: 10, flexWrap: "nowrap" }}>
                      <span className="ttl">#{o.orderNo} {o.customerName}</span>
                      <span className="amt num">{pkr(o.expected - o.paid)}</span>
                    </span>
                    <span className="meta">{!storeId && `${o.storeName} · `}{bucketOf(o).toLowerCase()} · {delivered(o.deliveredAt) || when(o.createdAt)}</span>
                    <span className="inline" style={{ gap: 14, flexWrap: "wrap" }}>
                      <button className="btn small quiet" onClick={(e) => { e.preventDefault(); void received(o); }}>{o.payment === "cod" ? "Got the cash" : "Got the payment"}</button>
                      <button className="linkbtn" onClick={(e) => { e.preventDefault(); router.push(`/orders/${o.storeId}/${o.id}#payments`); }}>Add payment</button>
                      {o.payment === "unpaid" && o.customerPhone && <button className="linkbtn" onClick={(e) => { e.preventDefault(); void remind(o); }}>Remind</button>}
                    </span>
                  </span>
                </Link>
              ) : (
              <Link className="row" href={`/orders/${o.storeId}/${o.id}`}>
                <span className={`stage ${o.status}`} aria-hidden="true" />
                <span>
                  <span className="ttl">#{o.orderNo} {o.customerName}</span><br />
                  <span className="meta">{!storeId && `${o.storeName} · `}{when(o.createdAt)}{o.externalRef ? ` · Shopify ${o.externalRef}` : ""}</span>
                </span>
                <span className="end">
                  <span className="amt num">{pkr(o.total)}</span>
                  <span className="badge">{stageName(o.status, o.deliveryKind)}</span>
                </span>
              </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
