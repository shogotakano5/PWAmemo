import { currentAdminEmail, isAdminConfigured } from '@/lib/admin';
import { db, isDatabaseConfigured } from '@/lib/db';
import { ADMIN_NOT_CONFIGURED, ADMIN_UNAUTHORIZED, fail, json, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminConfigured()) return ADMIN_NOT_CONFIGURED();
  if (!isDatabaseConfigured()) return ADMIN_NOT_CONFIGURED();

  try {
    if (!(await currentAdminEmail())) return ADMIN_UNAUTHORIZED();

    const { id } = await context.params;
    if (!id) return fail('invalid_id', '不正なユーザIDです。', 400);

    const pool = await db();
    // ON DELETE CASCADE on memos.user_id takes the account's memos with it.
    const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (result.rowCount === 0) return fail('not_found', 'ユーザが見つかりません。', 404);

    return json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
