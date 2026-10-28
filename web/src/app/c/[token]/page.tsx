import type { Metadata } from "next";
import { RouteMap } from "@/components/graphics";

// The public delivery card. A customer opens it from a WhatsApp link, without an account. It carries
// the STORE's colour, not Zindex's, and asks the API for exactly what the card shows. Never cached or indexed.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your delivery", robots: { index: false, follow: false } };

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
const fmt = (n: number) => n.toLocaleString("en-US");

type Card = {
  store: { name: string; phone: string | null; email: string | null; address: string | null; logoUrl: string | null; accent: string };
  order: { orderNo: number; status: string; customerName: string; address: string | null; payment: string; items: { name: string; quantity: number }[]; subtotal: number; discount: number; deliveryCharge: number; total: number; riderFee: number; codAmount: number; collectAtDoor: number };
  delivery: { service: string | null; riderName: string | null; riderPhone: string | null; bikeNumber: string | null; riderPhotoUrl: string | null; hasPhoto: boolean; riderPhotoTakenAt: string | null; trackingUrl: string | null; riderScreenshotUrl: string | null } | null;
  expiresAt: string;
};

// The card follows the ORDER's status, the one the shop moves with its main button; a rider is optional extra detail.
const steps = ["pending", "confirmed", "packed", "out_for_delivery", "delivered"];
const label: Record<string, string> = { pending: "Ordered", confirmed: "Confirmed", packed: "Packed", out_for_delivery: "On the way", delivered: "Delivered" };
const headline: Record<string, string> = { pending: "We got your order", confirmed: "Your order is confirmed", packed: "Your order is packed", out_for_delivery: "On its way to you", delivered: "Delivered. Enjoy!" };
const closedHeadline: Record<string, string> = { cancelled: "This order was cancelled", returned: "This order came back to the shop" };
const Check = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const Phone = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" /></svg>;
const Chat = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5 5.2 16A8 8 0 1 1 8 18.8z" /><path d="M9 10.5h6M9 13.5h4" /></svg>;
const Pin = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10" r="2.3" /></svg>;

