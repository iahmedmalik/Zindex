"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { Icon } from "@/components/ui";

const RETRY_EVERY_S = 8;
const AUTO_TRIES = 5;

/** A lost connection, a sleeping server, or a page file that changed since this tab opened. Anything else is "on us". */
export function isConnectionError(error: unknown): boolean {
  if (error instanceof ApiError) return [0, 502, 503, 504].includes(error.status);
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /failed to fetch|network|load failed|chunk|could not reach|waking up/i.test(text);
}

/**
 * The calm screen shown instead of a crash. A connection problem tries again by itself every 8 s (five times),
 * anything else waits for the button. `retry` re-fetches and re-renders the part of the page that broke.
 */
export function ErrorPanel({ error, retry }: { error: unknown; retry: () => void }) {
  const connection = isConnectionError(error);
  const [left, setLeft] = useState(RETRY_EVERY_S);
  const [rounds, setRounds] = useState(0);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;

  useEffect(() => {
    console.error(error);
  }, [error]);

  useEffect(() => {
    if (!connection || rounds >= AUTO_TRIES) return;
    const t = setInterval(() => {
      setLeft((n) => {
        if (n > 1) return n - 1;
        setRounds((r) => r + 1);
        retry();
        return RETRY_EVERY_S;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [connection, rounds, retry]);

  return (
    <main className="solo err-solo">
      <div className="well err-panel arrive" role="alert">
        <span className="err-ico" aria-hidden="true"><Icon name={connection ? "wifi-off" : "alert"} size={26} /></span>
        <h1>{connection ? "Can’t reach the server" : "Something went wrong"}</h1>
        <p className="muted">
          {connection
            ? "It may still be waking up, or your internet dropped."
            : "That’s on us, not you. Try again, and if it keeps happening, go back to Today."}
        </p>
        <button type="button" className="btn" onClick={retry}>Try again</button>
        {!connection && <a className="btn quiet" href="/">Go to Today</a>}
        {connection && rounds < AUTO_TRIES && <p className="note err-count"><span className="wake-dot" aria-hidden="true" />Trying again in <b className="num">{left}</b> s</p>}
        {digest && <p className="note err-ref">Reference: {digest}</p>}
      </div>
    </main>
  );
}
