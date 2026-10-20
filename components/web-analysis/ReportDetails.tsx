"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, X } from "lucide-react";
import styles from "./ReportDetails.module.css";

/** Keep optional reading out of the document flow and return to the same place. */
export function ReportDetails({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const restore = useRef<{ x: number; y: number; overflow: string } | null>(null);
  const [opened, setOpened] = useState(false);
  const close = () => dialog.current?.close();
  function restorePosition() {
    if (restore.current) {
      document.documentElement.style.overflow = restore.current.overflow;
      window.scrollTo({ left: restore.current.x, top: restore.current.y, behavior: "instant" });
      restore.current = null;
    }
    trigger.current?.focus({ preventScroll: true });
    setOpened(false);
  }
  useEffect(() => () => { if (restore.current) document.documentElement.style.overflow = restore.current.overflow; }, []);
  function open() {
    if (!dialog.current || dialog.current.open) return;
    restore.current = { x: window.scrollX, y: window.scrollY, overflow: document.documentElement.style.overflow };
    setOpened(true);
    dialog.current.showModal();
    document.documentElement.style.overflow = "hidden";
  }
  return <>
    <button type="button" ref={trigger} className={styles.trigger} onClick={open} aria-haspopup="dialog" aria-expanded={opened} aria-controls={`${id}-dialog`}><span><strong>{title}</strong>{description && <small>{description}</small>}</span><ArrowUpRight size={21}/></button>
    <dialog id={`${id}-dialog`} ref={dialog} className={styles.dialog} aria-labelledby={id} onClose={restorePosition} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }}>
      <header className={styles.header}><h2 id={id}>{title}</h2><button type="button" onClick={close} aria-label="关闭详情并返回报告"><X size={22}/></button></header>
      <div className={styles.content}>{opened && children}</div>
    </dialog>
  </>;
}
