"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Shared parts of the Zindex look: icons, the journey line, segmented controls, a counting number,
// toasts. Every one of them moves with the motion tokens in globals.css.

const paths: Record<string, ReactNode> = {
  mark: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M8 8.5h8l-8 7h8" /></>,
  today: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  orders: <><path d="M7 4h10a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1z" /><path d="M9 9h6M9 13h4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>,
  minus: <path d="M6 12h12" />,
  stock: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
  more: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  phone: <path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" />,
  chat: <><path d="M4 19.5 5.2 16A8 8 0 1 1 8 18.8z" /><path d="M9 10.5h6M9 13.5h4" /></>,
  down: <path d="m6 9 6 6 6-6" />,
  right: <path d="m9 6 6 6-6 6" />,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  bike: <><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M6 17h6l3-7h3M9 10h3l3 7" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10" r="2.3" /></>,
  print: <><path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M7 14h10v6H7z" /></>,
  share: <><path d="M12 15V4m-4 4 4-4 4 4" /><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  cash: <><rect x="3" y="6.5" width="18" height="11" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
  truck: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  download: <><path d="M12 4v11m-4-4 4 4 4-4" /><path d="M5 19h14" /></>,
  upload: <><path d="M12 15V4m-4 4 4-4 4 4" /><path d="M5 19h14" /></>,
  users: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 19.5a6.5 6.5 0 0 0-2-4.7" /></>,
  store: <><path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16v10H4zM4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5S13.3 15 14.5 15H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7.5" r="1" /><circle cx="15" cy="8" r="1" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
};

export function Icon({ name, size = 20, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/** The journey line. Each step is done, now (the current one) or still to come. */
export function Journey({ steps, at, counts, onPick, label }: { steps: string[]; at: number; counts?: number[]; onPick?: (i: number) => void; label: string }) {
  return (
    <ol className="journey" style={{ ["--n" as string]: steps.length, ["--at" as string]: counts ? 0 : Math.min(Math.max(0, at), steps.length - 1) }} aria-label={label}>
      {steps.map((s, i) => {
        const state = counts ? ((counts[i] ?? 0) > 0 ? "has" : "") : i < at ? "done" : i === at ? "now" : "";
        const inner = counts ? <Count value={counts[i] ?? 0} /> : i < at ? <Icon name="check" size={16} /> : String(i + 1);
        return (
          <li key={s} className={state} aria-current={!counts && i === at ? "step" : undefined}>
            {onPick ? <button type="button" className="node" onClick={() => onPick(i)} aria-label={`${counts?.[i] ?? ""} ${s}`}>{inner}</button> : <span className="node">{inner}</span>}
            <span>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

const reducedMotion = () => typeof document !== "undefined" && (document.documentElement.dataset.motion === "reduced" || (document.documentElement.dataset.motion !== "full" && matchMedia("(prefers-reduced-motion: reduce)").matches));

/** A number that counts to its new value with the arrival easing; instant with reduced motion. */
export function Count({ value, money }: { value: number; money?: boolean }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion() || from.current === value) { setShown(value); from.current = value; return; }
    const start = from.current, t0 = performance.now(), dur = 380;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      setShown(Math.round(start + (value - start) * (1 - Math.pow(1 - t, 4))));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <span className="num">{money ? shown.toLocaleString("en-US") : shown}</span>;
}

/** A segmented control whose thumb slides to the chosen option. */
export function Seg<T extends string>({ options, value, onChange, label }: { options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; label: string }) {
  const at = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div className="seg" role="radiogroup" aria-label={label} style={{ ["--n" as string]: options.length, ["--at" as string]: at }}>
      <span className="thumb" aria-hidden="true" />
      {options.map(([v, text]) => (
        <label key={v}>
          <input type="radio" name={label} checked={v === value} onChange={() => onChange(v)} />
          {text}
        </label>
      ))}
    </div>
  );
}

/** A button that turns into a tick for a moment after it worked. */
export function DoneButton({ children, done, className = "btn", ...rest }: { children: ReactNode; done: ReactNode; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [ok, setOk] = useState(false);
  return (
    <button
      {...rest}
      className={`${className}${ok ? " done" : ""}`}
      onClick={async (e) => {
        const r = rest.onClick?.(e) as unknown;
        if (r instanceof Promise) { try { await r; } catch { return; } }
        setOk(true);
        setTimeout(() => setOk(false), 1600);
      }}
    >
      <span className="swap"><span className="a">{children}</span><span className="b"><Icon name="check" size={18} />{done}</span></span>
    </button>
  );
}

// Toasts: one at a time, they confirm an action and leave on their own.
const ToastCtx = createContext<(text: string, tone?: "ok" | "bad") => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad"; n: number } | null>(null);
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    setMsg((m) => ({ text, tone, n: (m?.n ?? 0) + 1 }));
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), tone === "bad" ? 4200 : 2400);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className={`toast${show ? " show" : ""}${msg?.tone === "bad" ? " bad" : ""}`} role={msg?.tone === "bad" ? "alert" : "status"} aria-live="polite">{msg?.text}</div>
    </ToastCtx.Provider>
  );
}

/**
 * A card over the page: it rises from the bottom on a phone and sits in the middle on a laptop, with the page blurred
 * behind it. It stays mounted for a moment after closing so it can leave with the same easing it arrived with.
 */
export function Dialog({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [on, setOn] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
      return () => cancelAnimationFrame(frame);
    }
    setOn(false);
    const gone = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(gone);
  }, [open]);
  useEffect(() => {
    if (!on) return;
    card.current?.querySelector<HTMLElement>("[data-first]")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className={`dlg-scrim${on ? " on" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label={label} ref={card}>{children}</div>
    </div>,
    document.body,
  );
}

export type ConfirmOptions = { title: string; body?: ReactNode; confirm: string; danger?: boolean; tick?: { label: string; checked: boolean } };
type Asked = ConfirmOptions & { resolve: (r: { ok: boolean; ticked: boolean }) => void };
const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<{ ok: boolean; ticked: boolean }>>(async () => ({ ok: false, ticked: false }));
/** `const { ok, ticked } = await confirm({ title, body, confirm: "Delete" })`: the app's own confirm card, not the browser's box. */
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [asked, setAsked] = useState<Asked | null>(null);
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState(false);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<{ ok: boolean; ticked: boolean }>((resolve) => {
    setAsked({ ...o, resolve });
    setTicked(o.tick?.checked ?? false);
    setOpen(true);
  }), []);
  const answer = (ok: boolean) => { setOpen(false); asked?.resolve({ ok, ticked }); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog open={open} onClose={() => answer(false)} label={asked?.title ?? "Confirm"}>
        <h2>{asked?.title}</h2>
        {asked?.body && <div className="note stack" style={{ gap: 8 }}>{asked.body}</div>}
        {asked?.tick && (
          <label className="inline" style={{ gap: 10 }}>
            <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
            <span>{asked.tick.label}</span>
          </label>
        )}
        <div className="dlg-actions">
          <button type="button" className="btn quiet" data-first onClick={() => answer(false)}>Keep it</button>
          <button type="button" className={`btn${asked?.danger ? " danger-solid" : ""}`} onClick={() => answer(true)}>{asked?.confirm}</button>
        </div>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}
