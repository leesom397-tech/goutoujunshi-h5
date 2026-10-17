"use client";
import { useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import type { QuestionImage } from "./question-images";

export function QuestionImagePreview({ image, onClose }: { image: QuestionImage | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    if (!image) return;
    setZoomed(false);
    const element = dialog.current;
    const overflow = document.documentElement.style.overflow;
    element?.showModal();
    document.documentElement.style.overflow = "hidden";
    return () => { element?.close(); document.documentElement.style.overflow = overflow; };
  }, [image]);
  if (!image) return null;
  return <dialog ref={dialog} className="chat-image-preview" aria-labelledby="chat-image-preview-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header><strong id="chat-image-preview-title">核对截图</strong><div><button type="button" aria-pressed={zoomed} onClick={() => setZoomed(value => !value)}>{zoomed ? <ZoomOut size={18}/> : <ZoomIn size={18}/>} {zoomed ? "适合屏幕" : "放大看文字"}</button><button type="button" autoFocus aria-label="关闭截图预览" onClick={onClose}><X size={22}/></button></div></header>
    <div className="chat-image-preview-body" data-zoomed={zoomed}><img src={image.data} alt={image.name}/></div>
  </dialog>;
}
