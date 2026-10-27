import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { HttpError } from "./http-error";

// Checks req.body against a zod schema and replaces it with the parsed value.
// Schemas are written with `.strict()` so any unknown field is refused (rule P-1).
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.issues[0];
      const where = first && first.path.length > 0 ? ` (${first.path.join(".")})` : "";
      return next(new HttpError(400, `The request is not valid${where}: ${first?.message ?? "check the values and try again"}`));
    }
    req.body = result.data;
    next();
  };
}
