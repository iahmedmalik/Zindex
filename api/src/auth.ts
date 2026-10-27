import { betterAuth } from "better-auth";
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

type AuthConfig = Pick<Config, "BETTER_AUTH_SECRET" | "WEB_ORIGIN" | "isProduction">;
type AuthOptions = {
  /** Turn the sign-in rate limiter on outside production (tests do this). */
  rateLimit?: { enabled: boolean; signInMax?: number };
};

export function createAuth(db: Db, config: AuthConfig, mailer: Mailer, options: AuthOptions = {}) {
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
      // Anyone can sign up, so an address must be proved before the account can sign in.
      requireEmailVerification: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send({
          to: user.email,
          subject: "Reset your Zindex password",
          text: `Hello ${user.name},\n\nUse this link to choose a new password (it works for one hour):\n${url}\n\nIf you did not ask for this, you can ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.send({
          to: user.email,
          subject: "Confirm your email for Zindex",
          text: `Hello ${user.name},\n\nConfirm your email address to start using Zindex (the link works for 24 hours):\n${url}\n\nIf you did not sign up, you can ignore this email.`,
        });
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
