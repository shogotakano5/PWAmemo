import { isAdminConfigured, verifyAdminOtp } from '@/lib/admin';
import { ADMIN_NOT_CONFIGURED, fail, json, readJson, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isAdminConfigured()) return ADMIN_NOT_CONFIGURED();

  const body = await readJson(request);
  if (typeof body.email !== 'string' || typeof body.code !== 'string') {
    return fail('invalid_request', 'メールアドレスとコードを入力してください。', 400);
  }

  try {
    const result = await verifyAdminOtp(body.email, body.code);
    switch (result) {
      case 'ok':
        return json({ ok: true });
      case 'expired':
        return fail('otp_expired', 'コードの有効期限が切れました。再送信してください。', 400);
      case 'locked':
        return fail(
          'otp_locked',
          '試行回数が上限を超えました。コードを再送信してください。',
          429,
        );
      default:
        return fail('otp_invalid', 'コードが正しくありません。', 400);
    }
  } catch (error) {
    return serverError(error);
  }
}
