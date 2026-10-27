// Sending email (verification, password reset) sits behind one small interface so the rest of the
// code never knows which sender is in use: tests keep the mail in memory, development prints it,
// and production sends it through Brevo's free plan.

export type Mail = { to: string; subject: string; text: string };
export type Mailer = { send(mail: Mail): Promise<void> };

/** Keeps every mail in a list. Used by tests to read the verification link. */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    async send(mail) {
      sent.push(mail);
    },
  };
}

/** Development: no account needed, the message is printed where the server runs. */
export function consoleMailer(): Mailer {
  return {
    async send(mail) {
      console.log(`\n--- email to ${mail.to}: ${mail.subject}\n${mail.text}\n---`);
    },
  };
}

/** Brevo's transactional email API (https://developers.brevo.com). The key stays in Render's settings. */
export function brevoMailer(apiKey: string, from: string): Mailer {
  const match = /^(.*)<(.+)>$/.exec(from.trim());
  const sender = match ? { name: match[1]!.trim(), email: match[2]!.trim() } : { email: from.trim() };
  return {
    async send(mail) {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender, to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text }),
      });
      if (!res.ok) throw new Error(`The email service refused the message (${res.status}).`);
    },
  };
}
