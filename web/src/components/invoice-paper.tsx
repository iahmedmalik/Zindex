import { forwardRef } from "react";
import { pkr } from "@/lib/format";
import type { Invoice, Order, Store } from "@/lib/types";

export type InvoiceStore = Pick<Store, "name" | "phone" | "email" | "address" | "logoUrl" | "accent">;

const n = (v: number) => v.toLocaleString("en-US");

// What the customer sees in the chip and in the "at the door" card, by how the order is paid.
function payWords(order: Order) {
  const rider = order.riderFee;
  if (order.payment === "cod") {
    return { chip: "Cash on delivery", label: "Have ready for the rider", sub: rider > 0 ? `${pkr(order.codAmount)} for the order + ${pkr(rider)} for the rider` : `${pkr(order.codAmount)} for the order` };
  }
  if (order.payment === "paid") {
    return rider > 0
      ? { chip: "Paid", label: "Only the rider's fee at the door", sub: "Your order is paid in full" }
      : { chip: "Paid", label: "Nothing to pay at the door", sub: "Your order is paid in full" };
  }
  return { chip: "Pay later", label: rider > 0 ? "At the door: the rider's fee" : "Nothing to pay at the door", sub: `The order total of ${pkr(order.total)} is paid to the shop later` };
}

/**
 * The invoice paper, "The trip": a gradient header in the store's colour with a dashed delivery
 * curve and a pin, a sheet that slides up over it, and a big "at the door" card. It is also what
 * gets saved as an image, so everything is plain HTML and inline SVG (no CSS masks, no <use>):
 * the torn edge is an SVG strip. The paper stays light in dark mode on purpose.
 */
