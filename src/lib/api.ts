import { NextResponse } from 'next/server';

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: code, message }, { status });
}

export function DB_NOT_CONFIGURED() {
  return fail(
    'database_not_configured',
    'サーバ保存（アカウント機能）は未設定です。POSTGRES_URL を設定してください。',
    503,
  );
}

export function ADMIN_NOT_CONFIGURED() {
  return fail(
    'admin_not_configured',
    '管理画面は未設定です。ADMIN_EMAILS と SMTP の環境変数を設定してください。',
    503,
  );
}

export function ADMIN_UNAUTHORIZED() {
  return fail('admin_unauthorized', '管理者としてログインしてください。', 401);
}

/**
 * Connection-layer failures from Postgres (`pg`) and SMTP (`nodemailer`) both
 * surface as a plain Error with a short `.code`. Neither library's codes are
 * secret-bearing (host/user, never a password), so it is safe to translate
 * them into a specific hint instead of the catch-all message below — that
 * catch-all is exactly what made a wrong POSTGRES_URL or SMTP_* setting
 * indistinguishable from every other failure.
 */
const CONNECTION_ERROR_HINTS: Record<string, string> = {
  // Postgres SQLSTATE codes (from the `pg` package's DatabaseError).
  '28P01': 'データベースの認証に失敗しました。パスワードが変更されていないか、POSTGRES_URL を確認してください。',
  '28000': 'データベースの認証設定に問題があります。POSTGRES_URL を確認してください。',
  '3D000': '指定されたデータベースが見つかりません。POSTGRES_URL のデータベース名を確認してください。',
  // Shared network-layer codes (Postgres or SMTP — message says which is likely).
  ENOTFOUND:
    '接続先ホストが見つかりません。POSTGRES_URL または SMTP_HOST のホスト名を確認してください。',
  ECONNREFUSED:
    '接続が拒否されました。POSTGRES_URL、または SMTP_HOST / SMTP_PORT を確認してください。',
  ETIMEDOUT:
    '接続がタイムアウトしました。POSTGRES_URL、または SMTP_HOST / SMTP_PORT を確認してください。',
  // nodemailer (SMTP) codes.
  EAUTH: 'メール送信サーバーの認証に失敗しました。SMTP_USER / SMTP_PASS を確認してください。',
  ECONNECTION: 'メール送信サーバーに接続できませんでした。SMTP_HOST / SMTP_PORT を確認してください。',
  ESOCKET:
    'メール送信サーバーとの通信でエラーが発生しました。SMTP_SECURE と SMTP_PORT の組み合わせを確認してください（465 番は SMTP_SECURE=true、587 番は false が一般的です）。',
  EENVELOPE: '送信元または宛先のメールアドレスが正しくありません。SMTP_FROM を確認してください。',
};

/** Maps thrown infrastructure errors onto a user-facing response. */
export function serverError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'DATABASE_NOT_CONFIGURED') return DB_NOT_CONFIGURED();
  if (code === 'AUTH_SECRET_MISSING') {
    return fail(
      'auth_secret_missing',
      'AUTH_SECRET が設定されていません。環境変数を設定してください。',
      503,
    );
  }
  if (code === 'MAIL_NOT_CONFIGURED') return ADMIN_NOT_CONFIGURED();

  console.error('[api] unexpected error', error);

  const errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const hint = CONNECTION_ERROR_HINTS[errorCode];
  if (hint) return fail('connection_error', hint, 502);

  return fail('internal_error', 'サーバでエラーが発生しました。', 500);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
