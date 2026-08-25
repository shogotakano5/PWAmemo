'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatFull } from '@/lib/format';
import type { Memo } from '@/lib/types';

const AUTOSAVE_DELAY_MS = 400;

type Props = {
  memo: Memo;
  onChange: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
};

export default function MemoEditor({ memo, onChange, onDelete, onBack }: Props) {
  const [text, setText] = useState(memo.content);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const currentId = useRef(memo.id);
  const pending = useRef<{ id: string; content: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const edit = pending.current;
    pending.current = null;
    if (edit) onChangeRef.current(edit.id, edit.content);
  }, []);

  // Switching memos must not carry an unsaved edit over to the new one.
  useEffect(() => {
    if (currentId.current !== memo.id) {
      flush();
      currentId.current = memo.id;
      setText(memo.content);
      return;
    }
    // Adopt content pulled from the server, but never clobber an in-flight edit.
    setText((current) => (pending.current ? current : memo.content));
  }, [memo.id, memo.content, flush]);

  // Save before the tab is hidden or closed — mobile browsers may never unmount.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);

  const handleInput = (value: string) => {
    setText(value);
    pending.current = { id: currentId.current, content: value };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
  };

  const handleDelete = () => {
    if (!window.confirm('このメモを削除しますか？')) return;
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    onDelete(memo.id);
  };

  return (
    <section className="editor">
      <div className="editor-bar">
        <button type="button" className="btn btn-ghost btn-icon back-btn" onClick={onBack}>
          ← 一覧
        </button>
        <span>最終更新 {formatFull(memo.updatedAt)}</span>
        <span className="header-spacer" />
        <button type="button" className="btn btn-danger btn-icon" onClick={handleDelete}>
          削除
        </button>
      </div>
      <textarea
        ref={areaRef}
        className="editor-area"
        value={text}
        onChange={(event) => handleInput(event.target.value)}
        onBlur={flush}
        placeholder={'1行目がタイトルになります。\nそのまま書き始めてください。'}
        spellCheck={false}
        aria-label="メモ本文"
      />
    </section>
  );
}
