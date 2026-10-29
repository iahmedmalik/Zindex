"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo, RouteBackdrop } from "@/components/graphics";
import { Tour } from "@/components/Tour";
import { ConfirmProvider, Icon, ToastProvider } from "@/components/ui";
import { apply, load } from "@/lib/appearance";
import { api } from "@/lib/api";
import { SessionProvider, useSession } from "@/lib/session";

const tabs = [
  { href: "/", label: "Today", icon: "today" },
  { href: "/orders", label: "Orders", icon: "orders" },
  { href: "/orders/new", label: "New order", icon: "plus", fab: true },
  { href: "/products", label: "Stock", icon: "stock" },
  { href: "/more", label: "More", icon: "more" },
];

export const TOUR_NOW = "zindex.tour.now"; // set when the demo starts or the tour is replayed
export const TOUR_SEEN = "zindex.tour.seen.";

const allDot = (colors: string[]) => (colors.length > 1 ? `conic-gradient(${colors.map((c, i) => `${c} ${(i * 100) / colors.length}% ${((i + 1) * 100) / colors.length}%`).join(", ")})` : (colors[0] ?? "var(--brand)"));

function StoreSheet({ open, close }: { open: boolean; close: () => void }) {
  const { stores, storeId, select } = useSession();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    first.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, close]);
  const choose = (id: string | null) => { select(id); setTimeout(close, 120); };
  return (
    <>
      <div className={`scrim${open ? " open" : ""}`} onClick={close} aria-hidden="true" />
      <div className={`sheet${open ? " open" : ""}`} role="dialog" aria-modal={open} aria-label="Choose a store" aria-hidden={!open}>
        <div className="grab" />
        <h3 style={{ padding: "0 8px 4px" }}>Show</h3>
        <button ref={first} className="opt" role="menuitemradio" aria-checked={storeId === null} onClick={() => choose(null)} tabIndex={open ? 0 : -1}>
          <span className="dot" style={{ background: allDot(stores.map((s) => s.accent)) }} />All stores<span className="check"><Icon name="check" /></span>
        </button>
        {stores.map((s) => (
          <button key={s.id} className="opt" role="menuitemradio" aria-checked={storeId === s.id} onClick={() => choose(s.id)} tabIndex={open ? 0 : -1}>
            <span className="dot" style={{ background: s.accent }} />{s.name}<span className="check"><Icon name="check" /></span>
          </button>
        ))}
      </div>
    </>
  );
}

function Chrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { stores, store, user } = useSession();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [tour, setTour] = useState(false);
  useEffect(() => apply(load()), []);
  useEffect(() => setSheet(false), [path]);

  // The tour opens on Today: every time the demo is started (or "Replay the tour" is pressed), and on a
  // normal owner's first sign-in. It waits until Today has drawn the parts it points at.
  useEffect(() => {
    if (path !== "/") return;
    let wanted = false;
    try {
      wanted = sessionStorage.getItem(TOUR_NOW) === "1" || (!user.demo && !localStorage.getItem(`${TOUR_SEEN}${user.id}`));
    } catch {}
    if (!wanted) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (document.querySelector(".hero") || ++tries > 20) { clearInterval(timer); if (document.querySelector(".hero")) setTour(true); }
    }, 300);
    return () => clearInterval(timer);
  }, [path, user.id, user.demo]);

  const closeTour = useCallback((completed: boolean) => {
    setTour(false);
    try {
      sessionStorage.removeItem(TOUR_NOW);
      if (completed) localStorage.setItem(`${TOUR_SEEN}${user.id}`, "1");
    } catch {}
  }, [user.id]);
  const active = (href: string) =>
    href === "/" ? path === "/" : href === "/orders" ? path === "/orders" || (path.startsWith("/orders/") && path !== "/orders/new") : href === "/more" ? ["/more", "/customers", "/reports", "/shipments", "/settings"].some((p) => path.startsWith(p)) : path.startsWith(href);

  return (
    <div className="app">
      <RouteBackdrop />
      <header className="bar">
        <Link className="mark" href="/"><Logo size={26} />Zindex</Link>
        <span className="spacer" />
        <Link className="note" href="/how-its-built" style={{ textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap" }}>How it&apos;s built</Link>
        {stores.length > 0 && path === "/" && (
          <button className="store-pill" onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet}>
            <span className="dot" style={{ background: store ? store.accent : allDot(stores.map((s) => s.accent)) }} />
            <span>{store ? store.name : "All stores"}</span>
            <Icon name="down" size={16} />
          </button>
        )}
        {stores.length > 0 && path !== "/" && (
          <span className="store-pill static" aria-label={`Showing ${store ? store.name : "all stores"}`}>
            <span className="dot" style={{ background: store ? store.accent : allDot(stores.map((s) => s.accent)) }} />
            <span>{store ? store.name : "All stores"}</span>
          </span>
        )}
      </header>
      <main>
        {user.demo && (
          <div className="demo-note arrive" role="status">
            <span>You&apos;re in the demo. Everything here is made up, and it resets every day.</span>
            <button className="linkbtn" onClick={async () => { try { await api("/auth/sign-out", { method: "POST", body: {} }); } finally { router.replace("/sign-in"); } }}>Sign out</button>
          </div>
        )}
        {children}
      </main>
      <Tour open={tour} onClose={closeTour} />
      <nav className="tabs" aria-label="Main">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={t.fab ? "new" : undefined} aria-label={t.fab ? t.label : undefined} aria-current={active(t.href) ? "page" : undefined}>
            <Icon name={t.icon} size={t.fab ? 26 : 24} />
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
      <StoreSheet open={sheet} close={() => setSheet(false)} />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <ConfirmProvider>
          <Chrome>{children}</Chrome>
        </ConfirmProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
