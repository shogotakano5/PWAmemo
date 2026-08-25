'use client';

import { formatShort, snippet } from '@/lib/format';
import type { Memo } from '@/lib/types';

type Props = {
  memos: Memo[];
  selectedId: string | null;
  loading: boolean;
  query: string;
  onSelect: (id: string) => void;
};

export default function MemoList({ memos, selectedId, loading, query, onSelect }: Props) {
  if (loading) {
    return <p className="empty">読み込み中…</p>;
  }
  if (memos.length === 0) {
    return (
      <p className="empty">
        {query ? `「${query}」に一致するメモはありません。` : 'メモはまだありません。「新規」で作成できます。'}
      </p>
    );
  }

  return (
    <ul className="memo-list">
      {memos.map((memo) => (
        <li key={memo.id}>
          <button
            type="button"
            className="memo-item"
            aria-current={memo.id === selectedId}
            onClick={() => onSelect(memo.id)}
          >
            <div className="memo-title">{memo.title || '無題のメモ'}</div>
            <div className="memo-meta">
              <time dateTime={new Date(memo.updatedAt).toISOString()}>
                {formatShort(memo.updatedAt)}
              </time>
              <span className="memo-snippet">{snippet(memo.content) || '本文なし'}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
