'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatFull } from '@/lib/format';
import { looksLikeMarkdown, renderMarkdown } from '@/lib/markdown';
import type { Memo } from '@/lib/types';

const AUTOSAVE_DELAY_MS = 400;

type Props = {
  memo: Memo;
  onChange: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
};

type ViewMode = 'edit' | 'preview';

export default function MemoEditor({ memo, onChange, onDelete, onBack }: Props) {
  const [text, setText] = useState(memo.content);
  const [mode, setMode] = useState<ViewMode>('edit');
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
      setMode('edit');
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

  // Pasting Markdown-looking text shows it rendered right away; a plain-text
  // paste is left alone so typing isn't interrupted by an unexpected view switch.
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text/plain');
    if (pasted && looksLikeMarkdown(pasted)) {
      setTimeout(() => setMode('preview'), 0);
    }
  };

  const handleDelete = () => {
    if (!window.confirm('このメモを削除しますか？')) return;
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    onDelete(memo.id);
  };

  const switchToEdit = () => {
    setMode('edit');
    setTimeout(() => areaRef.current?.focus(), 0);
  };

  return (
    <section className="editor">
      <div className="editor-bar">
        <button type="button" className="btn btn-ghost btn-icon back-btn" onClick={onBack}>
          ← 一覧
        </button>
        <span className="hide-sm">最終更新 {formatFull(memo.updatedAt)}</span>
        <span className="header-spacer" />
        <button
          type="button"
          className="btn btn-icon"
          onClick={() => (mode === 'edit' ? setMode('preview') : switchToEdit())}
        >
          {mode === 'edit' ? 'プレビュー' : '編集に戻る'}
        </button>
        <button type="button" className="btn btn-danger btn-icon" onClick={handleDelete}>
          削除
        </button>
      </div>
      {mode === 'preview' ? (
        <div
          className="editor-area editor-preview"
          // Sanitized by DOMPurify inside renderMarkdown() before this ever renders.
          dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
        />
      ) : (
        <textarea
          ref={areaRef}
          className="editor-area"
          value={text}
          onChange={(event) => handleInput(event.target.value)}
          onPaste={handlePaste}
          onBlur={flush}
          placeholder={'1行目がタイトルになります。\nそのまま書き始めてください。\nMarkdown形式のテキストを貼り付けるとプレビュー表示されます。'}
          spellCheck={false}
          aria-label="メモ本文"
        />
      )}
    </section>
  );
}
