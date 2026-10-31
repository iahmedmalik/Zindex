"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Count, Icon, Seg } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { pkr } from "@/lib/format";
import { useSession } from "@/lib/session";

type Sales = {
  storeId: string; name: string; orders: number; returned: number; gross: number; discounts: number; deliveryFees: number; netSales: number;
  returnedValue: number; codCollected: number; onlineReceived: number; riderFeesPassedOn: number; deliveryPaidByStore: number; costOfGoods: number; linesWithoutCost: number;
  salesWithCost: number; salesWithoutCost: number; profit: number; marginPercent: number | null;
};
type Received = { total: number; payments: number; byMethod: { name: string; amount: number }[]; byStore: { name: string; amount: number }[] };
type Report = { from: string; to: string; stores: Sales[]; totals: Omit<Sales, "storeId" | "name">; bestSellers: { storeName: string; name: string; quantity: number; amount: number }[] };

const pk = (d: Date) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
function range(kind: string, from: string, to: string): [string, string] {
  const now = new Date();
  const today = pk(now);
  if (kind === "today") return [today, today];
  if (kind === "week") return [pk(new Date(now.getTime() - 6 * 86400_000)), today];
  if (kind === "month") return [`${today.slice(0, 8)}01`, today];
  return [from || today, to || today];
}

