import { confirmPasswordReset, isAccountRecoveryConfigured } from '@/lib/accountRecovery';
import { normalizeEmail, toPublicUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { blindIndex } from '@/lib/crypto';
import { ACCOUNT_RECOVERY_NOT_CONFIGURED, fail, json, readJson, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isAccountRecoveryConfigured()) return ACCOUNT_RECOVERY_NOT_CONFIGURED();

  const body = await readJson(request);
  if (
    typeof body.email !== 'string' ||
    typeof body.code !== 'string' ||
    typeof body.newSecret !== 'string'
  ) {
    return fail('invalid_request', 'メールアドレス、コード、新しいパスワード（PIN）を入力してください。', 400);
  }

  try {
    const result = await confirmPasswordReset(body.email, body.code, body.newSecret);
    switch (result) {
      case 'ok':
        break;
      case 'expired':
        return fail('otp_expired', 'コードの有効期限が切れました。再送信してください。', 400);
      case 'locked':
        return fail('otp_locked', '試行回数が上限を超えました。コードを再送信してください。', 429);
      case 'weak_secret':
        return fail(
          'weak_secret',
          '新しいパスワード（PIN）の形式が正しくありません。',
          400,
        );
      default:
        return fail('otp_invalid', 'コードが正しくありません。', 400);
    }

    // Look the user back up (by the now-verified e-mail) to return their info,
    // the same shape login/signup return, since a successful reset also signs
    // the user in.
    const email = normalizeEmail(body.email);
    const pool = await db();
    const { rows } = email
      ? await pool.query<{ id: string; email_encrypted: string; secret_kind: string }>(
          'SELECT id, email_encrypted, secret_kind FROM users WHERE email_index = $1',
          [blindIndex(email)],
        )
      : { rows: [] };
    if (!rows[0]) return fail('otp_invalid', 'コードが正しくありません。', 400);
    return json({ user: toPublicUser(rows[0]) });
  } catch (error) {
    return serverError(error);
  }
}
