'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi, type AdminUser } from '@/lib/adminStore';

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

type Step = 'loading' | 'not-configured' | 'request' | 'verify' | 'dashboard';

export default function AdminPanel() {
  const [step, setStep] = useState<Step>('loading');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const codeRef = useRef<HTMLInputElement>(null);

  const bootstrap = useCallback(async () => {
    try {
      const info = await adminApi.session();
      if (!info.configured) {
        setStep('not-configured');
        return;
      }
      if (info.admin) {
        setAdminEmail(info.admin.email);
        setStep('dashboard');
      } else {
        setStep('request');
      }
    } catch {
      setStep('not-configured');
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const result = await adminApi.listUsers();
      setUsers(result.users);
      setTruncated(result.truncated);
    } catch (caught) {
      const err = caught as Error & { status?: number };
      if (err.status === 401) {
        setStep('request');
      } else {
        setUsersError(err.message);
      }
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step === 'dashboard') void loadUsers();
  }, [step, loadUsers]);

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.requestOtp(email);
      setNotice(result.message);
      setStep('verify');
      setCooldown(60);
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '送信に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const submitVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.verifyOtp(email, code);
      setAdminEmail(email);
      setStep('dashboard');
      setCode('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '認証に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.requestOtp(email);
      setNotice(result.message);
      setCooldown(60);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '送信に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await adminApi.logout();
    } catch (caught) {
      console.error('[admin] logout failed', caught);
    }
    setAdminEmail(null);
    setUsers([]);
    setEmail('');
    setStep('request');
  };

  const deleteUser = async (user: AdminUser) => {
    if (!window.confirm(`${user.email} を削除しますか？\nこのアカウントのメモも全て削除されます。この操作は取り消せません。`)) {
      return;
    }
    setDeletingId(user.id);
    setUsersError(null);
    try {
      await adminApi.deleteUser(user.id);
      setUsers((current) => current.filter((item) => item.id !== user.id));
    } catch (caught) {
      const err = caught as Error & { status?: number };
      if (err.status === 401) setStep('request');
      else setUsersError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  if (step === 'loading') {
    return (
      <main className="admin-shell">
        <p className="empty">読み込み中…</p>
      </main>
    );
  }

  if (step === 'not-configured') {
    return (
      <main className="admin-shell">
        <div className="admin-card">
          <h1>管理画面</h1>
          <p className="lead">
            管理画面は未設定です。次の環境変数をすべて設定すると利用できます。
          </p>
          <ul className="admin-config-list">
            <li><code>POSTGRES_URL</code> — アカウントデータベース</li>
            <li><code>AUTH_SECRET</code> — セッション署名・暗号化鍵</li>
            <li><code>ADMIN_EMAILS</code> — 管理者として許可するメールアドレス（カンマ区切り）</li>
            <li><code>SMTP_HOST</code> / <code>SMTP_FROM</code>（必要に応じて <code>SMTP_PORT</code> / <code>SMTP_USER</code> / <code>SMTP_PASS</code>）— ログインコードの送信元</li>
          </ul>
        </div>
      </main>
    );
  }

  if (step === 'request' || step === 'verify') {
    return (
      <main className="admin-shell">
        <div className="admin-card">
          <h1>管理画面ログイン</h1>
          <p className="lead">
            管理者のメールアドレスにワンタイムコードを送信します。届いたコードを入力してください。
          </p>

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {notice && step === 'verify' ? <p className="admin-notice">{notice}</p> : null}

          {step === 'request' ? (
            <form onSubmit={submitRequest}>
              <label className="field">
                <span>管理者のメールアドレス</span>
                <input
                  type="email"
                  value={email}
                  autoComplete="email"
                  autoFocus
                  required
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? '送信中…' : 'コードを送信'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitVerify}>
              <p className="admin-meta">{email} 宛に送信しました</p>
              <label className="field">
                <span>ログインコード</span>
                <input
                  ref={codeRef}
                  type="text"
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={6}
                  value={code}
                  required
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                />
              </label>
              <div className="modal-actions admin-actions-row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={resend}
                  disabled={busy || cooldown > 0}
                >
                  {cooldown > 0 ? `再送信 (${cooldown}s)` : 'コードを再送信'}
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? '確認中…' : 'ログイン'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="admin-shell admin-shell-wide">
      <div className="admin-card admin-card-wide">
        <div className="admin-header">
          <div>
            <h1>アカウント管理</h1>
            <p className="admin-meta">ログイン中: {adminEmail}</p>
          </div>
          <div className="admin-header-actions">
            <button type="button" className="btn" onClick={() => void loadUsers()} disabled={usersLoading}>
              更新
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
              ログアウト
            </button>
          </div>
        </div>

        {usersError ? <p className="form-error" role="alert">{usersError}</p> : null}
        {truncated ? (
          <p className="admin-notice">先頭 {users.length} 件のみ表示しています。</p>
        ) : null}

        {usersLoading ? (
          <p className="empty">読み込み中…</p>
        ) : users.length === 0 ? (
          <p className="empty">登録されているアカウントはありません。</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>メールアドレス</th>
                  <th>ログイン方法</th>
                  <th>メモ数</th>
                  <th>登録日</th>
                  <th>状態</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const locked = user.lockedUntil > Date.now();
                  return (
                    <tr key={user.id}>
                      <td className={user.decryptable ? undefined : 'admin-cell-muted'}>
                        {user.email}
                      </td>
                      <td>{user.secretKind === 'pin' ? 'PIN' : 'パスワード'}</td>
                      <td>{user.memoCount}</td>
                      <td>{dateFormatter.format(new Date(user.createdAt))}</td>
                      <td>
                        {!user.decryptable ? (
                          <span className="badge" title="AUTH_SECRET が変更された可能性があります">
                            <span className="dot dot-error" />
                            復号エラー
                          </span>
                        ) : locked ? (
                          <span className="badge">
                            <span className="dot dot-error" />
                            ロック中
                          </span>
                        ) : user.failedAttempts > 0 ? (
                          <span className="badge">
                            <span className="dot dot-warn" />
                            失敗 {user.failedAttempts} 回
                          </span>
                        ) : (
                          <span className="badge">
                            <span className="dot dot-ok" />
                            正常
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-icon"
                          onClick={() => void deleteUser(user)}
                          disabled={deletingId === user.id}
                        >
                          {deletingId === user.id ? '削除中…' : '削除'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
