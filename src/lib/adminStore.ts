'use client';

export type AdminUser = {
  id: string;
  email: string;
  /** False when the stored e-mail could not be decrypted with the current AUTH_SECRET. */
  decryptable: boolean;
  secretKind: 'password' | 'pin';
  createdAt: number;
  failedAttempts: number;
  lockedUntil: number;
  memoCount: number;
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

export const adminApi = {
  session: () =>
    api<{ admin: { email: string } | null; configured: boolean }>('/api/admin/session'),
  requestOtp: (email: string) =>
    api<{ ok: true; message: string }>('/api/admin/otp/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  verifyOtp: (email: string, code: string) =>
    api<{ ok: true }>('/api/admin/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),
  logout: () => api<{ ok: true }>('/api/admin/logout', { method: 'POST' }),
  listUsers: () => api<{ users: AdminUser[]; truncated: boolean }>('/api/admin/users'),
  deleteUser: (id: string) =>
    api<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
