"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, ImagePlus, Monitor, Video, FileUp, Library, ArrowUpRight, ChevronDown } from "lucide-react";
import styles from "./AddMaterials.module.css";

type Props = {
  subjectId?: string;
  onScreenshot?: () => void;
  screenshotHref?: string;
  screenshotLabel?: string;
  onNavigate?: (href: string) => void;
  disabled?: boolean;
  screenshotDisabled?: boolean;
  label?: string;
};

export function AddMaterials({ subjectId = "", onScreenshot, screenshotHref = "/analyze?mode=chat", screenshotLabel = "聊天截图", onNavigate, disabled = false, screenshotDisabled = false, label = "添加材料" }: Props) {
  const panel = useRef<HTMLDetailsElement>(null);
  const [mobile, setMobile] = useState(false);
  const [menuOffset, setMenuOffset] = useState(0);
  const [openAbove, setOpenAbove] = useState(false);
  const [menuHeight, setMenuHeight] = useState(390);
  function positionOptions() {
    if (!panel.current) return;
    const rect = panel.current.getBoundingClientRect();
    const width = Math.min(338, window.innerWidth - 48);
    setMenuOffset(Math.max(12, Math.min(rect.left, window.innerWidth - 24 - width)) - rect.left);
    const below = window.innerHeight - rect.bottom - 102, above = rect.top - 12;
    const useAbove = below < 390 && above > below;
    setOpenAbove(useAbove);
    setMenuHeight(Math.max(150, Math.min(390, useAbove ? above : below)));
    setMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1);
  }
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && panel.current) panel.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && panel.current?.open) { panel.current.open = false; panel.current.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);
  const scoped = (href: string) => subjectId ? href + (href.includes("?") ? "&" : "?") + "subjectId=" + encodeURIComponent(subjectId) : href;
  const options = [
    { key: "screenshots", title: screenshotLabel, hint: "选几张，或直接粘贴", icon: ImagePlus, href: screenshotHref },
    { key: "computer", title: "电脑导入", hint: "可选 · Windows 全部聊天", icon: Monitor, href: "/capture?method=computer" },
    { key: "video", title: "聊天录屏", hint: "上传一段聊天录屏", icon: Video, href: "/capture?method=video" },
    { key: "file", title: "聊天文件", hint: "导入导出的聊天记录", icon: FileUp, href: "/import" },
    { key: "library", title: "已导入材料", hint: "接着使用之前的聊天", icon: Library, href: "/capture?method=library" },
  ];
  return <details className={styles.entry} ref={panel} data-add-materials data-side={openAbove ? "above" : "below"} onToggle={() => { if (disabled && panel.current) panel.current.open = false; if (panel.current?.open) positionOptions(); }}>
    <summary aria-disabled={disabled} onClick={event => { if (disabled) event.preventDefault(); else positionOptions(); }}><Plus size={18}/><span>{label}</span><ChevronDown size={15}/></summary>
    <div className={styles.options} style={{maxHeight: menuHeight, left:menuOffset, right:"auto"}}>
      <p>先粘贴或截几张，就能拿到一句判断、三条原话和一个下一步。电脑导入全部聊天只在 Windows 上，被系统拦住时点「更多信息」再点「仍要运行」。</p>
      {options.map(({ key, title, hint, icon: Icon, href }) => {
        const content = <><Icon size={19}/><span><strong>{title}{key === "screenshots" && <small>推荐</small>}</strong><em>{hint}</em></span><ArrowUpRight size={15}/></>;
        return key === "screenshots" && onScreenshot ? <button type="button" key={key} disabled={disabled || screenshotDisabled} onClick={() => { if (panel.current) panel.current.open = false; onScreenshot(); }}>{content}</button> : <a key={key} href={scoped(href)} onClick={event => { if (disabled) { event.preventDefault(); return; } if (panel.current) panel.current.open = false; if (onNavigate) { event.preventDefault(); onNavigate(scoped(href)); } }}>{content}</a>;
      })}
    </div>
  </details>;
}
