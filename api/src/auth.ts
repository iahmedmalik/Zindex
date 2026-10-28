import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Config } from "./config";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import type { Mailer } from "./mailer";

// Owner sign-in with Better Auth: email and password, a verified email, a session cookie.
//
// The web app (on Vercel) and this API (on Render) are different sites, and browsers block
// cookies across sites. So the web app forwards /backend/* to this API, and the cookie belongs
// to the web app's own address. The web app strips the /backend part, so inside this API the
// sign-in routes simply live under /v1/auth.

type AuthConfig = Pick<Config, "BETTER_AUTH_SECRET" | "WEB_ORIGIN" | "isProduction"> & Partial<Pick<Config, "OWNER_EMAILS" | "DEMO_EMAIL">>;

const addressList = (list?: string) => (list ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
type AuthOptions = {
  /** Turn the sign-in rate limiter on outside production (tests do this). */
  rateLimit?: { enabled: boolean; signInMax?: number };
};

export function createAuth(db: Db, config: AuthConfig, mailer: Mailer, options: AuthOptions = {}) {
  const owners = addressList(config.OWNER_EMAILS);
  const demo = addressList(config.DEMO_EMAIL);
  const invited = (email: string) => owners.length === 0 || owners.includes(email.toLowerCase()) || demo.includes(email.toLowerCase());
  const isDemo = (email: string) => demo.includes(email.toLowerCase());
  const refusal = "Zindex is by invitation only. Ask the owner for access.";
  const demoRefusal = "Not available in the demo.";
  const limiterOn = config.isProduction || options.rateLimit?.enabled === true;
  return betterAuth({
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.WEB_ORIGIN,
    basePath: "/v1/auth",
    trustedOrigins: [config.WEB_ORIGIN],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // An address must be proved before the account can sign in.
      requireEmailVerification: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        if (isDemo(user.email)) return;
        await mailer.send({
          to: user.email,
          subject: "Reset your Zindex password",
          text: `Hello ${user.name},\n\nUse this link to choose a new password (it works for one hour):\n${url}\n\nIf you did not ask for this, you can ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Signing up again with a known address sends nothing (so nobody can probe who has an account), so the
      // way to get a new link is to try to sign in: an unconfirmed address is sent a fresh one.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        if (isDemo(user.email)) return; // the demo address is made already verified, and nobody reads its mail
        await mailer.send({
          to: user.email,
          subject: "Confirm your email for Zindex",
          text: `Hello ${user.name},\n\nConfirm your email address to start using Zindex (the link works for 24 hours):\n${url}\n\nIf you did not sign up, you can ignore this email.`,
        });
      },
    },
    // Sign-up is by invitation: with OWNER_EMAILS set, only those addresses (and the demo) can create an account.
    // The first check answers the sign-up request with a clear 403; Better Auth would otherwise hide a refusal
    // from the database hook behind a fake success. The database hook is the second lock.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (ctx.path === "/sign-up/email") {
          if (typeof email === "string" && !invited(email)) throw new APIError("FORBIDDEN", { message: refusal });
          return;
        }
        // The public demo account keeps its password and address, and cannot be deleted.
        if (["/change-password", "/change-email", "/delete-user", "/set-password"].includes(ctx.path)) {
          const session = await getSessionFromCtx(ctx);
          if (session && isDemo(session.user.email)) throw new APIError("FORBIDDEN", { message: demoRefusal });
        }
        if (ctx.path === "/request-password-reset" && typeof email === "string" && isDemo(email)) throw new APIError("FORBIDDEN", { message: demoRefusal });
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!invited(user.email)) throw new APIError("FORBIDDEN", { message: refusal });
            return { data: { ...user, emailVerified: isDemo(user.email) ? true : user.emailVerified } };
          },
        },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    // Guessing passwords and mass sign-ups are slowed down per address and per path.
    rateLimit: {
      enabled: limiterOn,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: options.rateLimit?.signInMax ?? 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 3 },
        "/request-password-reset": { window: 60, max: 3 },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
