import { currentUser } from '@/lib/auth';
import { db, isDatabaseConfigured } from '@/lib/db';
import { DB_NOT_CONFIGURED, fail, json, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Permanently removes soft-deleted memos older than 30 days (tombstone GC). */
export async function POST() {
  if (!isDatabaseConfigured()) return DB_NOT_CONFIGURED();
  try {
    const user = await currentUser();
    if (!user) return fail('unauthorized', 'ログインが必要です。', 401);

    const pool = await db();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const result = await pool.query(
      'DELETE FROM memos WHERE user_id = $1 AND deleted = TRUE AND updated_at < $2',
      [user.id, cutoff],
    );
    return json({ purged: result.rowCount ?? 0 });
  } catch (error) {
    return serverError(error);
  }
}
