"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, Seg, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { pkr } from "@/lib/format";
import type { Invoice, Order, Store } from "@/lib/types";

type View = { invoice: Invoice; order: Order; store: Pick<Store, "name" | "phone" | "address" | "logoUrl" | "accent"> };

// The invoice as the customer gets it. A4 or a compact receipt; "Image" makes a PNG to send on
// WhatsApp (through the phone's share sheet when it has one); "Print / PDF" opens the print sheet,
// which also offers Save as PDF. The paper stays light in dark mode because it is what gets shared.
export default function InvoicePage() {
  const { storeId, orderId } = useParams<{ storeId: string; orderId: string }>();
  const toast = useToast();
  const doc = useRef<HTMLElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState<"a4" | "compact">("a4");
  const [picked, setPicked] = useState<"a4" | "compact">("a4"); // the toggle moves at once; only the paper waits for its transition
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<View>(`/stores/${storeId}/orders/${orderId}/invoice`).then(setView).catch((e) => setError(messageOf(e)));
  }, [storeId, orderId]);

  const changeSize = (v: "a4" | "compact") => {
    const reduced = document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const d = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (d.startViewTransition && !reduced) d.startViewTransition(() => setSize(v));
    else setSize(v);
  };

  async function image() {
    if (!doc.current || !view) return;
    setBusy(true);
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(doc.current, { pixelRatio: 2, backgroundColor: "#fffdfa", cacheBust: true });
      if (!blob) throw new Error("The image could not be made.");
      const name = `${view.invoice.number ?? `draft-${view.order.orderNo}`}.png`;
      const file = new File([blob], name, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast("Invoice image saved");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast(messageOf(err), "bad");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!view) return <div className="skel" aria-busy="true"><span /><span /><span /></div>;
  const { invoice, order, store } = view;
  const date = new Date(invoice.finalisedAt ?? Date.now()).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const due = order.amountDue === 0 ? "Paid" : order.payment === "cod" ? "Pay on delivery" : "Amount due";

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="inline between noprint">
        <Link href={`/orders/${storeId}/${orderId}`} className="note" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}><Icon name="back" size={16} />Order #{order.orderNo}</Link>
        {invoice.status === "draft" && <span className="stamp draft">Draft</span>}
      </div>
      <div className="inline noprint">
        <div style={{ minWidth: 200 }}><Seg label="Paper size" value={picked} onChange={(v) => { setPicked(v); changeSize(v); }} options={[["a4", "A4"], ["compact", "Compact"]] as const} /></div>
        <span className="spacer" />
        <button className="btn quiet" disabled={busy} onClick={() => void image()}><Icon name="share" size={18} />{busy ? "Making…" : "Image"}</button>
        <button className="btn" onClick={() => window.print()}><Icon name="print" size={18} />Print / PDF</button>
      </div>

      <article ref={doc} className={`doc${size === "compact" ? " compact" : ""}`} style={{ ["--store" as string]: store.accent }}>
        <header>
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="mono" style={{ background: store.accent }}>{store.logoUrl ? <img src={store.logoUrl} alt="" /> : store.name.slice(0, 1)}</span>
            <div><h1 style={{ color: store.accent }}>{store.name}</h1>{store.address && <span className="fine">{store.address}</span>}</div>
          </div>
          <div className="no"><b className="num">{invoice.number ?? "DRAFT"}</b><span className="fine">{date}</span></div>
        </header>
        <div><span className="fine">Bill to</span><br /><b>{order.customerName}</b>{order.customerPhone && <> · <span className="num">{order.customerPhone}</span></>}{order.address && <><br />{order.address}</>}</div>
        <table>
          <thead><tr><th>Item</th><th className="r">Qty</th><th className="r hide-compact">Price</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id}><td>{i.name}</td><td className="r num">{i.quantity}</td><td className="r num hide-compact">{i.unitPrice.toLocaleString("en-US")}</td><td className="r num">{(i.quantity * i.unitPrice).toLocaleString("en-US")}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="sums">
          <ul className="ledger">
            <li><span>Subtotal</span><span className="lead" /><span className="num">{order.subtotal.toLocaleString("en-US")}</span></li>
            {order.discount > 0 && <li><span>Discount {order.discountPercent}%</span><span className="lead" /><span className="num">− {order.discount.toLocaleString("en-US")}</span></li>}
            {order.deliveryCharge > 0 && <li><span>Delivery</span><span className="lead" /><span className="num">{order.deliveryCharge.toLocaleString("en-US")}</span></li>}
            <li className="total"><span>Total</span><span className="lead" /><span className="num">{pkr(order.total)}</span></li>
          </ul>
          <div className="due" style={{ background: `color-mix(in srgb, ${store.accent} 9%, #fff)` }}><span>{due}</span><b className="num">{order.amountDue === 0 ? pkr(order.total) : pkr(order.amountDue)}</b></div>
          {order.riderFee > 0 && <p className="fine">The rider&apos;s fee ({pkr(order.riderFee)}) is paid to the rider and is not part of this invoice.</p>}
        </div>
        <footer><span>Thank you for ordering from {store.name}</span>{store.phone && <span className="num">WhatsApp {store.phone}</span>}</footer>
      </article>
    </div>
  );
}
