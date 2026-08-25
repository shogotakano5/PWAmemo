'use client';

import * as local from './localdb';
import type { Memo, PublicUser, SyncResponse } from './types';

export type SessionInfo = {
  user: PublicUser | null;
  accountsEnabled: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof payload.message === 'string' ? payload.message : `通信に失敗しました (${response.status})`;
    const error = new Error(message) as Error & { code?: string; status?: number };
    error.code = typeof payload.error === 'string' ? payload.error : 'error';
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

export const auth = {
  me: () => api<SessionInfo>('/api/auth/me'),
  signup: (email: string, password: string) =>
    api<{ user: PublicUser }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    api<{ user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => api<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
};

/**
 * Pushes local changes and pulls everything the server has seen since the last
 * cursor. Safe to call repeatedly; it is a no-op when there is nothing to do.
 */
export async function syncNamespace(ns: local.Namespace): Promise<{ changed: boolean }> {
  const [pending, since] = await Promise.all([local.dirtyMemos(ns), local.getCursor(ns)]);

  // Oldest first, so a huge backlog still drains deterministically in batches.
  const batch = pending.sort((a, b) => a.updatedAt - b.updatedAt).slice(0, 200);

  const response = await api<SyncResponse>('/api/memos/sync', {
    method: 'POST',
    body: JSON.stringify({ since, changes: batch }),
  });

  const { changed } = await local.applySync(ns, response.memos, batch);

  const highest = response.memos.reduce((max, memo) => Math.max(max, memo.updatedAt), since);
  if (highest > since) await local.setCursor(ns, highest);

  await local.pruneTombstones(ns, 30 * 24 * 60 * 60 * 1000);

  // More local changes than one batch could carry — drain the rest.
  if (pending.length > batch.length) {
    const rest = await syncNamespace(ns);
    return { changed: changed || rest.changed };
  }
  return { changed };
}

export function newMemo(): Memo {
  const now = Date.now();
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${now}-${Math.random().toString(36).slice(2, 10)}`,
    title: '',
    content: '',
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
}

export { local };
