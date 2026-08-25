import { db, isDatabaseConfigured } from '@/lib/db';
import {
  hashPassword,
  newId,
  normalizeEmail,
  setSessionCookie,
  validatePassword,
} from '@/lib/auth';
import { DB_NOT_CONFIGURED, fail, json, readJson, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return DB_NOT_CONFIGURED();

  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = validatePassword(body.password);
  if (!email) return fail('invalid_email', 'メールアドレスの形式が正しくありません。', 400);
  if (!password) return fail('invalid_password', 'パスワードは8文字以上で入力してください。', 400);

  try {
    const pool = await db();
    const passwordHash = await hashPassword(password);
    const id = newId();
    const { rows } = await pool.query<{ id: string; email: string }>(
      `INSERT INTO users (id, email, password_hash, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email`,
      [id, email, passwordHash, Date.now()],
    );
    if (rows.length === 0) {
      return fail('email_taken', 'このメールアドレスは既に登録されています。', 409);
    }
    await setSessionCookie(rows[0].id);
    return json({ user: rows[0] }, 201);
  } catch (error) {
    return serverError(error);
  }
}
