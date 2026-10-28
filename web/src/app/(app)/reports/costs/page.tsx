"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { pkr } from "@/lib/format";
import { useSession } from "@/lib/session";

type Group = { productId: string | null; name: string; lines: number; units: number; sales: number; currentCost: number | null; storeId: string; storeName: string };

// The sold items that have no cost, grouped by product (or typed name). Profit leaves them out until a cost is set here.
// Setting a cost only fills lines that have none; a product's cost changing never reaches back into old sales.
export default function CostsToFillIn() {
  const { stores, storeId } = useSession();
  const toast = useToast();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [gone, setGone] = useState<Set<string>>(new Set());

  const keyOf = (g: Group) => `${g.storeId}:${g.productId ?? `n:${g.name}`}`;

  const load = useCallback(async () => {
    try {
      const targets = storeId ? stores.filter((s) => s.id === storeId) : stores;
      const lists = await Promise.all(targets.map(async (s) => (await api<{ groups: Omit<Group, "storeId" | "storeName">[] }>(`/stores/${s.id}/missing-costs`)).groups.map((g) => ({ ...g, storeId: s.id, storeName: s.name }))));
      setGroups(lists.flat().sort((a, b) => b.sales - a.sales));
      setGone(new Set());
    } catch (err) {
      toast(messageOf(err), "bad");
      setGroups([]);
    }
  }, [stores, storeId, toast]);
  useEffect(() => { void load(); }, [load]);

  async function save(g: Group) {
    const k = keyOf(g);
    const value = costs[k];
    if (value === undefined || value === "") return;
    try {
      const r = await api<{ updated: number }>(`/stores/${g.storeId}/missing-costs/fill`, { method: "POST", body: { ...(g.productId ? { productId: g.productId } : { name: g.name }), unitCost: Number(value) } });
      setGone((s) => new Set(s).add(k));
      toast(`${g.name}: cost set on ${r.updated} sold line${r.updated === 1 ? "" : "s"}`);
      setTimeout(() => void load(), 320);
    } catch (err) {
      toast(messageOf(err), "bad");
    }
  }

  return (
    <>
      <div className="heading">
        <Link href="/reports" className="note" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}><Icon name="back" size={16} />Reports</Link>
        <h1>Costs to fill in</h1>
        <p className="note">Sold items with no cost are left out of profit. Set the cost for one piece, and only the sales that have none get it. Sales that already have a cost are never changed.</p>
      </div>
      {!groups ? <div className="skel" aria-busy="true"><span /><span /><span /></div> : groups.length === 0 ? (
        <div className="empty"><b>Every sold item has a cost</b><span>Profit in Reports is complete.</span></div>
      ) : (
        <ul className="rows">
          {groups.map((g, i) => {
            const k = keyOf(g);
            return (
              <li key={k} className={`collapse arrive${gone.has(k) ? " gone" : ""}`} style={{ ["--i" as string]: i }}>
                <div>
                  <form className="well" onSubmit={(e) => { e.preventDefault(); void save(g); }}>
                    <div className="inline between">
                      <b>{g.name}</b>
                      <span className="note num">{pkr(g.sales)} sold</span>
                    </div>
                    <p className="note">{!storeId && `${g.storeName} · `}{g.units} piece{g.units === 1 ? "" : "s"} in {g.lines} sale{g.lines === 1 ? "" : "s"}{g.productId ? "" : " · typed item"}</p>
                    <div className="inline" style={{ alignItems: "end" }}>
                      <label className="field" style={{ flex: 1, minWidth: 140 }}><span>Cost per pc</span><input className="input num" inputMode="numeric" aria-label={`Cost per pc of ${g.name}`} value={costs[k] ?? ""} placeholder="0" onChange={(e) => setCosts({ ...costs, [k]: e.target.value.replace(/\D/g, "") })} /></label>
                      <button className="btn" disabled={!(costs[k] ?? "")}>Set cost</button>
                      {g.currentCost !== null && <button type="button" className="btn quiet" onClick={() => setCosts({ ...costs, [k]: String(g.currentCost) })}>Use today&apos;s {pkr(g.currentCost)}</button>}
                    </div>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