export const InvoicePaper = forwardRef<HTMLElement, { invoice: Invoice; order: Order; store: InvoiceStore; size: "a4" | "compact" }>(function InvoicePaper(
  { invoice, order, store, size },
  ref,
) {
  const date = new Date(invoice.finalisedAt ?? Date.now()).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const words = payWords(order);
  const chip = words.chip; // a draft already says DRAFT where the number goes
  const compact = size === "compact";
  const contact = [store.email, store.phone, compact ? null : store.address].filter(Boolean).join(" · ");
  const showDoor = order.payment === "cod" || order.riderFee > 0 || order.payment === "unpaid";
  const door = order.collectAtDoor;
  const teeth = Array.from({ length: 24 }, (_, i) => `L${240 - i * 10 - 5} 10 L${240 - i * 10 - 10} 0`).join(" ");

  const customer = (
    <div className="iv-to">
      <div className="iv-lbl">Bill to</div>
      <b>{order.customerName}</b>
      <span>{[order.customerPhone, order.address].filter(Boolean).map((line, i) => (i === 0 ? <span key={i}>{line}<br /></span> : <span key={i}>{line}</span>))}</span>
    </div>
  );

  const items = (
    <div className="iv-items">
      {order.items.map((i) => (
        <div className="iv-it" key={i.id}>
          <span className="iv-q">{i.quantity}</span>
          <div><b>{i.name}</b><small>{pkr(i.unitPrice)} each</small></div>
          <span className="iv-amt">{n(i.quantity * i.unitPrice)}</span>
        </div>
      ))}
    </div>
  );

  const sum = (
    <div className="iv-sum">
      <div className="iv-ln"><span>Subtotal</span><span className="iv-amt">{n(order.subtotal)}</span></div>
      {order.discount > 0 && <div className="iv-ln"><span>Discount {order.discountPercent}%</span><span className="iv-amt">− {n(order.discount)}</span></div>}
      {order.deliveryCharge > 0 && <div className="iv-ln"><span>Delivery</span><span className="iv-amt">{n(order.deliveryCharge)}</span></div>}
      <div className="iv-total"><span>Total</span><b>{pkr(order.total)}</b></div>
    </div>
  );

  const doorCard = showDoor && (
    <div className="iv-door">
      <svg className="iv-routes" viewBox="0 0 300 90" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
        <path d="M170 70C200 80 215 40 245 48S280 20 290 18" stroke="#fff" strokeWidth="2.2" strokeDasharray="3 8" strokeLinecap="round" opacity=".45" />
        <circle cx="170" cy="70" r="5" fill="#fff" opacity=".55" />
      </svg>
      <span>{words.label}</span>
      <b>{pkr(door)}</b>
      <small>{words.sub}</small>
    </div>
  );

  const later = order.payment === "unpaid" && order.expected - order.paid > 0 && (
    <p className="iv-fee"><b>To pay the shop later: {pkr(order.expected - order.paid)}</b>{order.paid > 0 ? ` (paid so far ${pkr(order.paid)} of ${pkr(order.total)})` : ""}</p>
  );
  const fee = order.riderFee > 0 && <p className="iv-fee">The rider&apos;s {pkr(order.riderFee)} is paid straight to the rider and is not part of this invoice total.</p>;

  return (
    <article ref={ref} className={`ivp ${compact ? "compact" : "a4"}`} style={{ ["--store" as string]: store.accent }}>
      <div className="iv-hero">
        <svg className="iv-routes" viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
          <path d="M30 130C110 150 120 60 200 80S300 30 360 40" stroke="#fff" strokeWidth="2.6" strokeDasharray="3 9" strokeLinecap="round" opacity=".28" />
          <circle cx="30" cy="130" r="7" fill="#fff" opacity=".6" />
          <path d="M360 22c-7 0-12 5-12 12 0 9 12 20 12 20s12-11 12-20c0-7-5-12-12-12z" fill="#fff" opacity=".65" />
          <circle cx="360" cy="34" r="4.5" fill={store.accent} />
        </svg>
        <div className="iv-id">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="iv-mark">{store.logoUrl ? <img src={store.logoUrl} alt="" /> : store.name.slice(0, 1).toUpperCase()}</span>
          <div><h2>{store.name}</h2>{contact && <small>{contact}</small>}</div>
        </div>
        <div className="iv-meta">
          <span className="iv-num">{invoice.number ?? "DRAFT"}</span>
          <span className="iv-date">{date}</span>
          <span className="iv-chip"><i />{chip}</span>
        </div>
      </div>
      <div className="iv-sheet">
        <svg className="iv-wm" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
          <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M-10 70H120L160 110H300L340 70H420" /><path d="M-10 190H90L140 140H250L290 180H420" /><path d="M60 -10V80L100 120V230L140 270V320" /><path d="M330 -10V60L290 100V200L330 240V320" /></g>
        </svg>
        {compact ? customer : (
          <div className="iv-cols">
            {customer}
            <div className="iv-to"><div className="iv-lbl">Deliver by</div><b>{order.deliveryKind === "local" ? "Local rider" : order.deliveryKind === "courier" ? "Courier" : "Pickup"}</b>{order.riderFee > 0 && <span>The rider fee is paid straight to the rider.</span>}</div>
          </div>
        )}
        {items}
        {compact ? <>{sum}{doorCard}{later}{fee}</> : (
          <div className="iv-cols" style={{ marginTop: 8, alignItems: "start" }}>
            <div>{later}{fee}</div>
            <div>{sum}{doorCard}</div>
          </div>
        )}
        <div className="iv-foot">
          <b>Thank you for ordering from {store.name}</b>
          {(store.email || store.phone) && <span>{[store.email, store.phone].filter(Boolean).join(" · ")}</span>}
          {compact && store.address && <span>{store.address}</span>}
        </div>
      </div>
      {compact && (
        <svg className="iv-torn" viewBox="0 0 240 10" preserveAspectRatio="none" aria-hidden="true">
          <path d={`M0 0 H240 ${teeth} Z`} fill="#fffdf8" />
        </svg>
      )}
    </article>
  );
});