// Sales per store and together, cash received, best sellers, and the files for Excel.
export default function ReportsPage() {
  const { storeId, store } = useSession();
  const [kind, setKind] = useState<"today" | "week" | "month" | "custom">("week");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [report, setReport] = useState<Report | null>(null);
  const [received, setReceived] = useState<Received | null>(null);
  const [error, setError] = useState("");
  const [from, to] = range(kind, custom.from, custom.to);
  const qs = `from=${from}&to=${to}${storeId ? `&storeId=${storeId}` : ""}`;

  useEffect(() => {
    let live = true;
    setReport(null);
    setReceived(null);
    api<Report>(`/reports/sales?${qs}`).then((r) => { if (live) { setReport(r); setError(""); } }).catch((e) => live && setError(messageOf(e)));
    api<Received>(`/reports/received?${qs}`).then((r) => { if (live) setReceived(r); }).catch(() => undefined);
    return () => { live = false; };
  }, [qs]);

  const t = report?.totals;
  return (
    <>
      <div className="heading"><h1>Reports</h1><p className="note">{store ? store.name : "All stores"} · {from === to ? from : `${from} to ${to}`}</p></div>
      <Seg label="Period" value={kind} onChange={setKind} options={[["today", "Today"], ["week", "7 days"], ["month", "This month"], ["custom", "Dates"]] as const} />
      <div className={`expand${kind === "custom" ? " open" : ""}`}><div className="grid2">
        <label className="field"><span>From</span><input className="input" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
        <label className="field"><span>To</span><input className="input" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
      </div></div>
      {error && <p className="error" role="alert">{error}</p>}

      {!report || !t ? <div className="skel" aria-busy="true"><span /><span /><span /></div> : (
        <div className="split">
          <div className="stack" style={{ gap: 28 }}>
            <section className="heading">
              <p className="note">Net sales</p>
              <p className="big num">PKR <Count value={t.netSales} money /></p>
              <p className="note"><Count value={t.orders} /> orders{t.returned ? ` · ${t.returned} returned` : ""} · {pkr(t.discounts)} given in discounts</p>
            </section>
            <section className="section">
              <h2>Money</h2>
              <ul className="ledger">
                <li><span>Goods sold</span><span className="lead" /><span className="num">{pkr(t.gross)}</span></li>
                <li className="aside"><span>Discounts</span><span className="lead" /><span className="num">− {t.discounts.toLocaleString("en-US")}</span></li>
                <li><span>Courier delivery fees (customers paid)</span><span className="lead" /><span className="num">{t.deliveryFees.toLocaleString("en-US")}</span></li>
                {t.returnedValue > 0 && <li className="aside"><span>Returned</span><span className="lead" /><span className="num">− {t.returnedValue.toLocaleString("en-US")}</span></li>}
                <li className="total"><span>Net sales</span><span className="lead" /><span className="num">{pkr(t.netSales)}</span></li>
                <li className="aside"><span>Rider fees (went to riders, not sales)</span><span className="lead" /><span className="num">{t.riderFeesPassedOn.toLocaleString("en-US")}</span></li>
                {t.deliveryPaidByStore > 0 && <li><span>Delivery paid by the store</span><span className="lead" /><span className="num">− {t.deliveryPaidByStore.toLocaleString("en-US")}</span></li>}
              </ul>
            </section>
            <section className="section">
              <h2>Money received</h2>
              <p className="note">Counted by the day each payment came in, not by the order&apos;s date: cash from riders and couriers, advance payments, and what pay-later customers paid, in chunks or all at once.</p>
              {!received ? <div className="skel"><span /></div> : received.total === 0 ? <p className="note">No payment came in during this period.</p> : (
                <>
                  <p className="big num">PKR <Count value={received.total} money /></p>
                  <p className="note">{received.payments} payment{received.payments === 1 ? "" : "s"}</p>
                  <ul className="ledger">
                    {received.byMethod.map((m) => <li key={m.name}><span>{m.name}</span><span className="lead" /><span className="num">{m.amount.toLocaleString("en-US")}</span></li>)}
                  </ul>
                  {received.byStore.length > 1 && (
                    <ul className="ledger">
                      {received.byStore.map((st) => <li key={st.name} className="aside"><span>{st.name}</span><span className="lead" /><span className="num">{st.amount.toLocaleString("en-US")}</span></li>)}
                    </ul>
                  )}
                </>
              )}
            </section>
            <section className="section">
              <h2>Profit</h2>
              <p className="big num">PKR <Count value={t.profit} money /></p>
              <p className="note">{t.marginPercent === null ? "No sold item has a cost yet." : `${t.marginPercent}% of what the items with a cost sold for`}</p>
              <ul className="ledger">
                <li><span>Sold for (items with a cost, after discount)</span><span className="lead" /><span className="num">{t.salesWithCost.toLocaleString("en-US")}</span></li>
                <li className="aside"><span>What those items cost</span><span className="lead" /><span className="num">− {t.costOfGoods.toLocaleString("en-US")}</span></li>
                {t.deliveryPaidByStore > 0 && <li className="aside"><span>Delivery you paid</span><span className="lead" /><span className="num">− {t.deliveryPaidByStore.toLocaleString("en-US")}</span></li>}
                <li className="total"><span>Profit</span><span className="lead" /><span className="num">{pkr(t.profit)}</span></li>
              </ul>
              {t.linesWithoutCost > 0 ? (
                <div className="well" role="status">
                  <b>Not complete yet</b>
                  <p className="note">{t.linesWithoutCost} sold item{t.linesWithoutCost === 1 ? " has" : "s have"} no cost ({pkr(t.salesWithoutCost)} of sales), so {t.linesWithoutCost === 1 ? "it is" : "they are"} left out of this profit.</p>
                  <Link className="btn quiet" href="/reports/costs">Fill in the costs</Link>
                </div>
              ) : <p className="note">Every sold item has a cost, so this profit is complete.</p>}
              <p className="note">Profit is goods margin: what the items sold for minus what they cost. Delivery the customer paid (courier fees, rider fees) is not in it; delivery you paid yourself is taken off.</p>
            </section>
            {report.stores.length > 1 && (
              <section className="section">
                <h2>Profit by store</h2>
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Store</th><th className="r">Profit</th><th className="r">Margin</th><th className="r">No cost yet</th></tr></thead>
                  <tbody>{report.stores.map((s) => <tr key={s.storeId}><td>{s.name}</td><td className="r num">{s.profit.toLocaleString("en-US")}</td><td className="r num">{s.marginPercent === null ? "–" : `${s.marginPercent}%`}</td><td className="r num">{s.linesWithoutCost || "–"}</td></tr>)}</tbody>
                  <tfoot><tr><td>All stores</td><td className="r num">{t.profit.toLocaleString("en-US")}</td><td className="r num">{t.marginPercent === null ? "–" : `${t.marginPercent}%`}</td><td className="r num">{t.linesWithoutCost || "–"}</td></tr></tfoot>
                </table></div>
              </section>
            )}
            {!storeId && report.stores.length > 1 && (
              <section className="section">
                <h2>By store</h2>
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Store</th><th className="r">Orders</th><th className="r">Net sales</th><th className="r">Discounts</th><th className="r">Cash in</th></tr></thead>
                  <tbody>{report.stores.map((s) => <tr key={s.storeId}><td>{s.name}</td><td className="r num">{s.orders}</td><td className="r num">{s.netSales.toLocaleString("en-US")}</td><td className="r num">{s.discounts.toLocaleString("en-US")}</td><td className="r num">{(s.codCollected + s.onlineReceived).toLocaleString("en-US")}</td></tr>)}</tbody>
                  <tfoot><tr><td>All stores</td><td className="r num">{t.orders}</td><td className="r num">{t.netSales.toLocaleString("en-US")}</td><td className="r num">{t.discounts.toLocaleString("en-US")}</td><td className="r num">{(t.codCollected + t.onlineReceived).toLocaleString("en-US")}</td></tr></tfoot>
                </table></div>
              </section>
            )}
          </div>
          <aside className="side">
            <section className="section">
              <h2>Best sellers</h2>
              {report.bestSellers.length === 0 ? <p className="note">No sales in this period.</p> : (
                <ol className="ledger" style={{ paddingLeft: 0 }}>
                  {report.bestSellers.map((b) => <li key={`${b.storeName}-${b.name}`} style={{ fontSize: "var(--t-sm)" }}><span>{b.name}{!storeId && <span className="note"> · {b.storeName}</span>}</span><span className="lead" /><span className="num">{b.quantity}</span></li>)}
                </ol>
              )}
            </section>
            <section className="well">
              <h2>For Excel</h2>
              <a className="btn quiet" href={`/backend/v1/reports/sales?${qs}&format=csv`} download><Icon name="download" size={18} />Sales file</a>
              <a className="btn quiet" href={`/backend/v1/reports/inventory?format=csv${storeId ? `&storeId=${storeId}` : ""}`} download><Icon name="download" size={18} />Stock file</a>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