// Only an https link may be opened from the card; anything else is ignored.
const safeLink = (u: string | null) => (u && /^https:\/\//i.test(u) ? u : null);

export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let card: Card | null = null;
  try {
    const res = await fetch(`${API_URL}/v1/public/card/${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (res.ok) card = ((await res.json()) as { card: Card }).card;
  } catch {}

  if (!card) {
    return (
      <main className="solo">
        <div className="panel">
          <h1>This link is not available</h1>
          <p className="note">It may have expired. Please ask the shop for a new one.</p>
        </div>
      </main>
    );
  }

  const { store, order, delivery } = card;
  const at = Math.max(0, steps.indexOf(order.status));
  const first = order.customerName.split(" ")[0];
  // This page is drawn on a server that may run in UTC (Vercel does), so say Pakistan time on purpose.
  const until = new Date(card.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Asia/Karachi" });
  const wa = store.phone ? `https://wa.me/${store.phone.replace(/\D/g, "").replace(/^0/, "92")}` : null;
  const cancelled = order.status === "cancelled" || order.status === "returned";
  const track = safeLink(delivery?.trackingUrl ?? null);
  const hasRider = !!delivery && (delivery.riderName || delivery.riderPhone);
  const photoSrc = delivery?.hasPhoto ? `/backend/v1/public/card/${encodeURIComponent(token)}/photo` : safeLink(delivery?.riderPhotoUrl ?? null);
  const photoTime = delivery?.riderPhotoTakenAt ? new Date(delivery.riderPhotoTakenAt).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi" }) : null;

  return (
    <div className="dcard" style={{ ["--store-base" as string]: store.accent }}>
      <main className="card-page" style={{ maxWidth: 480, gap: 18, paddingBottom: 40 }}>
        <header className="arrive">
          <p className="lbl">{store.name}{store.phone ? ` · ${store.phone}` : ""}</p>
          <p className="note-on">Order #{order.orderNo} for {first}</p>
        </header>

        <section className="arrive" style={{ ["--i" as string]: 1 }}>
          <h1 className="big">{cancelled ? closedHeadline[order.status] : headline[order.status]}</h1>
          {order.status === "out_for_delivery" && delivery?.riderName && <p className="note-on">{delivery.riderName} has your parcel.</p>}
        </section>

        {order.status === "out_for_delivery" && <div className="arrive" style={{ ["--i" as string]: 2 }}><RouteMap /></div>}

        {!cancelled && (
          <ol className="journey card-journey arrive" style={{ ["--n" as string]: 5, ["--at" as string]: Math.max(0, at), ["--i" as string]: 2 }} aria-label="Delivery progress">
            {steps.map((s, i) => (
              <li key={s} className={i < at ? "done" : i === at ? "now" : ""} aria-current={i === at ? "step" : undefined}>
                <span className="node">{i < at || (i === at && s === "delivered") ? <Check /> : i + 1}</span><span>{label[s]}</span>
              </li>
            ))}
          </ol>
        )}

        {hasRider && !cancelled && delivery && (
          <section className="white arrive" style={{ ["--i" as string]: 3 }} aria-label="Your rider">
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, alignItems: "center" }}>
              <span aria-hidden="true" className="avatar">{(delivery.riderName ?? "R").slice(0, 1)}</span>
              <div>
                <b className="rider-name">{delivery.riderName ?? "Your rider"}</b><br />
                <span className="note">{delivery.service === "indrive" ? "inDrive" : delivery.service === "yango" ? "Yango" : "Rider"}</span>
                {delivery.bikeNumber && <span className="plate">{delivery.bikeNumber}</span>}
              </div>
              {delivery.riderPhone && <a className="btn small" href={`tel:${delivery.riderPhone}`}><Phone />Call</a>}
            </div>
          </section>
        )}

        {photoSrc && !cancelled && (
          <figure className="white photo arrive" style={{ ["--i" as string]: 4 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoSrc} alt={`Photo of ${delivery?.riderName ?? "your rider"}`} />
            <figcaption><i className="live" />Photo of your rider{photoTime ? ` · taken ${photoTime}` : ""}</figcaption>
          </figure>
        )}

        {track && !cancelled && order.status !== "delivered" && (
          <div className="arrive" style={{ ["--i" as string]: 5, display: "grid", gap: 6 }}>
            <a className="btn white-btn" href={track} target="_blank" rel="noopener noreferrer"><Pin />Track delivery</a>
            <p className="note-on" style={{ textAlign: "center" }}>Opens your rider&apos;s live trip</p>
          </div>
        )}

        {!cancelled && (
          <section className="slip arrive" style={{ ["--i" as string]: 6 }} aria-label="What to pay">
            <h2>{order.collectAtDoor === 0 ? "Nothing to pay at the door" : "Please have ready"}</h2>
            {order.collectAtDoor > 0 && <p className="due num">PKR {fmt(order.collectAtDoor)}</p>}
            <p className="mut">{order.collectAtDoor === 0 ? "Your order is paid." : order.codAmount > 0 ? `${fmt(order.codAmount)} for your order${order.riderFee > 0 ? ` and ${fmt(order.riderFee)} for the rider` : ""}.` : "That is the rider's delivery fee. Your order is already paid."}</p>
            {order.items.map((i, n) => <div key={n} className="ln"><span>{i.quantity} × {i.name}</span></div>)}
            {order.discount > 0 && <div className="ln"><span>Discount</span><span className="num">− {fmt(order.discount)}</span></div>}
            {order.deliveryCharge > 0 && <div className="ln"><span>Delivery fee</span><span className="num">{fmt(order.deliveryCharge)}</span></div>}
            <div className="ln tot"><span>Order total</span><span className="num">{fmt(order.total)}</span></div>
            {order.codAmount === 0 && <div className="ln"><span>Already paid</span><span className="num">− {fmt(order.total)}</span></div>}
            {order.riderFee > 0 && <div className="ln"><span>Rider fee, to the rider</span><span className="num">{fmt(order.riderFee)}</span></div>}
            {(store.email || store.address) && <div className="ln mut contact"><span>{[store.address, store.email].filter(Boolean).join(" · ")}</span></div>}
          </section>
        )}

        <section className="stack arrive" style={{ ["--i" as string]: 7 }}>
          {wa && <a className="btn white-btn" href={wa}><Chat />Message {store.name}</a>}
          <p className="note-on" style={{ textAlign: "center" }}>This link stops working on {until}.</p>
        </section>
      </main>
    </div>
  );
}
