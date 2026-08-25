import { Pool } from 'pg';

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

async function migrate(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    BIGINT NOT NULL
    );
  `);
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
