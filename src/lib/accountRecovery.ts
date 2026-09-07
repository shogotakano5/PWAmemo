import { randomInt } from 'node:crypto';
import { db, isDatabaseConfigured } from './db';
import {
  blindIndex,
  digestsMatch,
  encryptField,
  hashSecret,
  keyedDigest,
  verifySecret,
  type SecretKind,
} from './crypto';
import { normalizeEmail, setSessionCookie, validateSecret } from './auth';
import { isMailConfigured, sendMail } from './mailer';

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export function isAccountRecoveryConfigured(): boolean {
  return isDatabaseConfigured() && isMailConfigured();
}

function generateOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

/* -------------------------------------------------------------------------- */
/* Forgot password / PIN                                                       */
/* -------------------------------------------------------------------------- */

export type PasswordResetRequestOutcome = 'sent' | 'no_account' | 'cooldown';

/**
 * Always looks the same to the caller regardless of whether the address is
 * registered, so this endpoint cannot be used to discover registered
 * addresses. `no_account` and `cooldown` exist only so the route can decide
 * internally — never surface the distinction in the HTTP response.
 */
export async function requestPasswordReset(rawEmail: string): Promise<PasswordResetRequestOutcome> {
  const email = normalizeEmail(rawEmail);
  if (!email) return 'no_account';

  const pool = await db();
  const index = blindIndex(email);
  const { rows: userRows } = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE email_index = $1',
    [index],
  );
  if (!userRows[0]) return 'no_account';

  const { rows } = await pool.query<{ created_at: string | number }>(
    'SELECT created_at FROM password_reset_otp WHERE email_index = $1',
    [index],
  );
  const existing = rows[0];
  if (existing && Number(existing.created_at) + OTP_RESEND_COOLDOWN_MS > Date.now()) {
    return 'cooldown';
  }

  const code = generateOtp();
  const now = Date.now();
  await pool.query(
    `INSERT INTO password_reset_otp (email_index, code_hash, expires_at, attempts, created_at)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (email_index) DO UPDATE SET
       code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
       attempts = 0, created_at = EXCLUDED.created_at`,
    [index, keyedDigest('password-reset-otp', code), now + OTP_TTL_MS, now],
  );

  await sendMail(
    email,
    'メモアプリ パスワード再設定コード',
    `パスワード（またはPIN）を再設定するコードは ${code} です。\n\n` +
      `このコードは発行から10分間有効です。心当たりがない場合はこのメールを無視してください。`,
  );
  return 'sent';
}

export type PasswordResetConfirmResult = 'ok' | 'invalid' | 'expired' | 'locked' | 'weak_secret';

export async function confirmPasswordReset(
  rawEmail: string,
  code: string,
  newSecret: string,
): Promise<PasswordResetConfirmResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return 'invalid';
  if (!/^\d{4,10}$/.test(code)) return 'invalid';

  const pool = await db();
  const index = blindIndex(email);

  const { rows: userRows } = await pool.query<{ id: string; secret_kind: string }>(
    'SELECT id, secret_kind FROM users WHERE email_index = $1',
    [index],
  );
  const user = userRows[0];
  if (!user) return 'invalid';

  const { rows } = await pool.query<{
    code_hash: string;
    expires_at: string | number;
    attempts: number;
  }>('SELECT code_hash, expires_at, attempts FROM password_reset_otp WHERE email_index = $1', [
    index,
  ]);
  const otp = rows[0];
  if (!otp) return 'invalid';

  if (otp.attempts >= OTP_MAX_ATTEMPTS) return 'locked';
  if (Number(otp.expires_at) < Date.now()) return 'expired';

  if (!digestsMatch(keyedDigest('password-reset-otp', code), otp.code_hash)) {
    await pool.query('UPDATE password_reset_otp SET attempts = attempts + 1 WHERE email_index = $1', [
      index,
    ]);
    return otp.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid';
  }

  const kind: SecretKind = user.secret_kind === 'pin' ? 'pin' : 'password';
  const validated = validateSecret(newSecret, kind);
  if (!validated) return 'weak_secret';

  const newHash = await hashSecret(validated, kind);
  await pool.query(
    'UPDATE users SET secret_hash = $2, failed_attempts = 0, locked_until = 0 WHERE id = $1',
    [user.id, newHash],
  );
  // Single-use: consumed immediately on success.
  await pool.query('DELETE FROM password_reset_otp WHERE email_index = $1', [index]);

  // Resetting the credential proves ownership just as much as logging in does.
  await setSessionCookie(user.id);
  return 'ok';
}

