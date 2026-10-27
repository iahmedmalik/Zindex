import type { Request } from "express";
import { HttpError } from "../http-error";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads a uuid from the URL; anything else is simply "not found", never a database error. */
export function idParam(req: Request, name: string, what: string): string {
  const id = String(req.params[name]);
  if (!uuid.test(id)) throw new HttpError(404, `${what} not found.`);
  return id;
}

export const storeIdOf = (req: Request) => idParam(req, "storeId", "Store");
