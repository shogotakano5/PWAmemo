import type { Memo } from './types';

const DB_NAME = 'pwa-memo';
const DB_VERSION = 1;
const MEMO_STORE = 'memos';
const META_STORE = 'meta';

/**
 * A namespace isolates one set of memos from another inside the same browser:
 * `local` holds guest memos, `u:<userId>` holds the offline cache of an account.
 */
export type Namespace = string;

export const LOCAL_NAMESPACE: Namespace = 'local';
export const accountNamespace = (userId: string): Namespace => `u:${userId}`;

export type MemoRecord = {
  /** `${ns}|${memo.id}` — the primary key. */
  key: string;
  ns: Namespace;
  memo: Memo;
  /** True when the memo has local changes that have not reached the server. */
  dirty: boolean;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable'));
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(MEMO_STORE)) {
          const store = database.createObjectStore(MEMO_STORE, { keyPath: 'key' });
          store.createIndex('ns', 'ns', { unique: false });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

function run<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const tx = database.transaction(storeNames, mode);
        let result: T;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        Promise.resolve(body(tx))
          .then((value) => {
            result = value;
          })
          .catch((error) => {
            reject(error);
            tx.abort();
          });
      }),
  );
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

const keyOf = (ns: Namespace, id: string) => `${ns}|${id}`;

export async function allRecords(ns: Namespace): Promise<MemoRecord[]> {
  return run(MEMO_STORE, 'readonly', (tx) =>
    request(tx.objectStore(MEMO_STORE).index('ns').getAll(IDBKeyRange.only(ns))),
  ) as Promise<MemoRecord[]>;
}

/** Live memos (tombstones excluded), newest first. */
export async function listMemos(ns: Namespace): Promise<Memo[]> {
  const records = await allRecords(ns);
  return records
    .map((record) => record.memo)
    .filter((memo) => !memo.deleted)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveMemo(ns: Namespace, memo: Memo, dirty: boolean): Promise<void> {
  await run(MEMO_STORE, 'readwrite', (tx) =>
    request(tx.objectStore(MEMO_STORE).put({ key: keyOf(ns, memo.id), ns, memo, dirty })),
  );
}

export async function getRecord(ns: Namespace, id: string): Promise<MemoRecord | undefined> {
  return run(MEMO_STORE, 'readonly', (tx) =>
    request(tx.objectStore(MEMO_STORE).get(keyOf(ns, id))),
  ) as Promise<MemoRecord | undefined>;
}

export async function dirtyMemos(ns: Namespace): Promise<Memo[]> {
  const records = await allRecords(ns);
  return records.filter((record) => record.dirty).map((record) => record.memo);
}

/**
 * Applies server state and acknowledges pushed memos in a single transaction so
 * a change made while the request was in flight is never marked as synced.
 */
export async function applySync(
  ns: Namespace,
  incoming: Memo[],
  pushed: Memo[],
): Promise<{ changed: boolean }> {
  return run(MEMO_STORE, 'readwrite', async (tx) => {
    const store = tx.objectStore(MEMO_STORE);
    let changed = false;

    for (const memo of pushed) {
      const key = keyOf(ns, memo.id);
      const existing = (await request(store.get(key))) as MemoRecord | undefined;
      if (existing && existing.memo.updatedAt === memo.updatedAt) {
        await request(store.put({ ...existing, dirty: false }));
      }
    }

    for (const memo of incoming) {
      const key = keyOf(ns, memo.id);
      const existing = (await request(store.get(key))) as MemoRecord | undefined;
      if (!existing || existing.memo.updatedAt < memo.updatedAt) {
        await request(store.put({ key, ns, memo, dirty: false }));
        changed = true;
      }
    }

    return { changed };
  });
}

/** Removes tombstones that have already been synced, keeping the store small. */
export async function pruneTombstones(ns: Namespace, olderThanMs: number): Promise<void> {
  const records = await allRecords(ns);
  const cutoff = Date.now() - olderThanMs;
  const stale = records.filter(
    (record) => record.memo.deleted && !record.dirty && record.memo.updatedAt < cutoff,
  );
  if (stale.length === 0) return;
  await run(MEMO_STORE, 'readwrite', async (tx) => {
    const store = tx.objectStore(MEMO_STORE);
    for (const record of stale) await request(store.delete(record.key));
  });
}

export async function clearNamespace(ns: Namespace): Promise<void> {
  const records = await allRecords(ns);
  await run([MEMO_STORE, META_STORE], 'readwrite', async (tx) => {
    const store = tx.objectStore(MEMO_STORE);
    for (const record of records) await request(store.delete(record.key));
    await request(tx.objectStore(META_STORE).delete(`cursor:${ns}`));
  });
}

/** Copies memos from one namespace into another, used when importing guest memos. */
export async function copyMemos(from: Namespace, to: Namespace): Promise<number> {
  const records = await allRecords(from);
  const live = records.filter((record) => !record.memo.deleted);
  if (live.length === 0) return 0;
  await run(MEMO_STORE, 'readwrite', async (tx) => {
    const store = tx.objectStore(MEMO_STORE);
    for (const record of live) {
      const key = keyOf(to, record.memo.id);
      const existing = (await request(store.get(key))) as MemoRecord | undefined;
      if (existing && existing.memo.updatedAt >= record.memo.updatedAt) continue;
      await request(store.put({ key, ns: to, memo: record.memo, dirty: true }));
    }
  });
  return live.length;
}

export async function getCursor(ns: Namespace): Promise<number> {
  const row = (await run(META_STORE, 'readonly', (tx) =>
    request(tx.objectStore(META_STORE).get(`cursor:${ns}`)),
  )) as { key: string; value: number } | undefined;
  return row?.value ?? 0;
}

export async function setCursor(ns: Namespace, value: number): Promise<void> {
  await run(META_STORE, 'readwrite', (tx) =>
    request(tx.objectStore(META_STORE).put({ key: `cursor:${ns}`, value })),
  );
}
