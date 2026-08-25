import { currentUser } from '@/lib/auth';
import { db, isDatabaseConfigured } from '@/lib/db';
import { DB_NOT_CONFIGURED, fail, json, readJson, serverError } from '@/lib/api';
import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH, type Memo } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHANGES_PER_REQUEST = 500;

type MemoRow = {
  id: string;
  title: string;
  content: string;
  created_at: string | number;
  updated_at: string | number;
  deleted: boolean;
};

function toMemo(row: MemoRow): Memo {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deleted: row.deleted,
  };
}

/** Rejects anything that is not a plausible memo so bad clients cannot poison the table. */
function parseMemo(value: unknown): Memo | null {
  if (!value || typeof value !== 'object') return null;
  const memo = value as Record<string, unknown>;
  if (typeof memo.id !== 'string' || memo.id.length === 0 || memo.id.length > 100) return null;
  if (typeof memo.content !== 'string' || memo.content.length > MAX_CONTENT_LENGTH) return null;
  if (typeof memo.title !== 'string') return null;
  const createdAt = Number(memo.createdAt);
  const updatedAt = Number(memo.updatedAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  return {
    id: memo.id,
    title: memo.title.slice(0, MAX_TITLE_LENGTH),
    content: memo.content,
    createdAt,
    updatedAt,
    deleted: memo.deleted === true,
  };
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return DB_NOT_CONFIGURED();

  try {
    const user = await currentUser();
    if (!user) return fail('unauthorized', 'ログインが必要です。', 401);

    const body = await readJson(request);
    const since = Number.isFinite(Number(body.since)) ? Math.max(0, Number(body.since)) : 0;
    const rawChanges = Array.isArray(body.changes) ? body.changes : [];
    if (rawChanges.length > MAX_CHANGES_PER_REQUEST) {
      return fail('too_many_changes', '一度に送信できる変更数を超えています。', 413);
    }
    const changes = rawChanges.map(parseMemo).filter((memo): memo is Memo => memo !== null);

    const pool = await db();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const memo of changes) {
        // Last-write-wins: an incoming change only lands if it is newer than
        // whatever the server already has for that memo.
        await client.query(
          `INSERT INTO memos (id, user_id, title, content, created_at, updated_at, deleted)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, id) DO UPDATE SET
             title      = EXCLUDED.title,
             content    = EXCLUDED.content,
             created_at = LEAST(memos.created_at, EXCLUDED.created_at),
             updated_at = EXCLUDED.updated_at,
             deleted    = EXCLUDED.deleted
           WHERE EXCLUDED.updated_at > memos.updated_at`,
          [
            memo.id,
            user.id,
            memo.title,
            memo.content,
            memo.createdAt,
            memo.updatedAt,
            memo.deleted,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    // Everything the client has not seen yet, including memos it just pushed
    // (so it learns the authoritative version when a conflict was resolved).
    const { rows } = await pool.query<MemoRow>(
      `SELECT id, title, content, created_at, updated_at, deleted
         FROM memos
        WHERE user_id = $1 AND updated_at > $2
        ORDER BY updated_at ASC
        LIMIT 5000`,
      [user.id, since],
    );

    return json({ memos: rows.map(toMemo), serverTime: Date.now() });
  } catch (error) {
    return serverError(error);
  }
}
