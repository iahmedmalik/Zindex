// Browser-side calls. Everything goes to this app's own /backend/* address, which Next forwards
// to the API, so the sign-in cookie travels with every call.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Init = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown };

// The free server sleeps when idle and answers 502/503/504 (a page, not JSON) while it wakes, which
// takes up to about a minute. Reading is safe to repeat, so GETs wait for it; writes are never repeated.
const WAKE_TRIES = 15;
const WAKE_PAUSE_MS = 4000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  const method = init.method ?? "GET";
  const tries = method === "GET" ? WAKE_TRIES : 1;
  for (let attempt = 1; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(`/backend/v1${path}`, {
        method,
        headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "same-origin",
      });
    } catch {
      if (attempt >= tries) throw new ApiError(0, "Could not reach the server. Check your internet and try again.");
    }
    if (res) {
      if (res.status === 204) return undefined as T;
      const asleep = [502, 503, 504].includes(res.status);
      if (!asleep || attempt >= tries) {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const text = (data as { error?: string; message?: string }).error ?? (data as { message?: string }).message;
          throw new ApiError(res.status, text ?? (asleep ? `The server is still waking up (${res.status}). Give it a minute and try again.` : `Something went wrong (${res.status}).`));
        }
        return data as T;
      }
    }
    await sleep(WAKE_PAUSE_MS);
  }
}

export const messageOf = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
