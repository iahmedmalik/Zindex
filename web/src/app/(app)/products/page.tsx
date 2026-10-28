"use client";

import { useCallback, useEffect, useState } from "react";
import { Count, Icon, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { pkr, when } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { StockRow } from "@/lib/types";

type Move = { id: string; delta: number; reason: string; note: string | null; orderNo: number | null; createdAt: string };

// Products and what is on hand for one store. Stock changes only when an order is confirmed or by
// a counted adjustment here; each change is a line in the history that is never edited.
export default function StockPage() {
  const { stores, storeId, select } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", price: "", cost: "" });
  const [open, setOpen] = useState<string | null>(null);
  const [history, setHistory] = useState<Move[]>([]);
  const [adjust, setAdjust] = useState({ delta: "", note: "" });

  const load = useCallback(async () => {
    if (!storeId) return;
    try { setRows((await api<{ stock: StockRow[] }>(`/stores/${storeId}/stock`)).stock); } catch (e) { toast(messageOf(e), "bad"); }
  }, [storeId, toast]);
  useEffect(() => { setRows(null); setOpen(null); void load(); }, [load]);
  useEffect(() => {
    if (!open || !storeId) return;
    api<{ history: Move[] }>(`/stores/${storeId}/stock/${open}/history`).then((r) => setHistory(r.history)).catch(() => setHistory([]));
  }, [open, storeId, rows]);

  if (!storeId) {
    return (
      <>
        <h1>Stock</h1>
        <div className="empty"><b>Pick a store</b><span>Each store has its own products, prices and stock.</span>
          <div className="inline">{stores.map((s) => <button key={s.id} className="chip" onClick={() => select(s.id)}><span className="dot" style={{ background: s.accent }} />{s.name}</button>)}</div>
        </div>
      </>
    );
  }

  const shown = (rows ?? []).filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const low = (rows ?? []).filter((r) => r.onHand <= 0).length;

  return (
    <>
      <div className="inline between">
        <div className="heading"><h1>Stock</h1>{rows && <p className="note">{rows.length} products{low ? ` · ${low} at or below zero` : ""}</p>}</div>
        <button className="btn" aria-expanded={adding} onClick={() => setAdding((a) => !a)}><Icon name="plus" size={18} />Product</button>
      </div>

      <div className={`expand${adding ? " open" : ""}`}><div>
        <form className="well" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/stores/${storeId}/products`, { method: "POST", body: { name: form.name.trim(), price: Number(form.price), cost: form.cost ? Number(form.cost) : null } });
            setForm({ name: "", price: "", cost: "" });
            toast(`${form.name.trim()} added`);
            await load();
          } catch (err) { toast(messageOf(err), "bad"); }
        }}>
          <label className="field"><span>Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <div className="grid2">
            <label className="field"><span>Price (PKR)</span><input className="input num" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/\D/g, "") })} required /></label>
            <label className="field"><span>Cost (for profit, optional)</span><input className="input num" inputMode="numeric" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value.replace(/\D/g, "") })} /></label>
          </div>
          <button className="btn">Add product</button>
        </form>
      </div></div>

      {(rows?.length ?? 0) > 6 && <input className="input" type="search" placeholder="Find a product" aria-label="Find a product" value={q} onChange={(e) => setQ(e.target.value)} />}

      {!rows ? <div className="skel" aria-busy="true"><span /><span /><span /></div> : rows.length === 0 ? (
        <div className="empty"><b>No products yet</b><span>Add them one by one, or bring them in from Shopify under Settings.</span></div>
      ) : (
        <ul className="rows">
          {shown.map((r, i) => (
            <li key={r.productId} className="arrive" style={{ ["--i" as string]: i }}>
              <button className="row" style={{ width: "100%", border: 0, borderBottom: "1px solid var(--line)", background: "none", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }} aria-expanded={open === r.productId} onClick={() => { setOpen(open === r.productId ? null : r.productId); setAdjust({ delta: "", note: "" }); }}>
                <span className={`stage ${r.onHand <= 0 ? "returned" : "out_for_delivery"}`} aria-hidden="true" />
                <span><span className="ttl">{r.name}</span><br /><span className="meta">{pkr(r.price)} · {r.unitsSold} sold</span></span>
                <span className="end"><b className="num" style={{ fontSize: "var(--t-lg)", color: r.onHand <= 0 ? "var(--bad)" : undefined }}><Count value={r.onHand} /></b><span className="meta">on hand</span></span>
              </button>
              <div className={`expand${open === r.productId ? " open" : ""}`}><div>
                <div className="stack" style={{ padding: "14px 0 18px" }}>
                  <div className="inline">
                    {[-1, 1, 10].map((d) => (
                      <button key={d} className="chip" onClick={async () => {
                        try { await api(`/stores/${storeId}/stock/adjust`, { method: "POST", body: { productId: r.productId, delta: d, note: d > 0 ? "Received" : "Counted" } }); await load(); } catch (e) { toast(messageOf(e), "bad"); }
                      }}>{d > 0 ? `+${d}` : d}</button>
                    ))}
                  </div>
                  <form className="grid2" onSubmit={async (e) => {
                    e.preventDefault();
                    const delta = Number(adjust.delta);
                    if (!delta) return;
                    try { await api(`/stores/${storeId}/stock/adjust`, { method: "POST", body: { productId: r.productId, delta, note: adjust.note.trim() || null } }); setAdjust({ delta: "", note: "" }); toast("Stock updated"); await load(); } catch (err) { toast(messageOf(err), "bad"); }
                  }}>
                    <label className="field"><span>Change by (−5, 24…)</span><input className="input num" inputMode="numeric" value={adjust.delta} onChange={(e) => setAdjust({ ...adjust, delta: e.target.value.replace(/[^\d-]/g, "") })} /></label>
                    <label className="field"><span>Why</span><input className="input" value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} placeholder="Received, damaged…" /></label>
                    <button className="btn quiet" style={{ gridColumn: "1 / -1" }}>Save change</button>
                  </form>
                  <h3>History</h3>
                  {history.length === 0 ? <p className="note">No changes yet.</p> : (
                    <ul className="ledger">
                      {history.slice(0, 12).map((h) => (
                        <li key={h.id} style={{ fontSize: "var(--t-sm)" }}><span>{h.reason === "sale" ? `Order #${h.orderNo}` : h.reason === "restore" ? `Back from #${h.orderNo}` : (h.note ?? "Adjustment")}<span className="note"> · {when(h.createdAt)}</span></span><span className="lead" /><span className="num" style={{ color: h.delta < 0 ? "var(--bad)" : "var(--ok)" }}>{h.delta > 0 ? `+${h.delta}` : h.delta}</span></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div></div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
