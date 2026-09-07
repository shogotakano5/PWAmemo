import { currentUser } from '@/lib/auth';
import { confirmEmailChange, isAccountRecoveryConfigured } from '@/lib/accountRecovery';
import {
  ACCOUNT_RECOVERY_NOT_CONFIGURED,
  UNAUTHORIZED,
  fail,
  json,
  readJson,
  serverError,
} from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isAccountRecoveryConfigured()) return ACCOUNT_RECOVERY_NOT_CONFIGURED();

  const body = await readJson(request);
  if (typeof body.code !== 'string') {
    return fail('invalid_request', 'コードを入力してください。', 400);
  }

  try {
    const user = await currentUser();
    if (!user) return UNAUTHORIZED();

    const result = await confirmEmailChange(user.id, body.code);
    switch (result) {
      case 'ok': {
        const refreshed = await currentUser();
        return json({ user: refreshed });
      }
      case 'expired':
        return fail('otp_expired', 'コードの有効期限が切れました。再送信してください。', 400);
      case 'locked':
        return fail('otp_locked', '試行回数が上限を超えました。コードを再送信してください。', 429);
      case 'email_taken':
        return fail(
          'email_taken',
          'このメールアドレスは他のアカウントで既に使用されています。',
          409,
        );
      default:
        return fail('otp_invalid', 'コードが正しくありません。', 400);
    }
  } catch (error) {
    return serverError(error);
  }
}
