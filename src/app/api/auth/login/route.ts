import { db, isDatabaseConfigured } from '@/lib/db';
import { normalizeEmail, setSessionCookie, validatePassword, verifyPassword } from '@/lib/auth';
import { DB_NOT_CONFIGURED, fail, json, readJson, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return DB_NOT_CONFIGURED();

  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = validatePassword(body.password);
  const invalid = fail(
    'invalid_credentials',
    'メールアドレスまたはパスワードが正しくありません。',
    401,
  );
  if (!email || !password) return invalid;

  try {
    const pool = await db();
    const { rows } = await pool.query<{ id: string; email: string; password_hash: string }>(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email],
    );
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) return invalid;

    await setSessionCookie(user.id);
    return json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    return serverError(error);
  }
}
