import { isAccountRecoveryConfigured, requestPasswordReset } from '@/lib/accountRecovery';
import { ACCOUNT_RECOVERY_NOT_CONFIGURED, fail, json, readJson, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Always the same shape whether or not the address is registered — otherwise
// this endpoint would let a caller discover which addresses have accounts.
const GENERIC_RESPONSE = {
  ok: true,
  message: 'このメールアドレスが登録されている場合、再設定コードを送信しました。',
};

export async function POST(request: Request) {
  if (!isAccountRecoveryConfigured()) return ACCOUNT_RECOVERY_NOT_CONFIGURED();

  const body = await readJson(request);
  if (typeof body.email !== 'string') {
    return fail('invalid_email', 'メールアドレスを入力してください。', 400);
  }

  try {
    const outcome = await requestPasswordReset(body.email);
    if (outcome === 'cooldown') {
      return fail(
        'cooldown',
        '前回のコード送信から間もありません。しばらくしてからもう一度お試しください。',
        429,
      );
    }
    // 'sent' and 'no_account' both return the generic message.
    return json(GENERIC_RESPONSE);
  } catch (error) {
    return serverError(error);
  }
}
