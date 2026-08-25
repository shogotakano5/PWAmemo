'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  localMemoCount: number;
  onLogin: (email: string, password: string, importLocal: boolean) => Promise<void>;
  onSignup: (email: string, password: string, importLocal: boolean) => Promise<void>;
  onClose: () => void;
};

export default function AuthDialog({ localMemoCount, onLogin, onSignup, onClose }: Props) {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [importLocal, setImportLocal] = useState(localMemoCount > 0);
  const importTouched = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // The count is read from IndexedDB asynchronously, so it can arrive after the
  // dialog has mounted; default to "import" until the user says otherwise.
  useEffect(() => {
    if (!importTouched.current) setImportLocal(localMemoCount > 0);
  }, [localMemoCount]);

  useEffect(() => {
    emailRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === 'login') await onLogin(email, password, importLocal);
      else await onSignup(email, password, importLocal);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '処理に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            onClick={() => setTab('login')}
          >
            ログイン
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'signup'}
            onClick={() => setTab('signup')}
          >
            新規登録
          </button>
        </div>

        <h2 id="auth-title">{tab === 'login' ? 'アカウントにログイン' : 'アカウントを作成'}</h2>
        <p className="lead">
          ログインするとメモがサーバに保存され、複数の端末で同期されます。オフライン中の編集は
          オンラインに戻ったときに自動で送信されます。
        </p>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <form onSubmit={submit}>
          <label className="field">
            <span>メールアドレス</span>
            <input
              ref={emailRef}
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field">
            <span>パスワード（8文字以上）</span>
            <input
              type="password"
              value={password}
              minLength={8}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {localMemoCount > 0 ? (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={importLocal}
                onChange={(event) => {
                  importTouched.current = true;
                  setImportLocal(event.target.checked);
                }}
              />
              <span>
                この端末に保存されている {localMemoCount} 件のメモをアカウントに取り込む
                （ローカルのメモはそのまま残ります）
              </span>
            </label>
          ) : null}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              キャンセル
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? '処理中…' : tab === 'login' ? 'ログイン' : '登録する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
