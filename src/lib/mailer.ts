import nodemailer, { type Transporter } from 'nodemailer';

/**
 * A generic SMTP sender so the app is not tied to one e-mail vendor. Any
 * provider that exposes SMTP credentials (a mailbox, SendGrid, Mailgun,
 * Amazon SES, ...) can be plugged in with four environment variables.
 */
export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

type Globals = typeof globalThis & { __memoTransporter?: Transporter };
const globals = globalThis as Globals;

function transporter(): Transporter {
  if (!globals.__memoTransporter) {
    const host = process.env.SMTP_HOST;
    if (!host) throw new Error('MAIL_NOT_CONFIGURED');
    const port = Number(process.env.SMTP_PORT ?? 587);
    globals.__memoTransporter = nodemailer.createTransport({
      host,
      port,
      // Port 465 is implicit TLS; everything else (587, 25, ...) starts in
      // plain text and upgrades via STARTTLS if the server offers it.
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return globals.__memoTransporter;
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!isMailConfigured()) throw new Error('MAIL_NOT_CONFIGURED');
  await transporter().sendMail({ from: process.env.SMTP_FROM, to, subject, text });
}
