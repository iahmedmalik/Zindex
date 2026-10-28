"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Picker } from "@/components/Picker";
import { Icon, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { pkr, stageLabel, when } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Order, Stage } from "@/lib/types";

const filters: (Stage | "")[] = ["", "pending", "confirmed", "packed", "out_for_delivery", "delivered", "returned", "cancelled"];
const stageOptions = filters.map((f) => ({ value: f, label: f ? stageLabel[f] : "All" }));
// The views the Today tiles open. They combine with the stage and payment dropdowns.
const views = { needs_rider: "Needs a rider", cash: "Cash to collect", delivered_today: "Delivered today" } as const;
type View = keyof typeof views | "";
const payOptions = [{ value: "", label: "Any" }, { value: "cod", label: "COD" }, { value: "paid", label: "Paid" }, { value: "unpaid", label: "Pay later" }];

// Every order for the chosen store (or all stores), searchable by customer, phone or #number.
export default function OrdersPage() {
  const { stores, storeId } = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Stage | "">("");
  const [payment, setPayment] = useState("");
  const [view, setView] = useState<View>("");
  const [tick, setTick] = useState(0);
  const toast = useToast();
  const [orders, setOrders] = useState<(Order & { storeName: string })[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("status");
    if (fromUrl && (filters as string[]).includes(fromUrl)) setStatus(fromUrl as Stage);
    const v = params.get("view");
    if (v && v in views) setView(v as View);
    if (params.get("q")) setQ(params.get("q")!);
  }, []);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const targets = storeId ? stores.filter((s) => s.id === storeId) : stores;
        const qs = new URLSearchParams();
        if (q.trim()) qs.set("q", q.trim());
        if (status) qs.set("status", status);
        if (payment) qs.set("payment", payment);
        if (view) qs.set("view", view);
        const lists = await Promise.all(targets.map(async (s) => (await api<{ orders: Order[] }>(`/stores/${s.id}/orders?${qs}`)).orders.map((o) => ({ ...o, storeName: s.name }))));
        if (live) { setOrders(lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt))); setError(""); }
      } catch (err) {
        if (live) setError(messageOf(err));
      }
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, status, payment, view, tick, storeId, stores]);

  async function received(o: Order) {
    try {
      await api(`/stores/${o.storeId}/orders/${o.id}/payment/cash-handover`, { method: "POST", body: {} });
      toast(`#${o.orderNo} cash received`);
      setTick((n) => n + 1);
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
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!orders ? <div className="skel" aria-busy="true"><span /><span /><span /></div> : orders.length === 0 ? (
        <div className="empty"><b>No orders match</b><span>Try another stage or clear the search.</span></div>
      ) : (
        <ul className="rows">
          {orders.map((o, i) => (
            <li key={o.id} className="arrive" style={{ ["--i" as string]: i }}>
              <Link className="row" href={`/orders/${o.storeId}/${o.id}`}>
                <span className={`stage ${o.status}`} aria-hidden="true" />
                <span><span className="ttl">#{o.orderNo} {o.customerName}</span><br /><span className="meta">{!storeId && `${o.storeName} · `}{view === "cash" ? `${o.deliveryKind === "courier" ? "courier" : o.deliveryKind === "pickup" ? "pickup" : "rider"} · ` : ""}{when(o.createdAt)}{o.externalRef ? ` · Shopify ${o.externalRef}` : ""}</span></span>
                <span className="end">
                  <span className="amt num">{pkr(view === "cash" ? o.codAmount : o.total)}</span>
                  {view === "cash"
                    ? <button className="btn small quiet" onClick={(e) => { e.preventDefault(); void received(o); }}>Got the cash</button>
                    : <span className="badge">{stageLabel[o.status]}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
