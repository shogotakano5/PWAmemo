'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_PIN_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_PIN_LENGTH,
  type SecretKind,
} from '@/lib/types';

type Props = {
  localMemoCount: number;
  onLogin: (email: string, secret: string, importLocal: boolean) => Promise<void>;
  onSignup: (
    email: string,
    secret: string,
    secretKind: SecretKind,
    importLocal: boolean,
  ) => Promise<void>;
  onClose: () => void;
};

/** Mirrors the server-side rule so the user is told before a round trip. */
function localSecretError(secret: string, kind: SecretKind): string | null {
  if (kind === 'pin') {
    if (!new RegExp(`^\\d{${MIN_PIN_LENGTH},${MAX_PIN_LENGTH}}$`).test(secret)) {
      return `PINは${MIN_PIN_LENGTH}〜${MAX_PIN_LENGTH}桁の数字で入力してください。`;
    }
    if (/^(\d)\1*$/.test(secret)) return '同じ数字の繰り返しは使えません。';
    if ('01234567890'.includes(secret) || '09876543210'.includes(secret)) {
      return '連番のPINは使えません。';
    }
    return null;
  }
  if (secret.length < MIN_PASSWORD_LENGTH) {
    return `パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください。`;
  }
  return null;
}

export default function AuthDialog({ localMemoCount, onLogin, onSignup, onClose }: Props) {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [kind, setKind] = useState<SecretKind>('password');
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [importLocal, setImportLocal] = useState(localMemoCount > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importTouched = useRef(false);
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

  const isPin = tab === 'signup' && kind === 'pin';

  const secretLabel = useMemo(() => {
    if (tab === 'login') return 'パスワード または PIN';
    return isPin ? `PIN（${MIN_PIN_LENGTH}〜${MAX_PIN_LENGTH}桁の数字）` : `パスワード（${MIN_PASSWORD_LENGTH}文字以上）`;
  }, [tab, isPin]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (tab === 'signup') {
      const problem = localSecretError(secret, kind);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      if (tab === 'login') await onLogin(email, secret, importLocal);
      else await onSignup(email, secret, kind, importLocal);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '処理に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const switchTab = (next: 'login' | 'signup') => {
    setTab(next);
    setSecret('');
    setError(null);
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
            onClick={() => switchTab('login')}
          >
            ログイン
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'signup'}
            onClick={() => switchTab('signup')}
          >
            新規登録
          </button>
        </div>

        <h2 id="auth-title">{tab === 'login' ? 'アカウントにログイン' : 'アカウントを作成'}</h2>
        <p className="lead">
          メールアドレスがそのままユーザIDになります。ログインするとメモがサーバに保存され、
          複数の端末で同期されます。オフライン中の編集はオンラインに戻ったときに自動で送信されます。
        </p>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <form onSubmit={submit}>
          <label className="field">
            <span>メールアドレス（ユーザID）</span>
            <input
              ref={emailRef}
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          {tab === 'signup' ? (
            <div className="field">
              <span>ログイン方法</span>
              <div className="mode-switch" role="group" aria-label="ログイン方法">
                <button
                  type="button"
                  aria-pressed={kind === 'password'}
                  onClick={() => {
                    setKind('password');
                    setSecret('');
                    setError(null);
                  }}
                >
                  パスワード
                </button>
                <button
                  type="button"
                  aria-pressed={kind === 'pin'}
                  onClick={() => {
                    setKind('pin');
                    setSecret('');
                    setError(null);
                  }}
                >
                  PIN（数字）
                </button>
              </div>
            </div>
          ) : null}

          <label className="field">
            <span>{secretLabel}</span>
            <input
              type="password"
              value={secret}
              required
              inputMode={isPin ? 'numeric' : 'text'}
              pattern={isPin ? '\\d*' : undefined}
              maxLength={isPin ? MAX_PIN_LENGTH : 200}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              onChange={(event) =>
                setSecret(isPin ? event.target.value.replace(/\D/g, '') : event.target.value)
              }
            />
          </label>

          {isPin ? (
            <p className="hint">
              PINは短いぶん推測されやすいため、ログインに5回続けて失敗するとしばらくロックされます。
              大切なメモにはパスワードをおすすめします。
            </p>
          ) : null}

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
