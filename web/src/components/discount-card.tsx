"use client";

import { useEffect, useState } from "react";
import { Dialog, Seg } from "@/components/ui";
import { lineOff } from "@/lib/format";
import type { ItemDiscount } from "@/lib/types";

const n = (x: number) => x.toLocaleString("en-US");
const quick = { percent: [5, 10, 15, 20], amount: [100, 250, 500, 1000] } as const;

/**
 * The discount on one item: a card over the page (the page blurred behind it) with two ways to say it, a percent of the
 * item's line or rupees off the whole line. It shows what the item becomes as you type; the server works out the real
 * number on save.
 */
export function DiscountCard({ open, onClose, name, quantity, unitPrice, value, onApply }: {
  open: boolean;
  onClose: () => void;
  name: string;
  quantity: number;
  unitPrice: number;
  value: ItemDiscount | null;
  onApply: (d: ItemDiscount | null) => void;
}) {
  const [kind, setKind] = useState<ItemDiscount["kind"]>("percent");
  const [text, setText] = useState("");
  const gross = quantity * unitPrice;
  const limit = kind === "percent" ? 100 : gross;
  const typed = Math.min(Number(text.replace(/\D/g, "")) || 0, limit);
  const off = lineOff({ quantity, unitPrice, discount: { kind, value: typed } });

  useEffect(() => {
    if (!open) return;
    setKind(value?.kind ?? "percent");
    setText(value ? String(value.value) : "");
  }, [open, value]);

  return (
    <Dialog open={open} onClose={onClose} label={`Discount on ${name || "this item"}`}>
      <div>
        <h2>Discount on {name || "this item"}</h2>
        <p className="note num">{quantity} × {n(unitPrice)} = {n(gross)}</p>
      </div>
      <Seg label="Kind of discount" value={kind} onChange={(k) => { setKind(k); setText(""); }} options={[["percent", "Percent %"], ["amount", "Rupees Rs"]] as const} />
      <label className="dc-amt">
        <span aria-hidden="true">{kind === "percent" ? "%" : "Rs"}</span>
        <input data-first inputMode="numeric" aria-label={kind === "percent" ? "Discount percent" : "Discount in rupees"} placeholder="0" value={text} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setText(v !== "" && Number(v) > limit ? String(limit) : v); }} />
      </label>
      <div className="dc-quick" role="group" aria-label="Quick amounts">
        {quick[kind].map((q) => <button type="button" key={q} className="chip" aria-pressed={typed === q} onClick={() => setText(String(Math.min(q, limit)))}>{kind === "percent" ? `${q}%` : n(q)}</button>)}
      </div>
      <div className="dc-pre" aria-live="polite"><span>This item becomes</span><b>{n(gross - off)} <small>{off > 0 ? `(− ${n(off)})` : ""}</small></b></div>
      <div className="dlg-actions">
        <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
        <button type="button" className="btn" disabled={typed === 0} onClick={() => { onApply({ kind, value: typed }); onClose(); }}>Apply discount</button>
      </div>
      {value && <button type="button" className="linkbtn" style={{ justifySelf: "center", color: "var(--ink-2)" }} onClick={() => { onApply(null); onClose(); }}>Remove discount</button>}
    </Dialog>
  );
}
