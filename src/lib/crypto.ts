import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * All keys are derived from AUTH_SECRET with HKDF so that one env var is enough
 * and the encryption key is never the same bytes as the cookie signing key.
 *
 * Changing AUTH_SECRET makes stored e-mail addresses unreadable and invalidates
 * every session, so it must stay stable once accounts exist.
 */
export function authSecret(): string {
  const value = process.env.AUTH_SECRET;
  if (value && value.length >= 16) return value;
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET_MISSING');
  // Development convenience only: everything resets with the dev server.
  return 'dev-only-insecure-secret-do-not-use-in-production';
}

function derivedKey(info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', authSecret(), 'pwa-memo-hkdf-salt', info, 32));
}

/**
 * Exposes a purpose-scoped key for callers outside this module (e.g. signing
 * the admin session cookie with a key distinct from the user session's).
 */
export function deriveKey(info: string): Buffer {
  return derivedKey(info);
}

/** Keyed digest for short-lived, single-use secrets (e.g. an OTP code). */
export function keyedDigest(info: string, value: string): string {
  return createHmac('sha256', derivedKey(info)).update(value).digest('hex');
}

/** Constant-time comparison of two keyed digests produced by {@link keyedDigest}. */
export function digestsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && bufA.length > 0 && timingSafeEqual(bufA, bufB);
}

/* -------------------------------------------------------------------------- */
/* Reversible field encryption (AES-256-GCM)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Encrypts a value that has to be readable again later, such as the e-mail
 * address shown back to the signed-in user. Output: `v1$iv$ciphertext$tag`.
 */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivedKey('field-encryption'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('$');
}

export function decryptField(stored: string): string {
  const [version, ivPart, ciphertextPart, tagPart] = stored.split('$');
  if (version !== 'v1' || !ivPart || !ciphertextPart || !tagPart) {
    throw new Error('FIELD_DECRYPT_FAILED');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    derivedKey('field-encryption'),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Deterministic keyed digest used as a lookup key for an encrypted column:
 * AES-GCM output differs every time, so uniqueness and log-in lookups run
 * against this instead. Keyed (not a bare SHA-256) so that a leaked table
 * cannot be scanned for known addresses without the secret.
 */
export function blindIndex(value: string): string {
  return createHmac('sha256', derivedKey('blind-index')).update(value).digest('hex');
}

/* -------------------------------------------------------------------------- */
/* Credential hashing (scrypt, one-way)                                        */
/* -------------------------------------------------------------------------- */

export type SecretKind = 'password' | 'pin';

/**
 * A PIN has far less entropy than a password, so it is stretched harder. The
 * real protection for PINs is the lock-out in the login route; this only raises
 * the cost of an offline attack if the table ever leaks.
 */
const SCRYPT_PARAMS: Record<SecretKind, { N: number; r: number; p: number }> = {
  password: { N: 16384, r: 8, p: 1 },
  pin: { N: 65536, r: 8, p: 1 },
};

const KEY_LENGTH = 64;

function maxmemFor(N: number, r: number): number {
  return 256 * N * r; // twice what scrypt needs, as Node requires headroom
}

/**
 * Hashes a password or PIN. Credentials are deliberately hashed rather than
 * encrypted: a hash cannot be turned back into the original even by someone
 * holding every key the server has.
 *
 * Format: `scrypt$<N>$<r>$<p>$<salt>$<hash>`
 */
export async function hashSecret(secret: string, kind: SecretKind): Promise<string> {
  const { N, r, p } = SCRYPT_PARAMS[kind];
  const salt = randomBytes(16);
  const derived = await scryptAsync(secret, salt, KEY_LENGTH, { N, r, p, maxmem: maxmemFor(N, r) });
  return ['scrypt', N, r, p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

/** Verifies against a stored hash, including the earlier parameterless format. */
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');

  let N: number;
  let r: number;
  let p: number;
  let saltPart: string;
  let hashPart: string;

  if (parts.length === 6 && parts[0] === 'scrypt') {
    [, , , , saltPart, hashPart] = parts;
    N = Number(parts[1]);
    r = Number(parts[2]);
    p = Number(parts[3]);
  } else if (parts.length === 3 && parts[0] === 'scrypt') {
    // Accounts created before the parameters were recorded used Node's defaults.
    [, saltPart, hashPart] = parts;
    ({ N, r, p } = SCRYPT_PARAMS.password);
  } else {
    return false;
  }

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N < 16384 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  if (!saltPart || !hashPart) return false;

  const expected = Buffer.from(hashPart, 'base64url');
  const derived = await scryptAsync(secret, Buffer.from(saltPart, 'base64url'), expected.length, {
    N,
    r,
    p,
    maxmem: maxmemFor(N, r),
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** True when the stored hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string, kind: SecretKind): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < SCRYPT_PARAMS[kind].N;
}
