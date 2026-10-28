"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Receipt } from "@/components/receipt";
import { DoneButton, Icon, Journey, Seg, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { pkr, stageLabel } from "@/lib/format";
import { shrinkImage, uploadPhoto } from "@/lib/image";
import { useSession } from "@/lib/session";
import type { Delivery, Invoice, Order, Stage } from "@/lib/types";

const steps = ["Ordered", "Confirmed", "Packed", "On the way", "Delivered"];
const stepOf: Record<Stage, number> = { pending: 0, confirmed: 1, packed: 2, out_for_delivery: 3, delivered: 4, returned: 4, cancelled: 0 };
const next: Partial<Record<Stage, { to: Stage; label: string }>> = {
  pending: { to: "confirmed", label: "Confirm order" },
  confirmed: { to: "packed", label: "Mark packed" },
  packed: { to: "out_for_delivery", label: "Out for delivery" },
  out_for_delivery: { to: "delivered", label: "Mark delivered" },
};
const templates = [["order_confirmed", "Order confirmed"], ["invoice", "Invoice"], ["rider_assigned", "Rider assigned"], ["on_the_way", "On the way"], ["delivered", "Delivered"], ["payment_reminder", "Payment reminder"], ["thank_you", "Thank you"]] as const;
const shipStatuses = [["shipped", "Shipped"], ["delayed", "Delayed"], ["delivered", "Delivered"], ["returned", "Returned"], ["failed", "Failed"]] as const;

type DeliveryState = { delivery: Delivery | null; copyText: string };
type Shipment = { courier: string; trackingNo: string | null; trackingUrl: string | null; shippedOn: string | null; status: string; failureReason: string | null };
const wa = (phone: string | null) => (phone ? `https://wa.me/${phone.replace(/^0/, "92")}` : null);
const orNull = (v: string) => (v.trim() ? v.trim() : null);

export default function OrderPage() {
  const { storeId, orderId } = useParams<{ storeId: string; orderId: string }>();
  const { stores } = useSession();
  const toast = useToast();
  const base = `/stores/${storeId}/orders/${orderId}`;
  const store = stores.find((s) => s.id === storeId);
  const [order, setOrder] = useState<Order | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null | undefined>(undefined);
  const [del, setDel] = useState<DeliveryState | null>(null);
  const [ship, setShip] = useState<Shipment | null>(null);
  const [rider, setRider] = useState({ service: "yango", riderName: "", riderPhone: "", bikeNumber: "", trackingUrl: "" });
  const [parcel, setParcel] = useState({ courier: "", trackingNo: "", trackingUrl: "" });
  const [reason, setReason] = useState("");
  const [cardUrl, setCardUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { order: o } = await api<{ order: Order }>(base);
      setOrder(o);
      api<{ invoice: Invoice }>(`${base}/invoice`).then((r) => setInvoice(r.invoice)).catch(() => setInvoice(null));
      if (o.deliveryKind === "local") {
        const d = await api<DeliveryState>(`${base}/delivery`);
        setDel(d);
        const x = d.delivery;
        if (x) setRider({ service: x.service ?? "yango", riderName: x.riderName ?? "", riderPhone: x.riderPhone ?? "", bikeNumber: x.bikeNumber ?? "", trackingUrl: x.trackingUrl ?? "" });
      }
      if (o.deliveryKind === "courier") {
        const s = await api<{ shipment: Shipment | null }>(`${base}/shipment`);
        setShip(s.shipment);
        if (s.shipment) setParcel({ courier: s.shipment.courier, trackingNo: s.shipment.trackingNo ?? "", trackingUrl: s.shipment.trackingUrl ?? "" });
      }
    } catch (err) {
      setError(messageOf(err));
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  // Runs one action, shows what happened, refreshes. Errors are said in plain words.
  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    try {
      const msg = await fn();
      if (msg) toast(msg);
      await load();
    } catch (err) {
      toast(messageOf(err), "bad");
      throw err;
    } finally {
      setBusy(false);
    }
  }
  const move = (to: Stage) => run(async () => {
    const r = await api<{ stockWarnings?: { name: string; onHand: number }[] }>(`${base}/status`, { method: "POST", body: { status: to } });
    const warn = r.stockWarnings?.length ? ` · below zero: ${r.stockWarnings.map((w) => `${w.name} (${w.onHand})`).join(", ")}` : "";
    return `#${order!.orderNo} is ${stageLabel[to].toLowerCase()}${warn}`;
  });
  const copy = async (text: string) => { await navigator.clipboard.writeText(text); };

  if (!order) return error ? <p className="error" role="alert">{error}</p> : <div className="skel" aria-busy="true"><span /><span /><span /></div>;
  const closed = order.status === "cancelled" || order.status === "returned";
  const step = next[order.status];
  const at = stepOf[order.status];

  return (
    <div className="stack store-scope" style={{ gap: 28, ["--store-base" as string]: store?.accent }}>
      <section className="heading">
        <Link href="/orders" className="note" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}><Icon name="back" size={16} />Orders</Link>
        <div className="inline between">
          <h1>#{order.orderNo} · {order.customerName}</h1>
          {closed && <span className={`badge ${order.status === "cancelled" ? "" : "bad"}`}>{stageLabel[order.status]}</span>}
        </div>
        <p className="note">{[order.customerPhone, order.address, store?.name, order.externalRef ? `Shopify ${order.externalRef}` : null].filter(Boolean).join(" · ")}</p>
        <div className="inline" style={{ marginTop: 6 }}>
          {order.customerPhone && <a className="iconbtn" href={`tel:${order.customerPhone}`} aria-label={`Call ${order.customerName}`}><Icon name="phone" /></a>}
          {order.customerPhone && <a className="iconbtn" href={wa(order.customerPhone)!} target="_blank" rel="noopener" aria-label={`WhatsApp ${order.customerName}`}><Icon name="chat" /></a>}
          {order.address && <a className="iconbtn" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`} target="_blank" rel="noopener" aria-label="Open the address in Maps"><Icon name="pin" /></a>}
        </div>
      </section>

      {order.status !== "cancelled" && <Journey label="Order progress" steps={steps} at={order.status === "delivered" || order.status === "returned" ? 5 : at} />}

      <div className="split">
        <div className="stack" style={{ gap: 28 }}>
          {order.deliveryKind === "local" && !closed && del && (
            <section className="section">
              <header><h2>Rider</h2>{del.delivery?.riderName ? <span className="badge ok">{del.delivery.riderName}{del.delivery.service ? ` · ${del.delivery.service === "indrive" ? "inDrive" : "Yango"}` : ""}</span> : <span className="badge">No rider added</span>}</header>
              <div className="paper pre">{del.copyText}</div>
              <DoneButton className="btn quiet" done="Copied" onClick={async () => { await copy(del.copyText); toast("Copied. Paste it into inDrive or Yango."); }}><Icon name="copy" size={18} />Copy for inDrive / Yango</DoneButton>
              <Seg label="App" value={rider.service} onChange={(v) => setRider({ ...rider, service: v })} options={[["yango", "Yango"], ["indrive", "inDrive"]] as const} />
              <div className="grid2">
                <label className="field"><span>Rider name</span><input className="input" value={rider.riderName} onChange={(e) => setRider({ ...rider, riderName: e.target.value })} /></label>
                <label className="field"><span>Bike number</span><input className="input" value={rider.bikeNumber} onChange={(e) => setRider({ ...rider, bikeNumber: e.target.value })} /></label>
              </div>
              <label className="field"><span>Rider phone</span><input className="input num" inputMode="tel" value={rider.riderPhone} onChange={(e) => setRider({ ...rider, riderPhone: e.target.value })} /></label>
              <div className="photo-row">
                <span className="photo-ic" aria-hidden="true"><Icon name="camera" size={22} /></span>
                <span className="grow"><b>Rider photo</b><br /><span className="note">{del.delivery?.hasPhoto ? "Added. The customer sees it on their card." : "Optional. Take a fresh photo or pick one."}</span></span>
                <label className="btn small quiet" style={{ cursor: "pointer" }}>
                  <input type="file" accept="image/*" className="sr" disabled={busy} onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    await run(async () => { await uploadPhoto(`${base}/delivery/photo`, await shrinkImage(file)); return "Rider photo saved"; }).catch(() => undefined);
                  }} />{del.delivery?.hasPhoto ? "Replace" : "Add"}
                </label>
                {del.delivery?.hasPhoto && <button className="linkbtn" disabled={busy} onClick={() => run(async () => { await api(`${base}/delivery/photo`, { method: "DELETE" }); return "Rider photo removed"; }).catch(() => undefined)}>Remove</button>}
              </div>
              <label className="field"><span>Tracking link (paste from inDrive or Yango, optional)</span><input className="input" inputMode="url" value={rider.trackingUrl} onChange={(e) => setRider({ ...rider, trackingUrl: e.target.value })} placeholder="https://" /></label>
              <DoneButton done="Rider saved" disabled={busy} onClick={() => run(async () => {
                await api(`${base}/delivery`, { method: "PUT", body: { service: rider.service, riderName: orNull(rider.riderName), riderPhone: orNull(rider.riderPhone), bikeNumber: orNull(rider.bikeNumber), trackingUrl: orNull(rider.trackingUrl) } });
              })}>Save rider</DoneButton>
            </section>
          )}

          {order.deliveryKind === "courier" && order.status !== "cancelled" && (
            <section className="section">
              <header><h2>Courier</h2>{ship ? <span className={`badge ${ship.status === "failed" || ship.status === "returned" ? "bad" : ship.status === "delivered" ? "ok" : ""}`}>{ship.status}</span> : <span className="badge warn">Not shipped</span>}</header>
              <div className="grid2">
                <label className="field"><span>Courier</span><input className="input" list="couriers" value={parcel.courier} onChange={(e) => setParcel({ ...parcel, courier: e.target.value })} placeholder="TCS, Leopards…" /></label>
                <label className="field"><span>Tracking number</span><input className="input num" value={parcel.trackingNo} onChange={(e) => setParcel({ ...parcel, trackingNo: e.target.value })} /></label>
              </div>
              <datalist id="couriers"><option value="TCS" /><option value="Leopards" /><option value="M&P" /><option value="Trax" /><option value="Call Courier" /><option value="BlueEx" /></datalist>
              <label className="field"><span>Tracking link (optional)</span><input className="input" value={parcel.trackingUrl} onChange={(e) => setParcel({ ...parcel, trackingUrl: e.target.value })} placeholder="https://" /></label>
              <div className="inline">
                <DoneButton done="Saved" disabled={busy || !parcel.courier.trim()} onClick={() => run(async () => {
                  await api(`${base}/shipment`, { method: "PUT", body: { courier: parcel.courier.trim(), trackingNo: orNull(parcel.trackingNo), trackingUrl: orNull(parcel.trackingUrl) } });
                })}>{ship ? "Save changes" : "Mark shipped"}</DoneButton>
                {ship?.trackingUrl && <a className="btn quiet" href={ship.trackingUrl} target="_blank" rel="noopener"><Icon name="truck" size={18} />Track</a>}
              </div>
              {ship && (
                <div className="stack">
                  <div className="chips" role="group" aria-label="Parcel status">
                    {shipStatuses.filter(([s]) => s !== ship.status).map(([s, label]) => (
                      <button key={s} className="chip" disabled={busy || ((s === "failed" || s === "returned") && !reason.trim())} onClick={() => run(async () => {
                        await api(`${base}/shipment/status`, { method: "POST", body: { status: s, ...(s === "failed" || s === "returned" ? { failureReason: reason.trim() } : {}) } });
                        setReason("");
                        return `Parcel marked ${label.toLowerCase()}`;
                      })}>{label}</button>
                    ))}
                  </div>
                  <label className="field"><span>Reason (needed for failed or returned)</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer not answering" /></label>
                  {ship.failureReason && <p className="note">Last reason: {ship.failureReason}</p>}
                </div>
              )}
            </section>
          )}

          {!closed && (
            <section className="section">
              <header><h2>Tell {order.customerName.split(" ")[0]}</h2></header>
              {cardUrl ? (
                <div className="inline" style={{ padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "var(--r-md)", background: "var(--surface)", flexWrap: "nowrap" }}>
                  <span style={{ color: "var(--store)" }}><Icon name="link" size={18} /></span>
                  <code style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", font: "500 var(--t-sm) var(--font)", color: "var(--ink-2)" }}>{cardUrl.replace(/^https?:\/\//, "")}</code>
                  <DoneButton className="btn small quiet" done="" onClick={async () => { await copy(cardUrl); toast("Delivery card link copied"); }}>Copy</DoneButton>
                </div>
              ) : (
                <button className="btn quiet" disabled={busy} onClick={() => run(async () => { const r = await api<{ url: string }>(`${base}/card`, { method: "POST", body: {} }); setCardUrl(r.url); return "Delivery card link made · works for 7 days"; })}><Icon name="link" size={18} />Make delivery card link</button>
              )}
              <div className="chips">
                {templates.map(([key, label]) => (
                  <button key={key} className="chip" disabled={!order.customerPhone} onClick={async () => {
                    try {
                      const m = await api<{ waLink: string }>(`${base}/whatsapp?template=${key}&link=${encodeURIComponent(cardUrl)}`);
                      window.open(m.waLink, "_blank", "noopener");
                    } catch (err) { toast(messageOf(err), "bad"); }
                  }}><span style={{ color: "var(--ok)" }}><Icon name="chat" size={16} /></span>{label}</button>
                ))}
              </div>
              <p className="note">{order.customerPhone ? "Opens WhatsApp with the message ready to send. Make the card link first for messages that include it." : "Add a phone number to the order to message the customer."}</p>
            </section>
          )}
        </div>

        <aside className="side">
          <section className="section">
            <h2>Receipt</h2>
            <Receipt order={order} store={store} />
            <div className="paper stack" style={{ gap: 6 }}>
              <b>{order.payment === "cod" ? "Cash on delivery" : order.payment === "paid" ? `Paid in advance${order.paymentMethod ? ` · ${order.paymentMethod}` : ""}` : "Pay later"}</b>
              <span>{order.collectAtDoor === 0 ? "Nothing to collect at the door." : order.codAmount > 0 ? <>{order.customerName.split(" ")[0]} hands the rider <b className="num">{pkr(order.collectAtDoor)}</b>.{order.riderFee > 0 && <> The rider keeps {order.riderFee.toLocaleString("en-US")} and brings <b className="num">{order.codAmount.toLocaleString("en-US")}</b> back to you.</>}</> : <>The rider collects only his fee, <b className="num">{pkr(order.riderFee)}</b>.</>}</span>
              {!closed && order.payment === "paid" && (order.paymentConfirmedAt
                ? <span className="inline"><span className="badge ok">Payment received</span><button className="linkbtn" onClick={() => run(async () => { await api(`${base}/payment`, { method: "DELETE" }); return "Payment marked not received"; })}>Undo</button></span>
                : <button className="btn small quiet" disabled={busy} onClick={() => run(async () => { await api(`${base}/payment/confirm`, { method: "POST" }); return "Payment marked received"; })}>I can see the payment</button>)}
              {!closed && order.payment === "cod" && order.deliveryKind === "local" && del?.delivery && (del.delivery.cashHandedOver
                ? <span className="inline"><span className="badge ok">Cash handed over</span><button className="linkbtn" onClick={() => run(async () => { await api(`${base}/payment`, { method: "DELETE" }); return "Handover undone"; })}>Undo</button></span>
                : <button className="btn small quiet" disabled={busy} onClick={() => run(async () => { await api(`${base}/payment/cash-handover`, { method: "POST" }); return "Cash handed over · order settled"; })}><Icon name="cash" size={18} />Rider handed over the cash</button>)}
            </div>
          </section>

          <section className="section">
            <h2>Invoice</h2>
            {invoice === undefined ? <div className="skel"><span /></div> : !invoice ? (
              order.status === "cancelled" ? <p className="note">A cancelled order has no invoice.</p> : <button className="btn quiet" disabled={busy} onClick={() => run(async () => { await api(`${base}/invoice`, { method: "POST" }); return "Invoice draft made"; })}>Make invoice</button>
            ) : (
              <div className="inline">
                <span className="num" style={{ fontWeight: 700, fontSize: "var(--t-lg)", letterSpacing: "0.02em" }}>{invoice.number ?? "Draft"}</span>
                <span className={`stamp${invoice.status === "draft" ? " draft" : ""}`}>{invoice.status === "final" ? "Final" : "Draft"}</span>
                <span className="spacer" />
                {invoice.status === "draft" && <button className="btn small" disabled={busy} onClick={() => run(async () => { const r = await api<{ invoice: Invoice }>(`${base}/invoice/finalise`, { method: "POST" }); return `Invoice ${r.invoice.number} is final`; })}>Finalise</button>}
                <Link className="iconbtn" href={`/orders/${storeId}/${orderId}/invoice`} aria-label="View, print or share the invoice"><Icon name="print" /></Link>
              </div>
            )}
          </section>

          {(order.status === "cancelled" || order.status === "returned") && order.stockApplied && (
            <section className="well">
              <h2>Stock</h2>
              <p className="note">This order took stock out. Put it back only if the items really came back.</p>
              <button className="btn quiet" disabled={busy} onClick={() => run(async () => { await api(`${base}/restore-stock`, { method: "POST" }); return "Stock put back"; })}>Put stock back</button>
            </section>
          )}
        </aside>
      </div>

      {!closed && (
        <div className="dock">
          {order.status !== "delivered" && (
            <button className="btn quiet" disabled={busy} onClick={() => { if (confirm(`Cancel order #${order.orderNo}? Stock that was taken out stays out until you put it back.`)) void move("cancelled").catch(() => undefined); }}>Cancel</button>
          )}
          {step ? <button className="btn grow" disabled={busy} onClick={() => void move(step.to).catch(() => undefined)}>{step.label}</button>
            : order.status === "delivered" ? <button className="btn quiet grow" disabled={busy} onClick={() => { if (confirm("Mark this order as returned?")) void move("returned").catch(() => undefined); }}>Mark returned</button> : null}
        </div>
      )}
    </div>
  );
}
