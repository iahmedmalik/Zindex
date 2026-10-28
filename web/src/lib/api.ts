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

export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/backend/v1${path}`, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your internet and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string; message?: string }).error ?? (data as { message?: string }).message ?? "Something went wrong.");
  return data as T;
}

export const messageOf = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
