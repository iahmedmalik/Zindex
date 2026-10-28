"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, useToast } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { useSession } from "@/lib/session";

const links = [
  { href: "/customers", icon: "users", title: "Customers", sub: "Saved from orders, per store" },
  { href: "/shipments", icon: "truck", title: "Courier parcels", sub: "Tracking numbers and problems" },
  { href: "/reports", icon: "chart", title: "Reports", sub: "Sales, cash and stock, with Excel files" },
  { href: "/settings", icon: "store", title: "Stores and settings", sub: "Stores, Shopify, messages, look, backup" },
  { href: "/how-its-built", icon: "code", title: "How it's built", sub: "The story, the stack and the tests" },
];

export default function MorePage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useSession();
  return (
    <>
      <div className="heading"><h1>More</h1><p className="note">Signed in as {user.name} · {user.email}</p></div>
      <ul className="rows">
        {links.map((l, i) => (
          <li key={l.href} className="arrive" style={{ ["--i" as string]: i }}>
            <Link className="row" href={l.href}>
              <span style={{ color: "var(--brand)" }}><Icon name={l.icon} size={22} /></span>
              <span><span className="ttl">{l.title}</span><br /><span className="meta">{l.sub}</span></span>
              <span style={{ color: "var(--ink-2)" }}><Icon name="right" /></span>
            </Link>
          </li>
        ))}
      </ul>
      <button className="btn quiet" style={{ justifySelf: "start" }} onClick={async () => {
        try { await api("/auth/sign-out", { method: "POST", body: {} }); router.replace("/sign-in"); } catch (e) { toast(messageOf(e), "bad"); }
      }}>Sign out</button>
    </>
  );
}
