import { db, isDatabaseConfigured } from '@/lib/db';
import { lockoutFor, normalizeEmail, setSessionCookie, toPublicUser } from '@/lib/auth';
import { blindIndex, hashSecret, needsRehash, verifySecret, type SecretKind } from '@/lib/crypto';
import { DB_NOT_CONFIGURED, fail, json, readJson, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UserRow = {
  id: string;
  email_encrypted: string;
  secret_hash: string;
  secret_kind: string;
  failed_attempts: number;
  locked_until: string | number;
};

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return DB_NOT_CONFIGURED();

  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const candidate = body.secret ?? body.password;
  // The same message for every failure, so the response never reveals whether
  // an address is registered.
  const invalid = () =>
    fail(
      'invalid_credentials',
      'メールアドレス、またはパスワード／PINが正しくありません。',
      401,
    );

  if (!email || typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 200) {
    return invalid();
  }

  try {
    const pool = await db();
    const { rows } = await pool.query<UserRow>(
      `SELECT id, email_encrypted, secret_hash, secret_kind, failed_attempts, locked_until
         FROM users WHERE email_index = $1`,
      [blindIndex(email)],
    );
    const user = rows[0];
    if (!user) return invalid();

    const lockedUntil = Number(user.locked_until);
    if (lockedUntil > Date.now()) {
      const minutes = Math.ceil((lockedUntil - Date.now()) / 60_000);
      return fail(
        'account_locked',
        `試行回数が多すぎます。約${minutes}分後にもう一度お試しください。`,
        429,
      );
    }

    if (!(await verifySecret(candidate, user.secret_hash))) {
      const attempts = user.failed_attempts + 1;
      await pool.query('UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1', [
        user.id,
        attempts,
        lockoutFor(attempts),
      ]);
      return invalid();
    }

    const kind: SecretKind = user.secret_kind === 'pin' ? 'pin' : 'password';
    // Successful log-in also upgrades hashes stored with older parameters.
    const rehashed = needsRehash(user.secret_hash, kind)
      ? await hashSecret(candidate, kind)
      : user.secret_hash;

    await pool.query(
      'UPDATE users SET failed_attempts = 0, locked_until = 0, secret_hash = $2 WHERE id = $1',
      [user.id, rehashed],
    );

    await setSessionCookie(user.id);
    return json({ user: toPublicUser(user) });
  } catch (error) {
    return serverError(error);
  }
}
