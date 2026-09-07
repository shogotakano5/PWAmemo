'use client';

import { useEffect } from 'react';

/**
 * Keeps a `--app-vh` CSS custom property in sync with `visualViewport.height`.
 *
 * `interactive-widget: resizes-content` (set in layout.tsx) already handles
 * this on browsers that support it, but that is still a recent addition —
 * notably older iOS Safari ignores it and instead keeps the layout viewport
 * (and any `100dvh` box) at full height behind the software keyboard, which
 * is exactly what let the keyboard cover the top rows of the editor. This
 * hook is the fallback: it tracks the actual visible height directly and
 * `.app` / `.admin-shell` consume it via `var(--app-vh, 100dvh)`, so both
 * paths land on the same correct result.
 */
export function useViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      document.documentElement.style.setProperty('--app-vh', `${viewport.height}px`);
    };
    update();

    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
}
