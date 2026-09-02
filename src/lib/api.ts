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
