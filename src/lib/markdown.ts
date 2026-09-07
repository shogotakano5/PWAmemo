'use client';

import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  // Single newlines become <br> — memos read as freeform notes, not strict
  // Markdown documents, so a lone line break should still look like one.
  breaks: true,
});

/** Renders Markdown to sanitized HTML, safe to hand to dangerouslySetInnerHTML. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

const MARKDOWN_PATTERNS: RegExp[] = [
  /^#{1,6}\s+\S/m, // # heading
  /\*\*[^*\n]+\*\*/, // **bold**
  /(^|\n)[-*+]\s+\S/, // - bullet list
  /(^|\n)\d+\.\s+\S/, // 1. numbered list
  /\[[^\]]+\]\([^)]+\)/, // [text](url)
  /```/, // fenced code block
  /(^|\n)>\s+\S/, // > blockquote
  /(^|\n)\|.*\|.*\n\|[\s:|-]+\|/, // table (header row + separator row)
];

/** Heuristic used to auto-preview a paste that looks like Markdown source. */
export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(text));
}
