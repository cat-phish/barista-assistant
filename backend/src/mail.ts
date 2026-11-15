// Sending mail through the server's own SMTP account (docs/api/auth.md §1d).
// Optional: with no SMTP_HOST the server can't send mail, and the features
// that need it (email verification) stay off.
import nodemailer, { type Transporter } from "nodemailer";
import { secretIfSet } from "@barista/shared/env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}
export type MailSender = (mail: Mail) => Promise<void>;

export const mailConfigured = (): boolean => Boolean(process.env.SMTP_HOST?.trim() && process.env.MAIL_FROM?.trim());

let override: MailSender | null = null;
// Tests capture mail here instead of connecting anywhere.
export function setMailSender(sender: MailSender | null): void {
  override = sender;
}

let transport: Transporter | null = null;
function smtp(): Transporter {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER?.trim();
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim(),
    port,
    secure: process.env.SMTP_SECURE?.trim().toLowerCase() === "true" || port === 465, // else STARTTLS when offered
    requireTLS: process.env.SMTP_REQUIRE_TLS?.trim().toLowerCase() !== "false",
    auth: user ? { user, pass: secretIfSet("SMTP_PASSWORD") ?? "" } : undefined,
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (override) return override(mail);
  if (!mailConfigured()) throw new Error("Mail isn't set up on this server");
  await smtp().sendMail({ from: process.env.MAIL_FROM?.trim(), to: mail.to, subject: mail.subject, text: mail.text });
}
