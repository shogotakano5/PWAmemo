import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db, isDatabaseConfigured } from './db';
import { deriveKey, digestsMatch, keyedDigest, blindIndex } from './crypto';
import { isMailConfigured, sendMail } from './mailer';
import { normalizeEmail } from './auth';

export const ADMIN_SESSION_COOKIE = 'memo_admin_session';
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — a work session, not "remember me"

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

/**
 * "Admin" is not an account in the `users` table — it is any address on this
 * allowlist. Kept separate from the memo-storage user model on purpose, so
 * granting admin access never requires (or implies) a memo account.
 */
export function adminAllowlist(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((entry) => normalizeEmail(entry))
      .filter((entry): entry is string => entry !== null),
  );
}

export function isAdminConfigured(): boolean {
  return isDatabaseConfigured() && isMailConfigured() && adminAllowlist().size > 0;
}

function isAllowedAdmin(email: string): boolean {
  return adminAllowlist().has(email);
}

/* -------------------------------------------------------------------------- */
/* One-time codes                                                              */
/* -------------------------------------------------------------------------- */

function generateOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

export type OtpRequestOutcome = 'sent' | 'not_allowed' | 'cooldown';

/**
 * Always looks the same to the caller regardless of whether the address is an
 * admin, so the endpoint cannot be used to discover who has admin access.
 * `not_allowed` and `cooldown` are still returned so the route can log /
 * rate-limit internally — never surface the distinction in the HTTP response.
 */
export async function requestAdminOtp(rawEmail: string): Promise<OtpRequestOutcome> {
  const email = normalizeEmail(rawEmail);
  if (!email || !isAllowedAdmin(email)) return 'not_allowed';

  const pool = await db();
  const index = blindIndex(email);
  const { rows } = await pool.query<{ created_at: string | number }>(
    'SELECT created_at FROM admin_otp WHERE email_index = $1',
    [index],
  );
  const existing = rows[0];
  if (existing && Number(existing.created_at) + OTP_RESEND_COOLDOWN_MS > Date.now()) {
    return 'cooldown';
  }

  const code = generateOtp();
  const now = Date.now();
  await pool.query(
    `INSERT INTO admin_otp (email_index, code_hash, expires_at, attempts, created_at)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (email_index) DO UPDATE SET
       code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
       attempts = 0, created_at = EXCLUDED.created_at`,
    [index, keyedDigest('admin-otp', code), now + OTP_TTL_MS, now],
  );

  await sendMail(
    email,
    'メモアプリ 管理画面のログインコード',
    `管理画面のログインコードは ${code} です。\n\n` +
      `このコードは発行から10分間有効です。心当たりがない場合はこのメールを無視してください。`,
  );
  return 'sent';
}

export type OtpVerifyResult = 'ok' | 'invalid' | 'expired' | 'locked';

export async function verifyAdminOtp(rawEmail: string, code: string): Promise<OtpVerifyResult> {
  const email = normalizeEmail(rawEmail);
  if (!email || !isAllowedAdmin(email)) return 'invalid';
  if (!/^\d{4,10}$/.test(code)) return 'invalid';

  const pool = await db();
  const index = blindIndex(email);
  const { rows } = await pool.query<{
    code_hash: string;
    expires_at: string | number;
    attempts: number;
  }>('SELECT code_hash, expires_at, attempts FROM admin_otp WHERE email_index = $1', [index]);
  const row = rows[0];
  if (!row) return 'invalid';

  if (row.attempts >= OTP_MAX_ATTEMPTS) return 'locked';
  if (Number(row.expires_at) < Date.now()) return 'expired';

  if (!digestsMatch(keyedDigest('admin-otp', code), row.code_hash)) {
    await pool.query('UPDATE admin_otp SET attempts = attempts + 1 WHERE email_index = $1', [
      index,
    ]);
    return (row.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid');
  }

  // Single-use: consumed immediately on success.
  await pool.query('DELETE FROM admin_otp WHERE email_index = $1', [index]);
  await setAdminSessionCookie(email);
  return 'ok';
}

/* -------------------------------------------------------------------------- */
/* Admin session: signed separately from the user session cookie               */
/* -------------------------------------------------------------------------- */

function signAdminPayload(payload: string): string {
  return createHmac('sha256', deriveKey('admin-session-signing')).update(payload).digest('base64url');
}

function createAdminSessionToken(email: string): string {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + ADMIN_SESSION_TTL_MS }),
  ).toString('base64url');
  return `${payload}.${signAdminPayload(payload)}`;
}

function readAdminSessionToken(token: string): string | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(signAdminPayload(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      email?: unknown;
      exp?: unknown;
    };
    if (typeof data.email !== 'string' || typeof data.exp !== 'number') return null;
    if (data.exp < Date.now()) return null;
    // The allowlist can shrink after the token was issued; re-check every time.
    if (!isAllowedAdmin(data.email)) return null;
    return data.email;
  } catch {
    return null;
  }
}

async function setAdminSessionCookie(email: string): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, createAdminSessionToken(email), {
    httpOnly: true,
    // Stricter than the user session: admin actions are destructive, and this
    // cookie never needs to ride along on a cross-site top-level navigation.
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_TTL_MS / 1000,
  });
}

export async function clearAdminSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export async function currentAdminEmail(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  return readAdminSessionToken(token);
}
