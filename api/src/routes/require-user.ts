import { fromNodeHeaders } from "better-auth/node";
import type { RequestHandler } from "express";
import type { Auth } from "../auth";
import { HttpError } from "../http-error";

export type SignedInUser = { id: string; name: string; email: string };

declare module "express-serve-static-core" {
  interface Request {
    user?: SignedInUser;
  }
}

// Looks up the session cookie. Without a valid session the request stops here with a 401,
// before any route code (or any database query) runs.
export function requireUser(auth: Auth): RequestHandler {
  return async (req, _res, next) => {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) return next(new HttpError(401, "Please sign in."));
      req.user = { id: session.user.id, name: session.user.name, email: session.user.email };
      next();
    } catch (err) {
      next(err);
    }
  };
}
