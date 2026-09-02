import { isAdminConfigured, requestAdminOtp } from '@/lib/admin';
import { ADMIN_NOT_CONFIGURED, fail, json, readJson, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Always the same shape whether or not the address turns out to be an admin —
// otherwise this endpoint would let a caller discover who has admin access.
const GENERIC_RESPONSE = {
  ok: true,
  message: 'このメールアドレスが管理者として登録されている場合、ログインコードを送信しました。',
};

export async function POST(request: Request) {
  if (!isAdminConfigured()) return ADMIN_NOT_CONFIGURED();

  const body = await readJson(request);
  if (typeof body.email !== 'string') {
    return fail('invalid_email', 'メールアドレスを入力してください。', 400);
  }

  try {
    const outcome = await requestAdminOtp(body.email);
    if (outcome === 'cooldown') {
      return fail(
        'cooldown',
        '前回のコード送信から間もありません。しばらくしてからもう一度お試しください。',
        429,
      );
    }
    // 'sent' and 'not_allowed' both return the generic message.
    return json(GENERIC_RESPONSE);
  } catch (error) {
    return serverError(error);
  }
}
