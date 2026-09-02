import { currentAdminEmail, isAdminConfigured } from '@/lib/admin';
import { db, isDatabaseConfigured } from '@/lib/db';
import { decryptField } from '@/lib/crypto';
import { ADMIN_NOT_CONFIGURED, ADMIN_UNAUTHORIZED, json, serverError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_USERS = 500;

type UserRow = {
  id: string;
  email_encrypted: string;
  secret_kind: string;
  created_at: string | number;
  failed_attempts: number;
  locked_until: string | number;
  memo_count: string | number;
};

export async function GET() {
  if (!isAdminConfigured()) return ADMIN_NOT_CONFIGURED();
  if (!isDatabaseConfigured()) return ADMIN_NOT_CONFIGURED();

  try {
    if (!(await currentAdminEmail())) return ADMIN_UNAUTHORIZED();

    const pool = await db();
    const { rows } = await pool.query<UserRow>(
      `SELECT u.id, u.email_encrypted, u.secret_kind, u.created_at,
              u.failed_attempts, u.locked_until,
              (SELECT count(*) FROM memos m WHERE m.user_id = u.id AND m.deleted = FALSE) AS memo_count
         FROM users u
        ORDER BY u.created_at DESC
        LIMIT ${MAX_USERS}`,
    );

    // A row whose e-mail was encrypted under a since-changed AUTH_SECRET
    // cannot be decrypted — and never will be, without the old secret. Don't
    // let that one row's exception take the whole listing down; surface it
    // as its own state instead, so it can still be found and deleted.
    const users = rows.map((row) => {
      let email: string;
      let decryptable = true;
      try {
        email = decryptField(row.email_encrypted);
      } catch (error) {
        console.error('[admin/users] failed to decrypt email for', row.id, error);
        email = '(復号できません — AUTH_SECRET が変更された可能性があります)';
        decryptable = false;
      }
      return {
        id: row.id,
        email,
        decryptable,
        secretKind: row.secret_kind === 'pin' ? 'pin' : 'password',
        createdAt: Number(row.created_at),
        failedAttempts: row.failed_attempts,
        lockedUntil: Number(row.locked_until),
        memoCount: Number(row.memo_count),
      };
    });

    return json({ users, truncated: users.length === MAX_USERS });
  } catch (error) {
    return serverError(error);
  }
}
