import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { brevoMailer, consoleMailer } from "./mailer";

const config = loadConfig();
const { db } = createDb(config.DATABASE_URL_APP);
const mailer = config.BREVO_API_KEY ? brevoMailer(config.BREVO_API_KEY, config.MAIL_FROM) : consoleMailer();

createApp({ config, db, auth: createAuth(db, config, mailer) }).listen(config.PORT, () => {
  console.log(`Zindex API listening on port ${config.PORT}`);
});
