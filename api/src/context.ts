import { createAuth } from "./auth";
import type { AppContext } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { brevoMailer, consoleMailer } from "./mailer";

/** Reads the settings, opens the database and builds sign-in: everything the app needs, shared by the Render server and the Vercel entry. */
export function buildContext(): AppContext {
  const config = loadConfig();
  const { db } = createDb(config.DATABASE_URL_APP);
  const mailer = config.BREVO_API_KEY ? brevoMailer(config.BREVO_API_KEY, config.MAIL_FROM) : consoleMailer();
  return { config, db, auth: createAuth(db, config, mailer) };
}
