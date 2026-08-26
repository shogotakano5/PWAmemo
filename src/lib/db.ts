import { Pool } from 'pg';
import { blindIndex, encryptField } from './crypto';

/**
 * Postgres is optional: without a connection string the app runs in
 * local-only mode and every account route answers 503 instead of crashing.
 */
export function databaseUrl(): string | null {
  const url =
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;
  return url && url.trim().length > 0 ? url.trim() : null;
}

export function isDatabaseConfigured(): boolean {
  return databaseUrl() !== null;
}

// Serverless functions are re-used between invocations, so the pool (and the
// one-time migration) are cached on globalThis to survive hot reloads too.
type Globals = typeof globalThis & {
  __memoPool?: Pool;
  __memoMigration?: Promise<void>;
};
const globals = globalThis as Globals;

function getPool(): Pool {
  if (!globals.__memoPool) {
    const connectionString = databaseUrl();
    if (!connectionString) throw new Error('DATABASE_NOT_CONFIGURED');
    globals.__memoPool = new Pool({
      connectionString,
      // Hosted Postgres (Neon/Supabase/Vercel) terminates TLS with certificates
      // that are not in the Node trust store; local Postgres needs no TLS.
      ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globals.__memoPool;
}

async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

/**
 * Upgrades the original plaintext-e-mail table to the encrypted layout. The
 * ciphertext can only be produced by the app, so the backfill runs here rather
 * than in SQL. No-op once the old columns are gone.
 */
async function encryptExistingEmails(pool: Pool): Promise<void> {
  if (!(await columnExists(pool, 'users', 'email'))) return;

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_index TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_encrypted TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS secret_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS secret_kind TEXT NOT NULL DEFAULT 'password'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until BIGINT NOT NULL DEFAULT 0`);

  const { rows } = await pool.query<{ id: string; email: string; password_hash: string | null }>(
    `SELECT id, email, password_hash FROM users WHERE email_index IS NULL`,
  );
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    await pool.query(
      `UPDATE users
          SET email_index = $2,
              email_encrypted = $3,
              secret_hash = COALESCE(secret_hash, $4)
        WHERE id = $1`,
      [row.id, blindIndex(email), encryptField(email), row.password_hash ?? ''],
    );
  }

  await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS email`);
  await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS password_hash`);
  await pool.query(`ALTER TABLE users ALTER COLUMN email_index SET NOT NULL`);
  await pool.query(`ALTER TABLE users ALTER COLUMN email_encrypted SET NOT NULL`);
  await pool.query(`ALTER TABLE users ALTER COLUMN secret_hash SET NOT NULL`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_email_index_key ON users (email_index)`,
  );
}

async function migrate(): Promise<void> {
  const pool = getPool();
  // The e-mail address is stored encrypted (AES-256-GCM) and matched through a
  // keyed blind index, so no registration data is readable in the table itself.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      email_index     TEXT NOT NULL UNIQUE,
      email_encrypted TEXT NOT NULL,
      secret_hash     TEXT NOT NULL,
      secret_kind     TEXT NOT NULL DEFAULT 'password',
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until    BIGINT NOT NULL DEFAULT 0,
      created_at      BIGINT NOT NULL
    );
  `);
  await encryptExistingEmails(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memos (
      id         TEXT NOT NULL,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL DEFAULT '',
      content    TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      deleted    BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (user_id, id)
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS memos_user_updated_idx ON memos (user_id, updated_at DESC);`,
  );
}

/** Returns a migrated pool. The migration runs at most once per process. */
export async function db(): Promise<Pool> {
  const pool = getPool();
  if (!globals.__memoMigration) {
    globals.__memoMigration = migrate().catch((error) => {
      // Let the next request retry instead of caching a failed migration.
      globals.__memoMigration = undefined;
      throw error;
    });
  }
  await globals.__memoMigration;
  return pool;
}
