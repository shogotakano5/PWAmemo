import { currentUser } from '@/lib/auth';
import { isAccountRecoveryConfigured, requestEmailChange } from '@/lib/accountRecovery';
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
  if (typeof body.newEmail !== 'string' || typeof body.currentSecret !== 'string') {
    return fail('invalid_request', '新しいメールアドレスと現在のパスワード（PIN）を入力してください。', 400);
  }

  try {
    const user = await currentUser();
    if (!user) return UNAUTHORIZED();

    const outcome = await requestEmailChange(user.id, body.newEmail, body.currentSecret);
    switch (outcome) {
      case 'sent':
        return json({
          ok: true,
          message: '新しいメールアドレスに確認コードを送信しました。',
        });
      case 'invalid_email':
        return fail('invalid_email', 'メールアドレスの形式が正しくありません。', 400);
      case 'wrong_secret':
        return fail(
          'wrong_secret',
          '現在のパスワード（PIN）が正しくありません。',
          401,
        );
      case 'email_taken':
        return fail('email_taken', 'このメールアドレスは既に使用されています。', 409);
      case 'cooldown':
        return fail(
          'cooldown',
          '前回のコード送信から間もありません。しばらくしてからもう一度お試しください。',
          429,
        );
    }
  } catch (error) {
    return serverError(error);
  }
}
