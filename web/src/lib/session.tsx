"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { Store } from "./types";

// Who is signed in and which stores they have. "All stores" is the null selection.
type Session = {
  user: { id: string; name: string; email: string; demo?: boolean };
  stores: Store[];
  storeId: string | null; // the chosen store, or null for all stores
  store: Store | null;
  select: (id: string | null) => void;
  reload: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside <SessionProvider>");
  return s;
};

const KEY = "zindex.store";

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState<Session["user"] | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const me = await api<{ user: Session["user"] }>("/me");
      const list = await api<{ stores: Store[] }>("/stores");
      setUser(me.user);
      setStores(list.stores);
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(KEY);
      } catch {}
      setStoreId(saved && list.stores.some((s) => s.id === saved) ? saved : null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace(`/sign-in?next=${encodeURIComponent(path)}`);
      else setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }, [router, path]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback((id: string | null) => {
    setStoreId(id);
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {}
  }, []);

  const value = useMemo<Session | null>(
    () => (user ? { user, stores, storeId, store: stores.find((s) => s.id === storeId) ?? null, select, reload } : null),
    [user, stores, storeId, select, reload],
  );

  if (error) return <div className="solo"><div className="panel"><p className="error" role="alert">{error}</p><button className="btn" onClick={() => { setError(null); void reload(); }}>Try again</button></div></div>;
  // The free server sleeps when nobody uses it; api() keeps waiting for it, so this screen can last up to a minute.
  if (!value) return <div className="solo" aria-busy="true"><div className="panel"><div className="skel"><span /><span /><span /></div><p className="note">Opening your shop…</p></div></div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
