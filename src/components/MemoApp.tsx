'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import AuthDialog from './AuthDialog';
import MemoEditor from './MemoEditor';
import MemoList from './MemoList';
import { usePwa } from '@/lib/usePwa';
import { useMemoStore, type SyncState } from '@/lib/useMemoStore';
import { local } from '@/lib/store';
import type { Memo } from '@/lib/types';

function StatusBadge({
  mode,
  online,
  syncState,
}: {
  mode: 'local' | 'account';
  online: boolean;
  syncState: SyncState;
}) {
  if (mode === 'local') {
    return (
      <span className="badge" title="メモはこの端末のブラウザにのみ保存されます">
        <span className="dot" />
        この端末に保存
      </span>
    );
  }
  if (!online) {
    return (
      <span className="badge" title="オフラインです。変更は端末に保存され、後で自動送信されます">
        <span className="dot dot-warn" />
        オフライン
      </span>
    );
  }
  const label: Record<SyncState, [string, string]> = {
    idle: ['dot', '同期待ち'],
    syncing: ['dot dot-sync', '同期中…'],
    synced: ['dot dot-ok', '同期済み'],
    offline: ['dot dot-warn', 'オフライン'],
    error: ['dot dot-error', '同期エラー'],
  };
  const [dotClass, text] = label[syncState];
  return (
    <span className="badge">
      <span className={dotClass} />
      {text}
    </span>
  );
}

export default function MemoApp() {
  const store = useMemoStore();
  const { canInstall, install, updateReady, applyUpdate } = usePwa();

  const [query, setQuery] = useState('');
  const [pane, setPane] = useState<'list' | 'editor'>('list');
  const [authOpen, setAuthOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [localMemoCount, setLocalMemoCount] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const shortcutHandled = useRef(false);

  const {
    user,
    session,
    mode,
    memos,
    selected,
    selectedId,
    loading,
    online,
    syncState,
    syncError,
    storageError,
  } = store;

  const accountsEnabled = session?.accountsEnabled ?? false;

  const filtered = useMemo<Memo[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return memos;
    return memos.filter(
      (memo) =>
        memo.title.toLowerCase().includes(needle) || memo.content.toLowerCase().includes(needle),
    );
  }, [memos, query]);

  // Count guest memos so the login dialog can offer to import them. Reading it
  // as memos change keeps the number ready before the dialog is opened.
  useEffect(() => {
    let cancelled = false;
    local
      .listMemos(local.LOCAL_NAMESPACE)
      .then((list) => {
        if (!cancelled) setLocalMemoCount(list.length);
      })
      .catch(() => {
        if (!cancelled) setLocalMemoCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [memos, authOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  // The manifest shortcut opens /?new=1 — start a blank memo straight away.
  useEffect(() => {
    if (shortcutHandled.current || loading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') !== '1') return;
    shortcutHandled.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    void store.createMemo().then(() => setPane('editor'));
    // store.createMemo is stable; re-running on every store change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const handleCreate = async () => {
    await store.createMemo();
    setQuery('');
    setPane('editor');
  };

  const handleSelect = (id: string) => {
    store.setSelectedId(id);
    setPane('editor');
  };

  return (
    <div className="app" data-pane={pane}>
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ✎
          </span>
          <span>メモ</span>
        </div>
        <StatusBadge mode={mode} online={online} syncState={syncState} />
        <span className="header-spacer" />
        <div className="header-actions">
          {canInstall ? (
            <button type="button" className="btn hide-sm" onClick={() => void install()}>
              インストール
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            onClick={() => (user ? setMenuOpen((open) => !open) : setAuthOpen(true))}
            aria-expanded={user ? menuOpen : undefined}
          >
            {user ? 'アカウント' : 'ログイン'}
          </button>
        </div>
      </header>

      {updateReady ? (
        <div className="notice notice-info">
          新しいバージョンがあります。{' '}
          <button type="button" className="btn btn-ghost" onClick={applyUpdate}>
            今すぐ更新
          </button>
        </div>
      ) : null}
      {storageError ? <div className="notice">{storageError}</div> : null}
      {syncError ? <div className="notice">{syncError}</div> : null}
      {session && !accountsEnabled && !user ? (
        <div className="notice notice-info">
          サーバ保存は未設定のため、メモはこの端末にのみ保存されます（オフラインでも利用できます）。
        </div>
      ) : null}

      <main className="main">
        <aside className="sidebar">
          <div className="sidebar-top">
            <input
              className="search"
              type="search"
              value={query}
              placeholder="メモを検索"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="メモを検索"
            />
            <button type="button" className="btn btn-primary" onClick={() => void handleCreate()}>
              ＋ 新規
            </button>
          </div>
          <MemoList
            memos={filtered}
            selectedId={selectedId}
            loading={loading}
            query={query}
            onSelect={handleSelect}
          />
        </aside>

        {selected ? (
          <MemoEditor
            key={selected.id}
            memo={selected}
            onChange={(id, content) => void store.updateMemo(id, content)}
            onDelete={(id) => {
              void store.deleteMemo(id);
              setPane('list');
            }}
            onBack={() => setPane('list')}
          />
        ) : (
          <section className="editor">
            <p className="empty">左の一覧からメモを選ぶか、「＋ 新規」で作成してください。</p>
          </section>
        )}
      </main>

      {menuOpen && user ? (
        <div className="menu" ref={menuRef}>
          <h3>アカウント</h3>
          <p className="muted">
            {user.email}
            <br />
            ログイン方法: {user.secretKind === 'pin' ? 'PIN（数字）' : 'パスワード'}
          </p>
          <div className="mode-switch" role="group" aria-label="保存先">
            <button
              type="button"
              aria-pressed={mode === 'account'}
              onClick={() => store.switchMode('account')}
            >
              サーバに同期
            </button>
            <button
              type="button"
              aria-pressed={mode === 'local'}
              onClick={() => store.switchMode('local')}
            >
              この端末のみ
            </button>
          </div>
          <div className="menu-actions">
            {mode === 'account' ? (
              <button
                type="button"
                className="btn"
                onClick={() => void store.syncNow()}
                disabled={!online || syncState === 'syncing'}
              >
                今すぐ同期
              </button>
            ) : null}
            {canInstall ? (
              <button type="button" className="btn" onClick={() => void install()}>
                ホーム画面にインストール
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setMenuOpen(false);
                const forgetCache = window.confirm(
                  'ログアウトします。\n\nこの端末に残っているアカウントのメモのコピーも削除しますか？\n' +
                    '（OK: 削除する / キャンセル: 端末に残す）',
                );
                void store.logout({ forgetCache });
              }}
            >
              ログアウト
            </button>
          </div>
        </div>
      ) : null}

      {authOpen ? (
        <AuthDialog
          localMemoCount={localMemoCount}
          onLogin={store.login}
          onSignup={store.signup}
          onClose={() => setAuthOpen(false)}
        />
      ) : null}
    </div>
  );
}
