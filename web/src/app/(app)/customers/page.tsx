"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Customer } from "@/lib/types";

// Customers of one store, saved automatically from orders. Search by name or any spelling of the phone.
export default function CustomersPage() {
  const { stores, storeId, select } = useSession();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Customer[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!storeId) return;
    const t = setTimeout(() => {
      api<{ customers: Customer[] }>(`/stores/${storeId}/customers?q=${encodeURIComponent(q)}`).then((r) => { setList(r.customers); setError(""); }).catch((e) => setError(messageOf(e)));
    }, 200);
    return () => clearTimeout(t);
  }, [storeId, q]);

  if (!storeId) {
    return (
      <>
        <h1>Customers</h1>
        <div className="empty"><b>Pick a store</b><span>Each store keeps its own customers, even when the same person buys from two.</span>
          <div className="inline">{stores.map((s) => <button key={s.id} className="chip" onClick={() => select(s.id)}><span className="dot" style={{ background: s.accent }} />{s.name}</button>)}</div>
        </div>
      </>
    );
  }
  return (
    <>
      <h1>Customers</h1>
      <input className="input" type="search" placeholder="Name or phone" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p className="error" role="alert">{error}</p>}
      {!list ? <div className="skel" aria-busy="true"><span /><span /><span /></div> : list.length === 0 ? (
        <div className="empty"><b>{q ? "Nobody matches" : "No customers yet"}</b><span>Customers are saved when you create an order with their number.</span></div>
      ) : (
        <ul className="rows">
          {list.map((c, i) => (
            <li key={c.id} className="row arrive" style={{ ["--i" as string]: i }}>
              <span className="dot" style={{ background: (c.orderCount ?? 0) > 1 ? "var(--ok)" : "var(--line)" }} aria-hidden="true" />
              <span><span className="ttl">{c.name}</span><br /><span className="meta num">{c.phone}{c.addresses[0] ? ` · ${c.addresses[0]}` : ""}{c.addresses.length > 1 ? ` (+${c.addresses.length - 1})` : ""}</span></span>
              <span className="end">
                {(c.orderCount ?? 0) > 1 ? <span className="badge ok">Repeat · {c.orderCount}</span> : <span className="meta">{c.orderCount ?? 0} order{c.orderCount === 1 ? "" : "s"}</span>}
                <span className="inline" style={{ gap: 6 }}>
                  <a className="iconbtn" style={{ width: 38, height: 38 }} href={`https://wa.me/${c.phone.replace(/^0/, "92")}`} target="_blank" rel="noopener" aria-label={`WhatsApp ${c.name}`}><Icon name="chat" size={18} /></a>
                  <Link className="iconbtn" style={{ width: 38, height: 38 }} href={`/orders?q=${encodeURIComponent(c.phone)}`} aria-label={`Orders from ${c.name}`}><Icon name="orders" size={18} /></Link>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
