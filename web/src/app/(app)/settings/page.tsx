"use client";

import { useEffect, useRef, useState } from "react";
import { DoneButton, Icon, Seg, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { accents, load as loadLook, save as saveLook, type Accent, type Appearance } from "@/lib/appearance";
import { shrinkPicture, uploadPhoto } from "@/lib/image";
import { useSession } from "@/lib/session";
import type { Store } from "@/lib/types";

type Template = { key: string; body: string; edited: boolean };
type ShopifyState = { domain: string | null; connected: boolean; mode?: "keys" | "public" | null; lastSync: string | null };
type ImportResult = { imported: { ref: string; orderNo: number }[]; alreadyImported: string[]; skipped: { ref: string; reason: string }[]; warnings: { ref: string; reason: string }[] };
// The first colour is what a new store starts with: the app's own maroon, the same as the database default.
const storeColours = ["#5d1b23", "#8a3b12", "#1f3a5f", "#24523b", "#6b3a8a", "#2b2b2b"];
const templateNames: Record<string, string> = { order_confirmed: "Order confirmed", invoice: "Invoice", rider_assigned: "Rider assigned", on_the_way: "On the way", delivered: "Delivered", payment_reminder: "Payment reminder", thank_you: "Thank you", ready_for_pickup: "Ready for pickup" };

/** Logo or watermark: a small picture per store, shrunk here first, shown on the invoice, receipt and the customer's card. */
function PictureRow({ store, kind, onSaved }: { store: Store; kind: "logo" | "watermark"; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const url = kind === "logo" ? store.logoUrl : store.watermarkUrl;
  const words = kind === "logo"
    ? { title: "Logo", has: "Shown on the invoice, the receipt and the customer's card.", none: "Optional. A square picture on a plain background works best." }
    : { title: "Watermark", has: store.watermarkOn ? "Shown faint behind the invoice." : "Saved, but switched off.", none: "Optional. A faint picture behind the invoice, such as your logo or a pattern." };
  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await fn(); await onSaved(); toast(done); } catch (err) { toast(messageOf(err), "bad"); } finally { setBusy(false); }
  }
  return (
    <div className="photo-row">
      <span className="photo-ic" aria-hidden="true" style={{ overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <Icon name="camera" size={22} />}
      </span>
      <span className="grow"><b>{words.title}</b><br /><span className="note">{url ? words.has : words.none}</span></span>
      <span className="inline" style={{ gap: 12 }}>
      <label className="btn small quiet" style={{ cursor: "pointer" }}>
        <input type="file" accept="image/*" className="sr" aria-label={`${url ? "Replace" : "Add"} ${words.title.toLowerCase()}`} disabled={busy} onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          await run(async () => { await uploadPhoto(`/stores/${store.id}/images/${kind}`, await shrinkPicture(file, kind === "logo" ? 512 : 1000)); }, `${words.title} saved`);
        }} />{url ? "Replace" : "Add"}
      </label>
      {url && <button type="button" className="linkbtn" disabled={busy} onClick={() => run(() => api(`/stores/${store.id}/images/${kind}`, { method: "DELETE" }), `${words.title} removed`)}>Remove</button>}
      </span>
      {kind === "watermark" && url && (
        <label className="inline" style={{ gap: 8, flexBasis: "100%" }}>
          <input type="checkbox" checked={store.watermarkOn} disabled={busy} onChange={(e) => run(() => api(`/stores/${store.id}`, { method: "PATCH", body: { watermarkOn: e.target.checked } }), e.target.checked ? "Watermark on" : "Watermark off")} />
          <span>Show the watermark on invoices</span>
        </label>
      )}
    </div>
  );
}

