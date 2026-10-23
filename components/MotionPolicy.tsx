"use client";
import { useEffect } from 'react';

/** Pause CSS animation work in hidden tabs; rendering never waits for this. */
export function MotionPolicy() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      if (document.hidden) root.dataset.pageHidden = 'true';
      else delete root.dataset.pageHidden;
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => { document.removeEventListener('visibilitychange', update); delete root.dataset.pageHidden; };
  }, []);
  return null;
}
