/** A single memo. The same shape is used locally (IndexedDB) and on the server. */
export type Memo = {
  id: string;
  title: string;
  content: string;
  /** Epoch millis. */
  createdAt: number;
  /** Epoch millis. Drives last-write-wins conflict resolution during sync. */
  updatedAt: number;
  /** Soft delete so deletions can propagate between devices. */
  deleted: boolean;
};

export type PublicUser = {
  id: string;
  email: string;
};

/** Where the memos the user is currently looking at live. */
export type StorageMode = 'local' | 'account';

export type SyncRequest = {
  /** Only memos changed strictly after this epoch-millis are returned. */
  since: number;
  changes: Memo[];
};

export type SyncResponse = {
  memos: Memo[];
  serverTime: number;
};

export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_LENGTH = 100_000;

/** Derives a display title from the memo body, mirroring the client behaviour. */
export function deriveTitle(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  if (!firstLine) return '';
  return firstLine.replace(/^#+\s*/, '').trim().slice(0, MAX_TITLE_LENGTH);
}
