import { db, isDatabaseConfigured } from '@/lib/db';
import {
  newId,
  normalizeEmail,
  normalizeSecretKind,
  setSessionCookie,
  toPublicUser,
  validateSecret,
} from '@/lib/auth';
import { blindIndex, encryptField, hashSecret } from '@/lib/crypto';
import { DB_NOT_CONFIGURED, fail, json, readJson, serverError } from '@/lib/api';
import { MAX_PIN_LENGTH, MIN_PASSWORD_LENGTH, MIN_PIN_LENGTH } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return DB_NOT_CONFIGURED();

  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const kind = normalizeSecretKind(body.secretKind);
  const plainSecret = validateSecret(body.secret ?? body.password, kind);

  if (!email) return fail('invalid_email', 'メールアドレスの形式が正しくありません。', 400);
  if (!plainSecret) {
    return fail(
      'invalid_secret',
      kind === 'pin'
        ? `PINは${MIN_PIN_LENGTH}〜${MAX_PIN_LENGTH}桁の数字で、同じ数字の繰り返しや連番は使えません。`
        : `パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください。`,
      400,
    );
  }

  try {
    const pool = await db();
    // The address itself is only stored encrypted; uniqueness is enforced on the
    // keyed blind index, which is deterministic for the same address.
    const { rows } = await pool.query<{
      id: string;
      email_encrypted: string;
      secret_kind: string;
    }>(
      `INSERT INTO users (id, email_index, email_encrypted, secret_hash, secret_kind, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email_index) DO NOTHING
       RETURNING id, email_encrypted, secret_kind`,
      [
        newId(),
        blindIndex(email),
        encryptField(email),
        await hashSecret(plainSecret, kind),
        kind,
        Date.now(),
      ],
    );
    if (rows.length === 0) {
      return fail('email_taken', 'このメールアドレスは既に登録されています。', 409);
    }

    const user = toPublicUser(rows[0]);
    await setSessionCookie(user.id);
    return json({ user }, 201);
  } catch (error) {
    return serverError(error);
  }
}
