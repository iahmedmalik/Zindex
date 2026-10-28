"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InvoicePaper, type InvoiceStore } from "@/components/invoice-paper";
import { Icon, Seg, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { downloadImage, invoiceImage, shareImage } from "@/lib/invoice-image";
import type { Invoice, Order } from "@/lib/types";

type View = { invoice: Invoice; order: Order; store: InvoiceStore };

// The invoice as the customer gets it, in the store's colours. A4 or a compact receipt.
// "Save to gallery" opens the phone's share sheet with a picture of the paper (choose "Save image");
// "Send on WhatsApp" shares the same picture; "Download PDF" opens the print sheet, which offers Save as PDF.
// The picture is made ahead of time, as soon as the paper is on screen. A browser only opens the share sheet while the
// tap is still fresh, so making the picture after the tap fails ("Must be handling a user gesture") on a slower phone.
export default function InvoicePage() {
  const { storeId, orderId } = useParams<{ storeId: string; orderId: string }>();
  const toast = useToast();
  const paper = useRef<HTMLElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState<"a4" | "compact">("compact");
  const [picked, setPicked] = useState<"a4" | "compact">("compact"); // the toggle moves at once; only the paper waits for its transition
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "gallery" | "whatsapp">("");
  const picture = useRef<Blob | null>(null); // the picture of the paper as it is now, made ahead of the tap
  const [ready, setReady] = useState(false);
  const [prepFailed, setPrepFailed] = useState(false);

  useEffect(() => {
    api<View>(`/stores/${storeId}/orders/${orderId}/invoice`).then(setView).catch((e) => setError(messageOf(e)));
  }, [storeId, orderId]);

  // Make the picture whenever the paper (or its size) changes. The size switch is a view transition, so wait for it to settle.
  useEffect(() => {
    if (!view) return;
    let stale = false;
    picture.current = null;
    setReady(false);
    setPrepFailed(false);
    const timer = setTimeout(async () => {
      try {
        if (!paper.current) throw new Error("no paper");
        const blob = await invoiceImage(paper.current);
        if (!stale) { picture.current = blob; setReady(true); }
      } catch {
        if (!stale) setPrepFailed(true); // the buttons then make the picture on the tap, as before
      }
    }, 900);
    return () => { stale = true; clearTimeout(timer); };
  }, [view, size]);

  const changeSize = (v: "a4" | "compact") => {
    const reduced = document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const d = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (d.startViewTransition && !reduced) d.startViewTransition(() => setSize(v));
    else setSize(v);
  };

  // Nothing may be awaited between the tap and navigator.share, or the browser says the tap is too old.
  function send(kind: "gallery" | "whatsapp") {
    if (!view) return;
    void deliver(kind, picture.current);
  }
  async function deliver(kind: "gallery" | "whatsapp", made: Blob | null) {
    if (!view) return;
    setBusy(kind);
    try {
      const name = `${view.invoice.number ?? `draft-${view.order.orderNo}`}.png`;
      const blob = made ?? (paper.current ? await invoiceImage(paper.current) : null);
      if (!blob) throw new Error("The picture could not be made.");
      if (await shareImage(blob, name)) return;
      downloadImage(blob, name);
      const phone = view.order.customerPhone?.replace(/\D/g, "").replace(/^0/, "92");
      if (kind === "whatsapp" && phone) window.open(`https://wa.me/${phone}`, "_blank", "noopener");
      toast(kind === "whatsapp" ? "Image saved. Attach it in the WhatsApp chat." : "Invoice image saved");
    } catch (err) {
      if ((err as Error).name === "NotAllowedError") toast("Your phone wants one more tap to share. Tap the button again.", "bad");
      else toast(messageOf(err), "bad");
    } finally {
      setBusy("");
    }
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!view) return <div className="skel" aria-busy="true"><span /><span /><span /></div>;
  const { invoice, order, store } = view;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="inline between noprint">
        <Link href={`/orders/${storeId}/${orderId}`} className="note" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}><Icon name="back" size={16} />Order #{order.orderNo}</Link>
        <div style={{ minWidth: 200 }}><Seg label="Paper size" value={picked} onChange={(v) => { setPicked(v); changeSize(v); }} options={[["compact", "Compact"], ["a4", "A4"]] as const} /></div>
      </div>

      <InvoicePaper ref={paper} invoice={invoice} order={order} store={store} size={size} />

      <div className="stack noprint" style={{ gap: 8 }}>
        <button className="btn" disabled={busy !== "" || (!ready && !prepFailed)} onClick={() => send("gallery")}><Icon name="share" size={18} />{busy === "gallery" ? "Opening…" : !ready && !prepFailed ? "Getting the picture ready…" : "Save to gallery"}</button>
        <div className="inline" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn quiet" style={{ flex: "1 1 200px" }} disabled={busy !== "" || (!ready && !prepFailed)} onClick={() => send("whatsapp")}><Icon name="chat" size={18} />{busy === "whatsapp" ? "Opening…" : "Send on WhatsApp"}</button>
          <button className="btn quiet" style={{ flex: "1 1 200px" }} onClick={() => window.print()}><Icon name="print" size={18} />Download PDF</button>
        </div>
        <p className="note" style={{ textAlign: "center" }}>&quot;Save to gallery&quot; opens your phone&apos;s share sheet. Choose &quot;Save image&quot; and it lands in your photos.</p>
      </div>
    </div>
  );
}
