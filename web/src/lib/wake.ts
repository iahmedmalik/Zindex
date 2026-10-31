"use client";

import { useCallback, useEffect, useState } from "react";

// The free server sleeps when nobody uses it and takes about 30 seconds to wake. Pages that start with a write
// (sign-in, "Try the demo") cannot just try and retry, because writes are never repeated. So they first ask
// /health, which is a harmless read, until the server answers.
const HEALTH_URL = "/backend/health";
const CHECK_TIMEOUT_MS = 8000; // one ask; a sleeping server often never answers
const PAUSE_MS = 3000; // between asks
const GIVE_UP_S = 90;
const SHOW_AFTER_MS = 1200; // a server that is already awake answers faster, and then nothing flashes on screen

export async function serverIsAwake(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { cache: "no-store", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/** checking: first ask, nothing shown yet · waking: the card shows · awake: go ahead · down: gave up after 90 s */
export type WakePhase = "checking" | "waking" | "awake" | "down";

export function useWake() {
  const [phase, setPhase] = useState<WakePhase>("checking");
  const [seconds, setSeconds] = useState(0);
  const [wasAsleep, setWasAsleep] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    setPhase("checking");
    setSeconds(0);
    setWasAsleep(false);

    // The clock on the card, and the moment the card first appears.
    const clock = setInterval(() => {
      setSeconds(Math.floor(elapsed() / 1000));
      if (elapsed() >= SHOW_AFTER_MS) {
        setPhase((p) => (p === "checking" ? "waking" : p));
        setWasAsleep(true);
      }
    }, 500);

    void (async () => {
      while (!stopped) {
        if (await serverIsAwake()) {
          if (!stopped) setPhase("awake");
          return;
        }
        if (elapsed() >= GIVE_UP_S * 1000) {
          if (!stopped) setPhase("down");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      }
    })().finally(() => clearInterval(clock));

    return () => {
      stopped = true;
      clearInterval(clock);
    };
  }, [round]);

  const again = useCallback(() => setRound((r) => r + 1), []);
  return { phase, seconds, wasAsleep, awake: phase === "awake", again };
}