function StoreEditor({ store, onSaved, onPicture }: { store?: Store; onSaved: () => Promise<void>; onPicture?: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ name: store?.name ?? "", invoicePrefix: store?.invoicePrefix ?? "", phone: store?.phone ?? "", email: store?.email ?? "", address: store?.address ?? "", accent: store?.accent ?? storeColours[0]! });
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      // Editing: an emptied field is sent as null so the API clears it. Creating: it is simply left out.
      const empty = store ? null : undefined;
      const body = { name: f.name.trim(), invoicePrefix: f.invoicePrefix || undefined, phone: f.phone.trim() || empty, email: f.email.trim() || empty, address: f.address.trim() || empty, accent: f.accent };
      try {
        await api(store ? `/stores/${store.id}` : "/stores", { method: store ? "PATCH" : "POST", body });
        toast(store ? "Store saved" : `${body.name} added`);
        if (!store) setF({ name: "", invoicePrefix: "", phone: "", email: "", address: "", accent: storeColours[0]! });
        await onSaved();
      } catch (err) { toast(messageOf(err), "bad"); }
    }}>
      <div className="grid2">
        <label className="field"><span>Store name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label className="field"><span>Invoice letters</span><input className="input" value={f.invoicePrefix} placeholder="SF" onChange={(e) => setF({ ...f, invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) })} /></label>
      </div>
      <div className="grid2">
        <label className="field"><span>Store phone (WhatsApp)</span><input className="input num" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="field"><span>Store email</span><input className="input" type="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="hello@yourshop.pk" /></label>
      </div>
      <label className="field"><span>Address (optional, used as the pickup address and shown on receipts)</span><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
      <p className="note">The email, phone and address are shown on this store&apos;s receipts, invoices and delivery cards.</p>
      <div className="field"><span>Colour on its invoices and delivery cards</span>
        <div className="inline" role="radiogroup" aria-label="Store colour">
          {storeColours.map((c) => <button type="button" key={c} role="radio" aria-checked={f.accent === c} aria-label={c} onClick={() => setF({ ...f, accent: c })} style={{ width: 44, height: 44, borderRadius: 12, background: c, border: 0, cursor: "pointer", boxShadow: f.accent === c ? "0 0 0 3px var(--paper), 0 0 0 5px var(--ink)" : "none", transition: "box-shadow var(--t-base) var(--ease)" }} />)}
        </div>
      </div>
      {store && <PictureRow store={store} kind="logo" onSaved={onPicture ?? onSaved} />}
      {store && <PictureRow store={store} kind="watermark" onSaved={onPicture ?? onSaved} />}
      <button className="btn" style={{ justifySelf: "start" }}>{store ? "Save store" : "Add store"}</button>
    </form>
  );
}

