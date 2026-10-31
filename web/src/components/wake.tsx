"use client";

import { useEffect, useState } from "react";
import { WAKING_EVENT } from "@/lib/api";
import type { WakePhase } from "@/lib/wake";

/** The van driving along the dashed route to the pin: the same trip as the rest of the app. */
function Trip() {
  return (
    <svg className="wake-trip" viewBox="0 0 300 64" fill="none" aria-hidden="true">
      <path d="M0 52H300" stroke="var(--line)" strokeWidth="3" strokeDasharray="6 8" />
      <g className="wake-van">
        <rect x="6" y="20" width="30" height="20" rx="4" fill="var(--brand-hi)" />
        <path d="M36 26H50L56 35V40H36Z" fill="var(--brand-hi)" opacity=".75" />
        <circle className="g-wheel" cx="17" cy="43" r="6" fill="var(--ink)" />
        <circle className="g-wheel" cx="47" cy="43" r="6" fill="var(--ink)" />
      </g>
      {/* position and pulse live on two layers: an animation on the same element would replace its position */}
      <g transform="translate(274 8)">
        <g className="wake-pin">
          <path d="M10 40C2 28 0 24 0 16a10 10 0 0 1 20 0c0 8-2 12-10 24Z" fill="var(--brand-hi)" />
          <circle cx="10" cy="16" r="4" fill="var(--surface)" />
        </g>
      </g>
    </svg>
  );
}

/** Sits above the sign-in form while the server wakes. Nothing at all when it was awake at once. */
export function WakeCard({ phase, seconds, wasAsleep, onAgain }: { phase: WakePhase; seconds: number; wasAsleep: boolean; onAgain: () => void }) {
  if (phase === "waking") {
    return (
      <div className="well wake arrive" role="status" key="waking">
        <h2>Waking Zindex up</h2>
        <p className="note">This takes about 30 seconds, then you&apos;re in.</p>
        <Trip />
        <div className="wake-tick"><span className="note">Starting the server…</span><b className="num">{seconds} s</b></div>
      </div>
    );
  }
  if (phase === "down") {
    return (
      <div className="well wake arrive" role="alert" key="down">
        <h2>Can&apos;t reach the server</h2>
        <p className="note">It may be down, or your internet dropped. Check your connection and try again.</p>
        <button type="button" className="btn" onClick={onAgain}>Try again</button>
      </div>
    );
  }
  if (phase === "awake" && wasAsleep) {
    return (
      <div className="well wake arrive" role="status" key="awake">
        <div className="wake-ok">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="2" /><path className="wake-tick-mark" d="M7 12.5l3.5 3.5L17 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Zindex is awake
        </div>
      </div>
    );
  }
  return null;
}

/**
 * A quiet bar at the top while the signed-in app is waiting for the server (api() tells us through an event).
 * It stays mounted for one motion duration after the wait ends, so it leaves with the same motion it arrived with.
 */
export function WakeBar() {
  const [waking, setWaking] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const on = (e: Event) => setWaking(Boolean((e as CustomEvent<boolean>).detail));
    addEventListener(WAKING_EVENT, on);
    return () => removeEventListener(WAKING_EVENT, on);
  }, []);

  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (waking) {
      setLeaving(false);
      setShown(true);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const t = setTimeout(() => { setShown(false); setLeaving(false); }, 260);
    return () => clearTimeout(t);
  }, [waking, shown]);

  if (!shown) return null;
  return (
    <div className={`wakebar${leaving ? " leaving" : ""}`} role="status">
      <span className="wake-dot" aria-hidden="true" />
      <span><b>Waking the server…</b> your orders will appear in a moment.</span>
    </div>
  );
}
