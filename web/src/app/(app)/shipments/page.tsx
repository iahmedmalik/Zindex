"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { pkr, stageLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Stage } from "@/lib/types";

type Parcel = { id: string; orderId: string; courier: string; trackingNo: string | null; trackingUrl: string | null; shippedOn: string | null; orderNo: number; customerName: string; codAmount: number; orderStatus: Stage; storeId: string; storeName: string };

// Every courier parcel, newest first, with its order's stage. The order's main button is the only thing that moves it along.
export default function ShipmentsPage() {
  const { stores, storeId } = useSession();
  const [list, setList] = useState<Parcel[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const targets = storeId ? stores.filter((s) => s.id === storeId) : stores;
    Promise.all(targets.map(async (s) => (await api<{ shipments: Omit<Parcel, "storeId" | "storeName">[] }>(`/stores/${s.id}/shipments`)).shipments.map((p) => ({ ...p, storeId: s.id, storeName: s.name }))))
      .then((ls) => live && setList(ls.flat()))
      .catch((e) => live && setError(messageOf(e)));
    return () => { live = false; };
  }, [storeId, stores]);

  return (
    <>
      <h1>Courier parcels</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!list ? <div className="skel" aria-busy="true"><span /><span /><span /></div> : list.length === 0 ? (
        <div className="empty"><b>No parcels here</b><span>A parcel appears when you add a courier to a courier order.</span></div>
      ) : (
        <ul className="rows">
          {list.map((p, i) => (
            <li key={p.id} className="arrive" style={{ ["--i" as string]: i }}>
              <Link className="row" href={`/orders/${p.storeId}/${p.orderId}`}>
                <span style={{ color: "var(--brand-hi)" }}><Icon name="truck" /></span>
                <span><span className="ttl">#{p.orderNo} {p.customerName}</span><br /><span className="meta num">{!storeId && `${p.storeName} · `}{p.courier}{p.trackingNo ? ` ${p.trackingNo}` : ""}</span></span>
                <span className="end"><span className="badge">{stageLabel[p.orderStatus]}</span>{p.codAmount > 0 && <span className="meta num">COD {pkr(p.codAmount)}</span>}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
