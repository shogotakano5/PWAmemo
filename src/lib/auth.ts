import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';
import { authSecret, decryptField } from './crypto';
import { MAX_PIN_LENGTH, MIN_PASSWORD_LENGTH, MIN_PIN_LENGTH, type PublicUser } from './types';
import type { SecretKind } from './crypto';

export const SESSION_COOKIE = 'memo_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* -------------------------------------------------------------------------- */
/* Session tokens: base64url(payload).base64url(hmac)                          */
/* -------------------------------------------------------------------------- */

function sign(payload: string): string {
  return createHmac('sha256', authSecret()).update(payload).digest('base64url');
}

export function createSessionToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readSessionToken(token: string): string | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      uid?: unknown;
      exp?: unknown;
    };
    if (typeof data.uid !== 'string' || typeof data.exp !== 'number') return null;
    if (data.exp < Date.now()) return null;
    return data.uid;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(userId), sessionCookieOptions(SESSION_TTL_MS / 1000));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', sessionCookieOptions(0));
}

/** Resolves the signed-in user, or null when there is no valid session. */
export async function currentUser(): Promise<PublicUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const userId = readSessionToken(token);
  if (!userId) return null;

  const pool = await db();
  const { rows } = await pool.query<{ id: string; email_encrypted: string; secret_kind: string }>(
    'SELECT id, email_encrypted, secret_kind FROM users WHERE id = $1',
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return toPublicUser(row);
}

/** Decrypts the stored e-mail for the response. */
export function toPublicUser(row: {
  id: string;
  email_encrypted: string;
  secret_kind: string;
}): PublicUser {
  return {
    id: row.id,
    email: decryptField(row.email_encrypted),
    secretKind: row.secret_kind === 'pin' ? 'pin' : 'password',
  };
}

export function newId(): string {
  return randomUUID();
}

/* -------------------------------------------------------------------------- */
/* Input validation                                                            */
/* -------------------------------------------------------------------------- */

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function normalizeSecretKind(value: unknown): SecretKind {
  return value === 'pin' ? 'pin' : 'password';
}

/**
 * A PIN is digits only and short; a password is anything of a decent length.
 * Returning null means "reject", so the caller never hashes junk.
 */
export function validateSecret(value: unknown, kind: SecretKind): string | null {
  if (typeof value !== 'string') return null;
  if (kind === 'pin') {
    if (!new RegExp(`^\\d{${MIN_PIN_LENGTH},${MAX_PIN_LENGTH}}$`).test(value)) return null;
    // Reject the handful of PINs that guessing attacks always try first.
    if (/^(\d)\1*$/.test(value)) return null;
    if ('01234567890'.includes(value) || '09876543210'.includes(value)) return null;
    return value;
  }
  if (value.length < MIN_PASSWORD_LENGTH || value.length > 200) return null;
  return value;
}

/* -------------------------------------------------------------------------- */
/* Brute-force protection                                                      */
/* -------------------------------------------------------------------------- */

/** Lock-out thresholds. PINs are short, so repeated guessing must get expensive. */
const LOCKOUT_AFTER_ATTEMPTS = 5;
const LOCKOUT_STEPS_MS = [60_000, 5 * 60_000, 30 * 60_000, 60 * 60_000];

export function lockoutFor(failedAttempts: number): number {
  if (failedAttempts < LOCKOUT_AFTER_ATTEMPTS) return 0;
  const step = Math.min(failedAttempts - LOCKOUT_AFTER_ATTEMPTS, LOCKOUT_STEPS_MS.length - 1);
  return Date.now() + LOCKOUT_STEPS_MS[step];
}