export default function SettingsPage() {
  const { stores, store, storeId, select, reload } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [look, setLook] = useState<Appearance | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [shop, setShop] = useState<ShopifyState | null>(null);
  const [domain, setDomain] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => setLook(loadLook()), []);
  useEffect(() => {
    if (!storeId) { setTemplates([]); setShop(null); return; }
    api<{ templates: Template[] }>(`/stores/${storeId}/templates`).then((r) => { setTemplates(r.templates); setDrafts({}); }).catch(() => setTemplates([]));
    api<ShopifyState>(`/stores/${storeId}/shopify`).then((r) => { setShop(r); setDomain(r.domain ?? ""); }).catch(() => setShop(null));
    setImported(null);
  }, [storeId]);

  const setL = (patch: Partial<Appearance>) => { const next = { ...look!, ...patch }; setLook(next); saveLook(next); };

  return (
    <div className="stack" style={{ gap: 36 }}>
      <h1>Settings</h1>

      <section className="section">
        <header><h2>Stores</h2></header>
        <ul className="rows">
          {stores.map((s) => (
            <li key={s.id}>
              <div className="row" style={{ gridTemplateColumns: "auto 1fr auto" }}>
                <span className="dot" style={{ background: s.accent, width: 14, height: 14 }} />
                <span><span className="ttl">{s.name}</span><br /><span className="meta num">{s.invoicePrefix}-0001 · {s.phone ?? "no WhatsApp number"}</span></span>
                <button className="btn small quiet" aria-expanded={editing === s.id} onClick={() => setEditing(editing === s.id ? null : s.id)}>{editing === s.id ? "Close" : "Edit"}</button>
              </div>
              <div className={`expand${editing === s.id ? " open" : ""}`}><div style={{ padding: "8px 0 20px" }}>{editing === s.id && <StoreEditor store={s} onSaved={async () => { await reload(); setEditing(null); }} onPicture={reload} />}</div></div>
            </li>
          ))}
        </ul>
        <details className="well">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Add a store</summary>
          <div style={{ paddingTop: 14 }}><StoreEditor onSaved={reload} /></div>
        </details>
      </section>

      <section className="section" id="shopify">
        <header><h2>Shopify{store ? ` · ${store.name}` : ""}</h2></header>
        {!storeId ? (
          <div className="empty"><b>Pick a store</b><span>Shopify is set up per store.</span><div className="inline">{stores.map((s) => <button key={s.id} className="chip" onClick={() => select(s.id)}><span className="dot" style={{ background: s.accent }} />{s.name}</button>)}</div></div>
        ) : (
          <>
            <div className="well">
              <h3>Bring in website orders</h3>
              <p className="note">In Shopify: Orders → Export → CSV for Excel. Choose the file here. Each new order arrives as pending with a draft invoice; orders already brought in are skipped, so the same file is safe to use twice. Stock does not move until you confirm an order.</p>
              <input ref={file} type="file" accept=".csv,text/csv" className="sr" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const res = await fetch(`/backend/v1/stores/${storeId}/import/shopify-orders`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: await f.text(), credentials: "same-origin" });
                  const body = await res.json();
                  if (!res.ok) throw new Error(body.error ?? "The file could not be imported.");
                  setImported(body);
                  toast(`${body.imported.length} order${body.imported.length === 1 ? "" : "s"} brought in`);
                } catch (err) { toast(messageOf(err), "bad"); } finally { e.target.value = ""; }
              }} />
              <button className="btn quiet" style={{ justifySelf: "start" }} onClick={() => file.current?.click()}><Icon name="upload" size={18} />Choose the orders file</button>
              <div className={`expand${imported ? " open" : ""}`}><div>{imported && (
                <ul className="ledger" style={{ fontSize: "var(--t-sm)" }}>
                  <li><span>New orders</span><span className="lead" /><span className="num">{imported.imported.length}</span></li>
                  <li><span>Already brought in</span><span className="lead" /><span className="num">{imported.alreadyImported.length}</span></li>
                  <li><span>Skipped (cancelled, refunded)</span><span className="lead" /><span className="num">{imported.skipped.length}</span></li>
                  {imported.warnings.map((w) => <li key={w.ref} className="aside"><span style={{ color: "var(--warn)" }}>{w.ref}: {w.reason}</span></li>)}
                </ul>
              )}</div></div>
            </div>
            <div className="well">
              <h3>Products from Shopify</h3>
              <p className="note">Brings in names, prices and pictures. Your stock counts stay as they are. Type your shop's web address, like sheenperfumes.com.</p>
              <div className="inline" style={{ flexWrap: "nowrap" }}>
                <input className="input" style={{ flex: 1 }} placeholder="sheenperfumes.com" aria-label="Shopify address" value={domain} onChange={(e) => setDomain(e.target.value)} />
                <DoneButton className="btn quiet" done="Saved" onClick={async () => {
                  try { const r = await api<{ domain: string | null; connected: boolean; mode: "keys" | "public" | null }>(`/stores/${storeId}/shopify`, { method: "PUT", body: { domain: domain.trim() || null } }); setShop((s) => ({ lastSync: s?.lastSync ?? null, ...r })); setDomain(r.domain ?? ""); } catch (err) { toast(messageOf(err), "bad"); throw err; }
                }}>Save</DoneButton>
              </div>
              {shop?.domain && (
                <div className="inline">
                  <span className={`badge ${shop.connected ? "ok" : "warn"}`}>{shop.connected ? "Connected" : "Not connected"}</span>
                  <span className="note">Found your shop at {shop.domain}.{shop.mode === "public" ? " Reads your public product list: draft and archived products are not included." : ""}</span>
                  {shop.lastSync && <span className="note">Last sync {new Date(shop.lastSync).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                  <button className="btn small" disabled={!shop.connected || syncing} onClick={async () => {
                    setSyncing(true);
                    try { const r = await api<{ added: number; updated: number; linked: number }>(`/stores/${storeId}/shopify/sync`, { method: "POST" }); toast(`${r.added} added · ${r.updated + r.linked} updated`); setShop({ ...shop, lastSync: new Date().toISOString() }); } catch (err) { toast(messageOf(err), "bad"); } finally { setSyncing(false); }
                  }}>{syncing ? "Syncing…" : "Sync now"}</button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {storeId && templates.length > 0 && (
        <section className="section">
          <header><h2>WhatsApp messages · {store?.name}</h2></header>
          <p className="note">Fill-in fields: {"{name} {order_no} {store} {total} {collect} {amount_due} {invoice_no} {rider_name} {rider_phone} {bike} {link}"}</p>
          {templates.map((t) => (
            <div key={t.key} className="stack">
              <label className="field"><span>{templateNames[t.key] ?? t.key}{t.edited ? " · your wording" : ""}</span>
                <textarea className="input" rows={3} value={drafts[t.key] ?? t.body} onChange={(e) => setDrafts({ ...drafts, [t.key]: e.target.value })} />
              </label>
              <div className={`expand${drafts[t.key] !== undefined || t.edited ? " open" : ""}`}><div className="inline">
                {drafts[t.key] !== undefined && <DoneButton className="btn small" done="Saved" onClick={async () => {
                  try {
                    await api(`/stores/${storeId}/templates/${t.key}`, { method: "PUT", body: { body: drafts[t.key] } });
                    setTemplates((ts) => ts.map((x) => (x.key === t.key ? { ...x, body: drafts[t.key]!, edited: true } : x)));
                    setDrafts(({ [t.key]: _drop, ...rest }) => rest);
                  } catch (err) { toast(messageOf(err), "bad"); throw err; }
                }}>Save</DoneButton>}
                {t.edited && <button className="btn small quiet" onClick={async () => {
                  const r = await api<{ template: Template }>(`/stores/${storeId}/templates/${t.key}`, { method: "DELETE" });
                  setTemplates((ts) => ts.map((x) => (x.key === t.key ? r.template : x)));
                  setDrafts(({ [t.key]: _drop, ...rest }) => rest);
                  toast("Back to the default wording");
                }}>Use default</button>}
              </div></div>
            </div>
          ))}
        </section>
      )}

      {look && (
        <section className="section">
          <header><h2>Look</h2></header>
          <p className="note">On this phone or computer only. Store colours on invoices and cards do not change.</p>
          <Seg label="Light or dark" value={look.mode} onChange={(mode) => setL({ mode })} options={[["light", "Light"], ["dark", "Dark"], ["system", "Phone setting"]] as const} />
          <div className="field"><span>Accent</span>
            <div className="inline" role="radiogroup" aria-label="Accent">
              {(Object.keys(accents) as Accent[]).map((a) => (
                <button key={a} type="button" role="radio" aria-checked={look.accent === a} className="chip" onClick={() => setL({ accent: a })}><span className="dot" style={{ background: accents[a].light }} />{accents[a].name}</button>
              ))}
            </div>
          </div>
          <Seg label="Motion" value={look.motion} onChange={(motion) => setL({ motion })} options={[["full", "Full"], ["reduced", "Less"], ["system", "Phone setting"]] as const} />
        </section>
      )}

      <section className="section">
        <header><h2>Backup</h2></header>
        <p className="note">One file with every store, product, customer, order, invoice and stock change. Keep it somewhere safe.</p>
        <a className="btn quiet" style={{ justifySelf: "start" }} href="/backend/v1/backup" download><Icon name="download" size={18} />Download backup</a>
      </section>
    </div>
  );
}
