"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { pkr } from "@/lib/format";
import { useSession } from "@/lib/session";

type Parcel = { id: string; orderId: string; courier: string; trackingNo: string | null; trackingUrl: string | null; shippedOn: string | null; status: string; failureReason: string | null; orderNo: number; customerName: string; codAmount: number; storeId: string; storeName: string };
const filters = [["", "All"], ["shipped", "Shipped"], ["delayed", "Delayed"], ["failed", "Failed"], ["returned", "Returned"], ["delivered", "Delivered"]] as const;
const tone = (s: string) => (s === "delivered" ? "ok" : s === "failed" || s === "returned" ? "bad" : s === "delayed" ? "warn" : "");

// Every courier parcel, newest first, with the ones that need attention one tap away.
export default function ShipmentsPage() {
  const { stores, storeId } = useSession();
  const [status, setStatus] = useState("");
  const [list, setList] = useState<Parcel[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const targets = storeId ? stores.filter((s) => s.id === storeId) : stores;
    Promise.all(targets.map(async (s) => (await api<{ shipments: Omit<Parcel, "storeId" | "storeName">[] }>(`/stores/${s.id}/shipments${status ? `?status=${status}` : ""}`)).shipments.map((p) => ({ ...p, storeId: s.id, storeName: s.name }))))
      .then((ls) => live && setList(ls.flat()))
      .catch((e) => live && setError(messageOf(e)));
    return () => { live = false; };
  }, [status, storeId, stores]);

  return (
    <>
      <h1>Courier parcels</h1>
      <div className="chips" role="group" aria-label="Status">
        {filters.map(([v, label]) => <button key={label} className="chip" aria-pressed={status === v} onClick={() => setStatus(v)}>{label}</button>)}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!list ? <div className="skel" aria-busy="true"><span /><span /><span /></div> : list.length === 0 ? (
        <div className="empty"><b>No parcels here</b><span>A parcel appears when you mark a courier order as shipped.</span></div>
      ) : (
        <ul className="rows">
          {list.map((p, i) => (
            <li key={p.id} className="arrive" style={{ ["--i" as string]: i }}>
              <Link className="row" href={`/orders/${p.storeId}/${p.orderId}`}>
                <span style={{ color: "var(--brand)" }}><Icon name="truck" /></span>
                <span><span className="ttl">#{p.orderNo} {p.customerName}</span><br /><span className="meta num">{!storeId && `${p.storeName} · `}{p.courier}{p.trackingNo ? ` ${p.trackingNo}` : ""}{p.failureReason ? ` · ${p.failureReason}` : ""}</span></span>
                <span className="end"><span className={`badge ${tone(p.status)}`}>{p.status}</span>{p.codAmount > 0 && <span className="meta num">COD {pkr(p.codAmount)}</span>}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
