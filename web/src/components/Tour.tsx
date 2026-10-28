"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Step = { target: string; title: string; body: string };
type Box = { top: number; left: number; width: number; height: number };

const STEPS: Step[] = [
  { target: ".hero", title: "Today at a glance", body: "Sales so far today, how many orders came in and how many are out for delivery. The van drives while there is work on the road." },
  { target: ".tiles", title: "What needs you", body: "Each tile counts the orders waiting at one stage. Tap a tile to open them. A tile at 0 stays quiet." },
  { target: ".tabs .new", title: "A new order in seconds", body: "Type the customer's WhatsApp number, pick items, choose paid or cash on delivery. The form shows what the rider will collect at the door." },
  { target: '.tabs a[href="/products"]', title: "Stock you can trust", body: "Stock goes down once, when you confirm an order. A mistake is fixed with a new entry, never by editing the past." },
  { target: '.tabs a[href="/more"]', title: "Stores, messages and more", body: "Add stores, edit your WhatsApp messages, see customers and reports, and read how Zindex is built. You can replay this tour from here." },
];

const PAD = 8;
const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const measure = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
};

const visible = (el: HTMLElement | null): el is HTMLElement => !!el && el.getClientRects().length > 0; // not offsetParent: a fixed button has none

/**
 * A short tour: it dims the page, lights one part and says what it is for. While it is open the page is
 * frozen and only its own box works (Next, Skip, Escape). A step whose part is not on the page is passed
 * over. The light and the box use the app's motion tokens; with reduced motion they fade and do not glide.
 */
export function Tour({ open, onClose }: { open: boolean; onClose: (completed: boolean) => void }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false); // the text is shown only while the light rests on a part
  const nextRef = useRef<HTMLButtonElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const finish = useCallback((completed: boolean) => {
    setBox(null);
    setReady(false);
    setIndex(0);
    onClose(completed);
  }, [onClose]);

  // Which steps have a part on this page right now.
  useEffect(() => {
    if (!open) return;
    const found = STEPS.filter((s) => visible(document.querySelector<HTMLElement>(s.target)));
    if (found.length === 0) { finish(false); return; }
    setSteps(found);
  }, [open, finish]);

  // Freeze the page: the scrollbar's width is replaced with padding so nothing shifts.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const before = { overflow: html.style.overflow, padding: document.body.style.paddingRight };
    const bar = window.innerWidth - html.clientWidth;
    html.style.overflow = "hidden";
    if (bar > 0) document.body.style.paddingRight = `${bar}px`;
    return () => { html.style.overflow = before.overflow; document.body.style.paddingRight = before.padding; };
  }, [open]);

  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;
    const stop = (e: Event) => e.preventDefault();
    root.addEventListener("wheel", stop, { passive: false });
    root.addEventListener("touchmove", stop, { passive: false });
    return () => { root.removeEventListener("wheel", stop); root.removeEventListener("touchmove", stop); };
  }, [open, box === null]);

  // Escape closes the tour from anywhere, even before focus has reached the card.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  // Go to the current step: scroll it into view, then light it.
  useEffect(() => {
    const step = steps[index];
    if (!open || !step) return;
    let cancelled = false;
    (async () => {
      setReady(false);
      const el = document.querySelector<HTMLElement>(step.target);
      if (!visible(el)) { if (index < steps.length - 1) setIndex(index + 1); else finish(true); return; }
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";
      const r = el.getBoundingClientRect();
      if (r.top < 24 || r.bottom > window.innerHeight - 24) {
        el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
        await settle(calm ? 60 : 450);
      }
      if (cancelled) return;
      setBox(measure(el));
      await settle(calm ? 0 : 220);
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [open, steps, index, finish]);

  useEffect(() => {
    if (!open || steps.length === 0) return;
    const onResize = () => {
      const el = document.querySelector<HTMLElement>(steps[index]?.target ?? "");
      if (visible(el)) setBox(measure(el));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, steps, index]);

  useEffect(() => { if (ready) nextRef.current?.focus({ preventScroll: true }); }, [ready, index]);

  if (!open || !box || steps.length === 0) return null;
  const step = steps[index]!;
  const last = index === steps.length - 1;
  const width = Math.min(340, window.innerWidth - 32);
  const below = window.innerHeight - (box.top + box.height) > 220;
  const left = Math.max(16, Math.min(window.innerWidth - width - 16, box.left));
  const top = below ? box.top + box.height + 12 : Math.max(16, box.top - 12 - 200);

  return createPortal(
    <div
      ref={rootRef}
      className="tour"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          // Keep the keyboard inside the card: Tab and Shift+Tab go round its buttons.
          e.preventDefault();
          const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".tour-card button")];
          const at = all.indexOf(document.activeElement as HTMLButtonElement);
          all[(at + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus({ preventScroll: true });
        }
      }}
    >
      <div className="tour-light" aria-hidden="true" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
      <div className={`tour-card${ready ? " on" : ""}`} style={{ top, left, width }}>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-actions">
          <span className="note">Step {index + 1} of {steps.length}</span>
          {index > 0 && <button className="btn quiet small" onClick={() => setIndex(index - 1)}>Back</button>}
          <button ref={skipRef} className="btn quiet small" onClick={() => finish(true)}>Skip tour</button>
          <button ref={nextRef} className="btn small" onClick={() => (last ? finish(true) : setIndex(index + 1))}>{last ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
