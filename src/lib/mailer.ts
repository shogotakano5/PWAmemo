import nodemailer, { type Transporter } from 'nodemailer';

/**
 * A generic SMTP sender so the app is not tied to one e-mail vendor. Any
 * provider that exposes SMTP credentials (a mailbox, SendGrid, Mailgun,
 * Amazon SES, ...) can be plugged in with four environment variables.
 */
export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

/**
 * SMTP_HOST expects a bare hostname, but providers often show their settings
 * as a full URL (`smtp://sandbox.smtp.mailtrap.io:2525`) that gets pasted in
 * whole — Node then tries to resolve the entire string as one hostname and
 * fails with DNS errors that are hard to connect back to the real mistake.
 * Accept that shape too: strip a smtp(s):// scheme and pull a trailing port
 * out into the port, so a copy-pasted URL still works.
 */
function parseSmtpHost(raw: string): { host: string; port: number | null; secure: boolean | null } {
  const schemeMatch = raw.trim().match(/^(smtps?):\/\/(.+)$/i);
  const rest = (schemeMatch ? schemeMatch[2] : raw.trim()).replace(/\/+$/, '');
  const portMatch = rest.match(/^([^/:]+):(\d+)$/);
  return {
    host: portMatch ? portMatch[1] : rest,
    port: portMatch ? Number(portMatch[2]) : null,
    secure: schemeMatch ? schemeMatch[1].toLowerCase() === 'smtps' : null,
  };
}

type Globals = typeof globalThis & { __memoTransporter?: Transporter };
const globals = globalThis as Globals;

function transporter(): Transporter {
  if (!globals.__memoTransporter) {
    const rawHost = process.env.SMTP_HOST;
    if (!rawHost) throw new Error('MAIL_NOT_CONFIGURED');
    const parsed = parseSmtpHost(rawHost);
    const port = Number(process.env.SMTP_PORT ?? parsed.port ?? 587);
    globals.__memoTransporter = nodemailer.createTransport({
      host: parsed.host,
      port,
      // Port 465 is implicit TLS; everything else (587, 25, ...) starts in
      // plain text and upgrades via STARTTLS if the server offers it.
      secure: process.env.SMTP_SECURE === 'true' || parsed.secure === true || port === 465,
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
