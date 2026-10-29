"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Count, Icon, Seg, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { previewTotals } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Customer, DeliveryKind, Order, Payment, Product } from "@/lib/types";

type Line = { key: string; productId?: string; name: string; quantity: number; unitPrice: number; unitCost: number | null };
const methods = ["Cash", "Easypaisa", "JazzCash", "Bank transfer"];
const digits = (v: string) => Number(v.replace(/\D/g, "")) || 0;

// One scrolling page for a WhatsApp order: who, what, how it travels, how it is paid. The total in
// the dock is a preview; the server works out the real numbers on save.
export default function NewOrderPage() {
  const router = useRouter();
  const toast = useToast();
  const { stores, storeId } = useSession();
  const [formStore, setFormStore] = useState(storeId ?? stores[0]?.id ?? "");
  const [products, setProducts] = useState<Product[]>([]);
  const [find, setFind] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [known, setKnown] = useState<Customer[]>([]);
  const [typing, setTyping] = useState<"phone" | "name">("phone"); // which box the matches are for
  const picked = useRef(""); // the customer just tapped, so the matches do not reopen for their own name and number
  const [flash, setFlash] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState(0);
  const [kind, setKind] = useState<DeliveryKind>("local");
  const [riderFee, setRiderFee] = useState("");
  const [flatFee, setFlatFee] = useState("");
  const [payment, setPayment] = useState<Payment>("cod");
  const [method, setMethod] = useState("Easypaisa");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One key per form: a retried save on a weak signal returns the same order, never a second one.
  const key = useRef(typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now()));

  useEffect(() => { if (!formStore && stores[0]) setFormStore(stores[0].id); }, [stores, formStore]);
  useEffect(() => {
    if (!formStore) return;
    api<{ products: Product[] }>(`/stores/${formStore}/products`).then((r) => setProducts(r.products.filter((p) => p.active))).catch((e) => setError(messageOf(e)));
  }, [formStore]);
  useEffect(() => {
    // Matches for whichever box is being typed in: a number (4 digits or more) or a name (2 letters or more).
    const term = typing === "phone" ? (phone.replace(/\D/g, "").length >= 4 ? phone.trim() : "") : (name.trim().length >= 2 ? name.trim() : "");
    if (!term || !formStore || picked.current === `${name}|${phone}`) { setKnown([]); return; }
    const t = setTimeout(() => {
      api<{ customers: Customer[] }>(`/stores/${formStore}/customers?q=${encodeURIComponent(term)}`).then((r) => setKnown(r.customers.slice(0, 4))).catch(() => setKnown([]));
    }, 250);
    return () => clearTimeout(t);
  }, [phone, name, typing, formStore]);

  const shown = useMemo(() => products.filter((p) => p.name.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 16), [products, find]);
  const fee = kind === "local" ? digits(riderFee) : 0;
  const flat = kind === "courier" ? digits(flatFee) : 0;
  const t = previewTotals(lines, discount, flat, fee, payment);
  const door = t.collectAtDoor;
  const qtyOf = (id: string) => lines.find((l) => l.productId === id)?.quantity ?? 0;
  const who = name.trim().length > 1;

  const add = (p: Product) => setLines((ls) => {
    const at = ls.findIndex((l) => l.productId === p.id);
    return at >= 0 ? ls.map((l, i) => (i === at ? { ...l, quantity: l.quantity + 1 } : l)) : [...ls, { key: crypto.randomUUID(), productId: p.id, name: p.name, quantity: 1, unitPrice: p.price, unitCost: p.cost }];
  });
  const change = (k: string, patch: Partial<Line>) => setLines((ls) => ls.flatMap((l) => (l.key !== k ? [l] : patch.quantity === 0 ? [] : [{ ...l, ...patch }])));

  async function create() {
    setBusy(true);
    setError("");
    try {
      const { order } = await api<{ order: Order }>(`/stores/${formStore}/orders`, {
        method: "POST",
        body: {
          customerName: name.trim(),
          customerPhone: phone.trim() || undefined,
          address: address.trim() || null,
          items: lines.map((l) => (l.productId ? { productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost } : { name: l.name.trim() || "Item", quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost })),
          discountPercent: discount,
          deliveryKind: kind,
          riderFee: fee,
          deliveryCharge: flat,
          payment,
          paymentMethod: payment === "paid" ? method : payment === "cod" ? "Cash" : null,
          notes: notes.trim() || null,
          idempotencyKey: key.current,
        },
      });
      toast(`Order #${order.orderNo} created`);
      router.push(`/orders/${formStore}/${order.id}`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  if (stores.length === 0) return <div className="empty"><b>Add a store first</b><span>Orders belong to a store. Add one in Settings.</span></div>;
  const store = stores.find((s) => s.id === formStore);

  return (
    <form className="stack store-scope" style={{ gap: 28, ["--store-base" as string]: store?.accent }} onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <div className="stack">
        <h1>New order</h1>
        {stores.length > 1 && <Seg label="Store" value={formStore} onChange={(v) => { setFormStore(v); setLines([]); }} options={stores.map((s) => [s.id, s.name] as const)} />}
      </div>

      <section className="section">
        <h2>Customer</h2>
        <label className="field"><span>Name</span><input key={`n${flash}`} className={`input${flash ? " flash" : ""}`} value={name} onChange={(e) => { setTyping("name"); setName(e.target.value); }} required autoComplete="off" placeholder="Type a name to find an old customer" /></label>
        <label className="field" style={{ position: "relative" }}>
          <span>WhatsApp number</span>
          <span style={{ position: "absolute", left: 12, top: 35, color: "var(--ink-2)" }}><Icon name="search" /></span>
          <input className="input num" inputMode="tel" value={phone} onChange={(e) => { setTyping("phone"); setPhone(e.target.value); }} placeholder="0300 1234567 (optional)" autoComplete="off" style={{ paddingLeft: 42 }} />
        </label>
        <div className={`expand${known.length ? " open" : ""}`}>
          <div className="stack">
            {known.map((c) => (
              <button type="button" key={c.id} className="row" style={{ border: "1px solid var(--store)", borderRadius: "var(--r-md)", padding: "12px 14px", background: "color-mix(in srgb, var(--store) 7%, var(--surface))", textAlign: "left", cursor: "pointer", gridTemplateColumns: "1fr auto" }}
                onClick={() => { picked.current = `${c.name}|${c.phone ?? ""}`; setName(c.name); setPhone(c.phone ?? ""); setAddress(c.addresses[0] ?? ""); setKnown([]); setFlash((n) => n + 1); }}>
                <span><b>{c.name}</b><br /><span className="meta num">{[c.phone, c.addresses[0] ?? (c.phone ? "No address saved" : null)].filter(Boolean).join(" · ")}</span></span>
                {(c.orderCount ?? 0) > 0 && <span className="badge ok">{c.orderCount} order{c.orderCount === 1 ? "" : "s"} before</span>}
              </button>
            ))}
          </div>
        </div>
        <label className="field"><span>Address</span><textarea key={`a${flash}`} className={`input${flash ? " flash" : ""}`} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
      </section>

      <section className="section">
        <h2>Items</h2>
        {products.length > 8 && <input className="input" type="search" placeholder="Find a product" aria-label="Find a product" value={find} onChange={(e) => setFind(e.target.value)} />}
        <div className="chips" style={{ flexWrap: "wrap", overflow: "visible", margin: 0, padding: "8px 0 0" }}>
          {shown.map((p) => (
            <button type="button" key={p.id} className={`chip${qtyOf(p.id) ? " has" : ""}`} onClick={() => add(p)}>
              {p.name} <span className="price num">{p.price.toLocaleString("en-US")}</span><span className="plus num">{qtyOf(p.id) || ""}</span>
            </button>
          ))}
          <button type="button" className="chip" style={{ borderStyle: "dashed" }} onClick={() => setLines((ls) => [...ls, { key: crypto.randomUUID(), name: "", quantity: 1, unitPrice: 0, unitCost: null }])}><Icon name="plus" size={16} />Typed item</button>
        </div>
        {products.length === 0 && <p className="note">No products in this store yet. Add them under Stock, or type an item.</p>}
        <ul className="rows" aria-live="polite">
          {lines.map((l) => (
            <li key={l.key} className="arrive" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px dotted var(--line)" }}>
              {l.productId ? <span>{l.name}</span> : <input className="input" placeholder="Item name" aria-label="Item name" value={l.name} onChange={(e) => change(l.key, { name: e.target.value })} />}
              <span style={{ display: "inline-grid", gridTemplateColumns: "38px 30px 38px", alignItems: "center", textAlign: "center", border: "1px solid var(--line)", borderRadius: "var(--r-md)", background: "var(--surface)" }}>
                <button type="button" className="iconbtn" style={{ width: 38, height: 38, border: 0 }} aria-label={`One fewer ${l.name}`} onClick={() => change(l.key, { quantity: l.quantity - 1 })}><Icon name="minus" size={16} /></button>
                <b className="num"><Count value={l.quantity} /></b>
                <button type="button" className="iconbtn" style={{ width: 38, height: 38, border: 0 }} aria-label={`One more ${l.name}`} onClick={() => change(l.key, { quantity: l.quantity + 1 })}><Icon name="plus" size={16} /></button>
              </span>
              {/* Both are for one piece. The cost is saved on this line, so a later change to the product's cost never changes it. */}
              <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label className="field"><span>Price per pc{l.productId && products.find((p) => p.id === l.productId)?.price !== l.unitPrice ? " · this order only" : ""}</span><input className="input num" inputMode="numeric" aria-label={`Price of ${l.name || "item"} per pc`} style={{ minHeight: 38, padding: "6px 10px" }} value={l.unitPrice || ""} placeholder="0" onChange={(e) => change(l.key, { unitPrice: digits(e.target.value) })} /></label>
                <label className="field"><span>Cost per pc (optional)</span><input className="input num" inputMode="numeric" aria-label={`Cost of ${l.name || "item"} per pc`} style={{ minHeight: 38, padding: "6px 10px" }} value={l.unitCost ?? ""} placeholder="not set" onChange={(e) => change(l.key, { unitCost: e.target.value.replace(/\D/g, "") === "" ? null : digits(e.target.value) })} /></label>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2>Delivery and payment</h2>
        <Seg label="Delivery" value={kind} onChange={setKind} options={[["local", "Rider"], ["courier", "Courier"], ["pickup", "Pickup"]] as const} />
        <div className={`expand${kind === "local" ? " open" : ""}`}><div><label className="field"><span>Rider fee · the customer pays the rider, not the store</span><input className="input num" inputMode="numeric" placeholder="0" value={riderFee} onChange={(e) => setRiderFee(e.target.value.replace(/\D/g, ""))} /></label></div></div>
        <div className={`expand${kind === "courier" ? " open" : ""}`}><div><label className="field"><span>Delivery fee · part of the store&apos;s total</span><input className="input num" inputMode="numeric" placeholder="0" value={flatFee} onChange={(e) => setFlatFee(e.target.value.replace(/\D/g, ""))} /></label></div></div>
        <div className="field"><span>Discount</span>
          <div className="inline" role="group" aria-label="Discount">
            {[0, 5, 10, 15].map((d) => <button type="button" key={d} className="chip" aria-pressed={discount === d} onClick={() => setDiscount(d)}>{d ? `${d}%` : "None"}</button>)}
            <input className="input num" inputMode="numeric" aria-label="Other discount percent" placeholder="Other %" style={{ width: 96, minHeight: 40 }} value={[0, 5, 10, 15].includes(discount) ? "" : discount} onChange={(e) => setDiscount(Math.min(100, digits(e.target.value)))} />
          </div>
        </div>
        <Seg label="Payment" value={payment} onChange={setPayment} options={[["cod", "COD"], ["paid", "Paid"], ["unpaid", "Later"]] as const} />
        <div className={`expand${payment === "paid" ? " open" : ""}`}><div>
          <div className="inline" role="group" aria-label="Paid with">
            {methods.filter((m) => m !== "Cash").map((m) => <button type="button" key={m} className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>{m}</button>)}
          </div>
        </div></div>
        <label className="field"><span>Note for packing or the rider</span><textarea className="input" rows={2} placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="dock">
        <div className="grow">
          <div className="num" style={{ fontSize: "var(--t-xl)", fontWeight: 700, lineHeight: 1.1 }}>PKR <Count value={t.total} money /></div>
          <div className={`expand${door > 0 ? " open" : ""}`}><div><span className="note num" style={{ fontSize: "var(--t-xs)", fontWeight: 600 }}>
            {t.codAmount > 0 && fee > 0 ? `At the door ${door.toLocaleString("en-US")} · store ${t.codAmount.toLocaleString("en-US")} + rider ${fee.toLocaleString("en-US")}` : t.codAmount > 0 ? `Collect ${t.codAmount.toLocaleString("en-US")} for the store` : `Rider collects only his fee, ${fee.toLocaleString("en-US")}`}
          </span></div></div>
        </div>
        <button className="btn" disabled={busy || lines.length === 0 || !who}>{busy ? "Saving…" : "Create order"}</button>
      </div>
    </form>
  );
}
