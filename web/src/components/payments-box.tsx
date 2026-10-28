"use client";

import { useCallback, useEffect, useState } from "react";
import { DoneButton, Icon, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { pkr } from "@/lib/format";
import type { Order } from "@/lib/types";

type Payment = { id: string; amount: number; method: string | null; note: string | null; receivedOn: string };
type Ledger = { expected: number; paid: number; balance: number; payments: Payment[] };

const methods = ["Cash", "Easypaisa", "JazzCash", "Bank transfer"];
const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * The order's payments: what is expected, each payment received (a customer who pays later pays in chunks over days,
 * and COD cash comes back from a rider or a courier in chunks too) and what is left. One tap records the whole balance;
 * "Add payment" records a part, with the amount, the method and the day it came in.
 */
export function PaymentsBox({ base, order, onChange, busy }: { base: string; order: Order; onChange: () => Promise<void> | void; busy: boolean }) {
  const toast = useToast();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(methods[0]!);
  const [date, setDate] = useState(today());
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try { setLedger(await api<Ledger>(`${base}/payments`)); } catch { setLedger(null); }
  }, [base]);
  useEffect(() => { void load(); }, [load, order.paid, order.expected]);

  if (!ledger) return null;
  const left = ledger.balance;
  const kind = order.payment;
  const cash = kind === "cod";
  const wording = cash ? { all: order.deliveryKind === "courier" ? "Courier paid the cash" : order.deliveryKind === "pickup" ? "Cash received" : "Rider handed over the cash", badge: "Cash received", add: "Add cash received" }
    : kind === "paid" ? { all: "I can see the payment", badge: "Payment received", add: "Add payment" }
    : { all: "Got the payment", badge: "Paid in full", add: "Add payment" };

  async function record(value: number, how: string, when: string) {
    setWorking(true);
    try {
      await api(`${base}/payments`, { method: "POST", body: { amount: value, method: how, receivedOn: when } });
      toast(`${pkr(value)} recorded`);
      setAdding(false);
      setAmount("");
      await load();
      await onChange();
    } catch (err) {
      toast(messageOf(err), "bad");
    } finally {
      setWorking(false);
    }
  }
  async function undo(id: string) {
    setWorking(true);
    try {
      await api(`${base}/payments/${id}`, { method: "DELETE" });
      toast("Payment undone");
      await load();
      await onChange();
    } catch (err) {
      toast(messageOf(err), "bad");
    } finally {
      setWorking(false);
    }
  }

  const n = Number(amount);
  const presets = [{ label: `Full balance ${pkr(left)}`, value: left }, ...(left >= 2 ? [{ label: `Half ${pkr(Math.floor(left / 2))}`, value: Math.floor(left / 2) }] : [])];

  return (
    <div className="stack" style={{ gap: 10 }} id="payments">
      <ul className="ledger">
        <li><span>Expected</span><span className="lead" /><span className="num">{pkr(ledger.expected)}</span></li>
        <li className="aside"><span>Received</span><span className="lead" /><span className="num">{pkr(ledger.paid)}</span></li>
        <li className="total"><span>Still to collect</span><span className="lead" /><span className="num">{pkr(left)}</span></li>
      </ul>
      {ledger.payments.length > 0 && (
        <ul className="ledger" aria-label="Payments received">
          {ledger.payments.map((p) => (
            <li key={p.id} style={{ fontSize: "var(--t-sm)" }}>
              <span>{day(p.receivedOn)}{p.method ? ` · ${p.method}` : ""}</span><span className="lead" /><span className="num">{pkr(p.amount)}</span>
              <button className="linkbtn" disabled={working || busy} onClick={() => void undo(p.id)}>Undo</button>
            </li>
          ))}
        </ul>
      )}
      {left === 0 && ledger.paid > 0 && <span className="badge ok">{wording.badge}</span>}
      {left > 0 && (
        <>
          <div className="inline" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn small quiet" disabled={working || busy} onClick={() => void record(left, order.paymentMethod ?? methods[0]!, today())}><Icon name="cash" size={18} />{wording.all}</button>
            <button className="btn small quiet" aria-expanded={adding} onClick={() => setAdding((a) => !a)}><Icon name="plus" size={16} />{wording.add}</button>
          </div>
          <div className={`expand${adding ? " open" : ""}`}><div className="stack" style={{ gap: 12 }}>
            <div className="field"><span>How much</span>
              <div className="inline" role="group" aria-label="Amount" style={{ gap: 8, flexWrap: "wrap" }}>
                {presets.map((p) => <button type="button" key={p.label} className="chip" aria-pressed={n === p.value} onClick={() => setAmount(String(p.value))}>{p.label}</button>)}
              </div>
              <input className="input num" inputMode="numeric" aria-label="Other amount" placeholder="Other amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="field"><span>Paid by</span>
              <div className="inline" role="group" aria-label="Method" style={{ gap: 8, flexWrap: "wrap" }}>
                {methods.map((m) => <button type="button" key={m} className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>{m}</button>)}
              </div>
            </div>
            <label className="field"><span>Came in on</span><input className="input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></label>
            <DoneButton done="Recorded" disabled={working || busy || !(n >= 1 && n <= left)} onClick={() => record(n, method, date)}>Save payment</DoneButton>
          </div></div>
        </>
      )}
    </div>
  );
}
