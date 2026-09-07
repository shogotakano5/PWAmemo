'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  currentEmail: string;
  onRequestChange: (newEmail: string, currentSecret: string) => Promise<{ message: string }>;
  onConfirmChange: (code: string) => Promise<void>;
  onClose: () => void;
};

type Step = 'request' | 'confirm';

export default function EmailChangeDialog({
  currentEmail,
  onRequestChange,
  onConfirmChange,
  onClose,
}: Props) {
  const [step, setStep] = useState<Step>('request');
  const [newEmail, setNewEmail] = useState('');
  const [currentSecret, setCurrentSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (step === 'confirm' ? codeRef : emailRef).current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, step]);

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await onRequestChange(newEmail, currentSecret);
      setNotice(result.message);
      setStep('confirm');
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '送信に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const submitConfirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirmChange(code);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '確認に失敗しました。');
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
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="email-change-title">
        <h2 id="email-change-title">メールアドレスの変更</h2>
        <p className="lead">
          {step === 'request'
            ? `現在のメールアドレスは ${currentEmail} です。新しいメールアドレス宛に確認コードを送信します。`
            : `${newEmail} 宛に送信したコードを入力してください。`}
        </p>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice && step === 'confirm' ? <p className="admin-notice">{notice}</p> : null}

        {step === 'request' ? (
          <form onSubmit={submitRequest}>
            <label className="field">
              <span>新しいメールアドレス</span>
              <input
                ref={emailRef}
                type="email"
                value={newEmail}
                autoComplete="email"
                required
                onChange={(event) => setNewEmail(event.target.value)}
              />
            </label>
            <label className="field">
              <span>現在のパスワードまたはPIN</span>
              <input
                type="password"
                value={currentSecret}
                autoComplete="current-password"
                required
                onChange={(event) => setCurrentSecret(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose} disabled={busy}>
                キャンセル
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? '送信中…' : 'コードを送信'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitConfirm}>
            <label className="field">
              <span>確認コード</span>
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
            <div className="modal-actions auth-actions-row">
              <button type="button" className="link-button" onClick={() => setStep('request')}>
                やり直す
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? '確認中…' : '変更を確定'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