/* -------------------------------------------------------------------------- */
/* Change e-mail address (while signed in)                                     */
/* -------------------------------------------------------------------------- */

export type EmailChangeRequestOutcome =
  | 'sent'
  | 'invalid_email'
  | 'wrong_secret'
  | 'email_taken'
  | 'cooldown';

/**
 * Starts an e-mail change: the caller must already be authenticated (checked
 * by the route) AND re-prove their current password/PIN, then the code is
 * sent to the *new* address to prove they can receive mail there too.
 */
export async function requestEmailChange(
  userId: string,
  newRawEmail: string,
  currentSecret: string,
): Promise<EmailChangeRequestOutcome> {
  const newEmail = normalizeEmail(newRawEmail);
  if (!newEmail) return 'invalid_email';

  const pool = await db();

  const { rows: userRows } = await pool.query<{ secret_hash: string }>(
    'SELECT secret_hash FROM users WHERE id = $1',
    [userId],
  );
  const user = userRows[0];
  if (!user || !(await verifySecret(currentSecret, user.secret_hash))) return 'wrong_secret';

  const newIndex = blindIndex(newEmail);
  const { rows: taken } = await pool.query('SELECT 1 FROM users WHERE email_index = $1', [
    newIndex,
  ]);
  if (taken[0]) return 'email_taken';

  const { rows } = await pool.query<{ created_at: string | number }>(
    'SELECT created_at FROM email_change_otp WHERE user_id = $1',
    [userId],
  );
  const existing = rows[0];
  if (existing && Number(existing.created_at) + OTP_RESEND_COOLDOWN_MS > Date.now()) {
    return 'cooldown';
  }

  const code = generateOtp();
  const now = Date.now();
  await pool.query(
    `INSERT INTO email_change_otp
       (user_id, new_email_index, new_email_encrypted, code_hash, expires_at, attempts, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       new_email_index = EXCLUDED.new_email_index,
       new_email_encrypted = EXCLUDED.new_email_encrypted,
       code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
       attempts = 0, created_at = EXCLUDED.created_at`,
    [
      userId,
      newIndex,
      encryptField(newEmail),
      keyedDigest('email-change-otp', code),
      now + OTP_TTL_MS,
      now,
    ],
  );

  await sendMail(
    newEmail,
    'メモアプリ メールアドレス変更の確認コード',
    `メールアドレス変更の確認コードは ${code} です。\n\n` +
      `このコードは発行から10分間有効です。心当たりがない場合はこのメールを無視してください。`,
  );
  return 'sent';
}

export type EmailChangeConfirmResult = 'ok' | 'invalid' | 'expired' | 'locked' | 'email_taken';

export async function confirmEmailChange(
  userId: string,
  code: string,
): Promise<EmailChangeConfirmResult> {
  if (!/^\d{4,10}$/.test(code)) return 'invalid';

  const pool = await db();
  const { rows } = await pool.query<{
    new_email_index: string;
    new_email_encrypted: string;
    code_hash: string;
    expires_at: string | number;
    attempts: number;
  }>(
    `SELECT new_email_index, new_email_encrypted, code_hash, expires_at, attempts
       FROM email_change_otp WHERE user_id = $1`,
    [userId],
  );
  const pending = rows[0];
  if (!pending) return 'invalid';

  if (pending.attempts >= OTP_MAX_ATTEMPTS) return 'locked';
  if (Number(pending.expires_at) < Date.now()) return 'expired';

  if (!digestsMatch(keyedDigest('email-change-otp', code), pending.code_hash)) {
    await pool.query('UPDATE email_change_otp SET attempts = attempts + 1 WHERE user_id = $1', [
      userId,
    ]);
    return pending.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid';
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Someone else could have registered the target address in the meantime.
    const { rows: taken } = await client.query(
      'SELECT 1 FROM users WHERE email_index = $1 AND id <> $2',
      [pending.new_email_index, userId],
    );
    if (taken[0]) {
      await client.query('ROLLBACK');
      return 'email_taken';
    }
    await client.query('UPDATE users SET email_index = $2, email_encrypted = $3 WHERE id = $1', [
      userId,
      pending.new_email_index,
      pending.new_email_encrypted,
    ]);
    await client.query('DELETE FROM email_change_otp WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return 'ok';
}
