"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Dialog, Icon, useConfirm, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Customer } from "@/lib/types";

// Customers of one store, saved automatically from orders. Search by name or any spelling of the phone.
export default function CustomersPage() {
  const { stores, storeId, select } = useSession();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Customer[] | null>(null);
  const [error, setError] = useState("");
  const toast = useToast();
  const confirmCard = useConfirm();
  const [editing, setEditing] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", addresses: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(() => {
    if (!storeId) return Promise.resolve();
    return api<{ customers: Customer[] }>(`/stores/${storeId}/customers?q=${encodeURIComponent(q)}`).then((r) => { setList(r.customers); setError(""); }).catch((e) => setError(messageOf(e)));
  }, [storeId, q]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 200);
    return () => clearTimeout(t);
  }, [load]);

  function edit(c: Customer) {
    setEditing(c);
    setForm({ name: c.name, phone: c.phone ?? "", addresses: c.addresses.join("\n"), notes: c.notes ?? "" });
    setFormError("");
    setOpen(true);
  }
  async function save() {
    if (!editing) return;
    setBusy(true);
    setFormError("");
    try {
      await api(`/stores/${storeId}/customers/${editing.id}`, {
        method: "PATCH",
        body: {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          addresses: form.addresses.split("\n").map((a) => a.trim()).filter(Boolean),
          notes: form.notes.trim() || null,
        },
      });
      setOpen(false);
      toast(`${form.name.trim()} saved`);
      await load();
    } catch (err) {
      setFormError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!editing) return;
    const { ok } = await confirmCard({
      title: `Delete ${editing.name}?`,
      body: <p>They leave your customer list. Their past orders keep the name and number written on them.</p>,
      confirm: "Delete customer",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/stores/${storeId}/customers/${editing.id}`, { method: "DELETE" });
      setOpen(false);
      toast(`${editing.name} deleted`);
      await load();
    } catch (err) {
      setFormError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!storeId) {
    return (
      <>
        <h1>Customers</h1>
        <div className="empty"><b>Pick a store</b><span>Each store keeps its own customers, even when the same person buys from two.</span>
          <div className="inline">{stores.map((s) => <button key={s.id} className="chip" onClick={() => select(s.id)}><span className="dot" style={{ background: s.accent }} />{s.name}</button>)}</div>
        </div>
      </>
    );
  }
  return (
    <>
      <h1>Customers</h1>
      <input className="input" type="search" placeholder="Name or phone" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p className="error" role="alert">{error}</p>}
      {!list ? <div className="skel" aria-busy="true"><span /><span /><span /></div> : list.length === 0 ? (
        <div className="empty"><b>{q ? "Nobody matches" : "No customers yet"}</b><span>Customers are saved when you create an order, with their name or number.</span></div>
      ) : (
        <ul className="rows">
          {list.map((c, i) => (
            <li key={c.id} className="row arrive" style={{ ["--i" as string]: i }}>
              <span className="dot" style={{ background: (c.orderCount ?? 0) > 1 ? "var(--ok)" : "var(--line)" }} aria-hidden="true" />
              <span><span className="ttl">{c.name}</span><br /><span className="meta num">{[c.phone ?? "No number", c.addresses[0]].filter(Boolean).join(" · ")}{c.addresses.length > 1 ? ` (+${c.addresses.length - 1})` : ""}</span></span>
              <span className="end">
                {(c.orderCount ?? 0) > 1 ? <span className="badge ok">Repeat · {c.orderCount}</span> : <span className="meta">{c.orderCount ?? 0} order{c.orderCount === 1 ? "" : "s"}</span>}
                <span className="inline" style={{ gap: 6 }}>
                  <button type="button" className="iconbtn" style={{ width: 38, height: 38 }} aria-label={`Edit ${c.name}`} onClick={() => edit(c)}><Icon name="edit" size={18} /></button>
                  {c.phone && <a className="iconbtn" style={{ width: 38, height: 38 }} href={`https://wa.me/${c.phone.replace(/^0/, "92")}`} target="_blank" rel="noopener" aria-label={`WhatsApp ${c.name}`}><Icon name="chat" size={18} /></a>}
                  <Link className="iconbtn" style={{ width: 38, height: 38 }} href={`/orders?q=${encodeURIComponent(c.phone ?? c.name)}`} aria-label={`Orders from ${c.name}`}><Icon name="orders" size={18} /></Link>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} label="Edit customer">
        <h2>Edit customer</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="field"><span>Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="off" data-first /></label>
          <label className="field"><span>WhatsApp number</span><input className="input num" inputMode="tel" placeholder="Leave empty if there is none" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="off" /></label>
          <label className="field"><span>Addresses · one per line</span><textarea className="input" rows={3} value={form.addresses} onChange={(e) => setForm({ ...form, addresses: e.target.value })} /></label>
          <label className="field"><span>Notes</span><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          {formError && <p className="error" role="alert">{formError}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn quiet" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn" disabled={busy || form.name.trim().length === 0}>{busy ? "Saving…" : "Save"}</button>
          </div>
          <button type="button" className="linkbtn" style={{ justifySelf: "center", color: "var(--bad)" }} disabled={busy} onClick={() => void remove()}>Delete customer</button>
        </form>
      </Dialog>
    </>
  );
}
