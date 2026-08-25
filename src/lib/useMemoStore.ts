'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth, local, newMemo, syncNamespace, type SessionInfo } from './store';
import { deriveTitle, type Memo, type PublicUser, type StorageMode } from './types';

const MODE_KEY = 'pwa-memo:mode';
const SYNC_INTERVAL_MS = 30_000;

export type SyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

function readStoredMode(): StorageMode {
  if (typeof localStorage === 'undefined') return 'local';
  return localStorage.getItem(MODE_KEY) === 'account' ? 'account' : 'local';
}

export function useMemoStore() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [preferredMode, setPreferredMode] = useState<StorageMode>('local');
  const [memos, setMemos] = useState<Memo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  const user = session?.user ?? null;
  const mode: StorageMode = user && preferredMode === 'account' ? 'account' : 'local';
  const namespace = useMemo(
    () => (mode === 'account' && user ? local.accountNamespace(user.id) : local.LOCAL_NAMESPACE),
    [mode, user],
  );

  const namespaceRef = useRef(namespace);
  namespaceRef.current = namespace;
  const memosRef = useRef<Memo[]>([]);
  memosRef.current = memos;
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ----------------------------------------------------------------------- */
  /* Bootstrapping                                                            */
  /* ----------------------------------------------------------------------- */

  useEffect(() => {
    setPreferredMode(readStoredMode());
    setOnline(navigator.onLine);

    const goOnline = () => setOnline(true);
    const goOffline = () => {
      setOnline(false);
      setSyncState('offline');
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    auth
      .me()
      .then((info) => {
        if (!cancelled) setSession(info);
      })
      .catch(() => {
        // Offline or the API is unreachable — fall back to local-only.
        if (!cancelled) setSession({ user: null, accountsEnabled: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async (ns: string) => {
    try {
      const list = await local.listMemos(ns);
      if (namespaceRef.current !== ns) return;
      setMemos(list);
      setStorageError(null);
    } catch (error) {
      console.error('[store] failed to read memos', error);
      setStorageError(
        'この端末のストレージ（IndexedDB）を利用できません。プライベートブラウズを解除するとメモを保存できます。',
      );
    }
  }, []);

  /* ----------------------------------------------------------------------- */
  /* Sync                                                                     */
  /* ----------------------------------------------------------------------- */

  const runSync = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const ns = namespaceRef.current;
      if (!ns.startsWith('u:')) return;
      if (!navigator.onLine) {
        setSyncState('offline');
        return;
      }
      if (!options.silent) setSyncState('syncing');
      try {
        const { changed } = await syncNamespace(ns);
        if (namespaceRef.current !== ns) return;
        setSyncError(null);
        setSyncState('synced');
        if (changed) await reload(ns);
      } catch (error) {
        if (namespaceRef.current !== ns) return;
        const err = error as Error & { status?: number };
        if (err.status === 401) {
          setSession((current) => (current ? { ...current, user: null } : current));
          setPreferredMode('local');
          setSyncError('セッションの期限が切れました。もう一度ログインしてください。');
        } else {
          setSyncError(err.message);
        }
        setSyncState('error');
      }
    },
    [reload],
  );

  /** Coalesces the sync requests triggered by rapid typing. */
  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void runSync({ silent: true }), 1200);
  }, [runSync]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      await reload(namespace);
      if (!cancelled) setLoading(false);
      if (namespace.startsWith('u:')) await runSync();
    })();
    return () => {
      cancelled = true;
    };
  }, [namespace, reload, runSync]);

  useEffect(() => {
    if (!namespace.startsWith('u:')) return;
    const interval = setInterval(() => void runSync({ silent: true }), SYNC_INTERVAL_MS);
    const onFocus = () => void runSync({ silent: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void runSync({ silent: true });
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [namespace, runSync]);

  useEffect(
    () => () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    },
    [],
  );

  /* ----------------------------------------------------------------------- */
  /* Mutations                                                                */
  /* ----------------------------------------------------------------------- */

  const persist = useCallback(
    async (memo: Memo) => {
      const ns = namespaceRef.current;
      try {
        await local.saveMemo(ns, memo, true);
        setStorageError(null);
      } catch (error) {
        console.error('[store] failed to save memo', error);
        setStorageError('メモを保存できませんでした。ストレージの空き容量を確認してください。');
        return;
      }
      if (ns.startsWith('u:')) scheduleSync();
    },
    [scheduleSync],
  );

  const createMemo = useCallback(async () => {
    const memo = newMemo();
    setMemos((current) => [memo, ...current]);
    setSelectedId(memo.id);
    await persist(memo);
    return memo;
  }, [persist]);

  const updateMemo = useCallback(
    async (id: string, content: string) => {
      const target = memosRef.current.find((memo) => memo.id === id);
      if (!target || target.content === content) return;

      const next: Memo = {
        ...target,
        content,
        title: deriveTitle(content),
        updatedAt: Date.now(),
      };
      setMemos((current) =>
        current
          .map((memo) => (memo.id === id ? next : memo))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
      await persist(next);
    },
    [persist],
  );

  const deleteMemo = useCallback(
    async (id: string) => {
      const target = memosRef.current.find((memo) => memo.id === id);
      if (!target) return;
      const tombstone: Memo = { ...target, deleted: true, updatedAt: Date.now() };
      setMemos((current) => current.filter((memo) => memo.id !== id));
      setSelectedId((current) => (current === id ? null : current));
      await persist(tombstone);
    },
    [persist],
  );

  /* ----------------------------------------------------------------------- */
  /* Account actions                                                          */
  /* ----------------------------------------------------------------------- */

  const afterLogin = useCallback(
    async (loggedIn: PublicUser, importLocal: boolean) => {
      setSession({ accountsEnabled: true, user: loggedIn });
      if (importLocal) {
        try {
          await local.copyMemos(local.LOCAL_NAMESPACE, local.accountNamespace(loggedIn.id));
        } catch (error) {
          console.error('[store] failed to import local memos', error);
        }
      }
      localStorage.setItem(MODE_KEY, 'account');
      setPreferredMode('account');
      setSelectedId(null);
    },
    [],
  );

  const login = useCallback(
    async (email: string, password: string, importLocal: boolean) => {
      const { user: loggedIn } = await auth.login(email, password);
      await afterLogin(loggedIn, importLocal);
    },
    [afterLogin],
  );

  const signup = useCallback(
    async (email: string, password: string, importLocal: boolean) => {
      const { user: created } = await auth.signup(email, password);
      await afterLogin(created, importLocal);
    },
    [afterLogin],
  );

  const logout = useCallback(async (options: { forgetCache?: boolean } = {}) => {
    const currentUser = session?.user;
    try {
      await auth.logout();
    } catch (error) {
      console.error('[store] logout request failed', error);
    }
    if (options.forgetCache && currentUser) {
      await local.clearNamespace(local.accountNamespace(currentUser.id)).catch(() => {});
    }
    localStorage.setItem(MODE_KEY, 'local');
    setPreferredMode('local');
    setSession((current) => (current ? { ...current, user: null } : current));
    setSelectedId(null);
    setSyncState('idle');
    setSyncError(null);
  }, [session]);

  const switchMode = useCallback(
    (next: StorageMode) => {
      if (next === 'account' && !user) return;
      localStorage.setItem(MODE_KEY, next);
      setPreferredMode(next);
      setSelectedId(null);
    },
    [user],
  );

  const selected = memos.find((memo) => memo.id === selectedId) ?? null;

  return {
    session,
    user,
    mode,
    memos,
    selected,
    selectedId,
    loading,
    online,
    syncState,
    syncError,
    storageError,
    setSelectedId,
    createMemo,
    updateMemo,
    deleteMemo,
    login,
    signup,
    logout,
    switchMode,
    syncNow: () => runSync(),
  };
}
