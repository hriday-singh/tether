'use client';

import { useEffect } from 'react';
import 'lenis/dist/lenis.css';

/** Lenis smooth scroll, landing page only (ADR-016). Never mounted in the workspace, so editor wheel events stay native. */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let destroyed = false;
    let cleanup = () => {};
    void import('lenis').then(({ default: Lenis }) => {
      if (destroyed) return;
      const lenis = new Lenis({ autoRaf: true, anchors: true });
      cleanup = () => lenis.destroy();
    });
    return () => {
      destroyed = true;
      cleanup();
    };
  }, []);
  return null;
}
