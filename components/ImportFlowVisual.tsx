"use client";

import { AudioLines, Check, CloudUpload, Images, Layers3, MessageCircle, ScanLine, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import styles from "./ImportFlowVisual.module.css";

export type ImportFlowPhase = "chat" | "voice" | "images" | "moments" | "upload" | "analysis";

export interface ImportFlowVisualProps {
  phase: ImportFlowPhase | string;
  paused?: boolean;
  counts?: { chat?: number; voice?: number; moments?: number };
}

const phases = {
  chat: { icon: MessageCircle, title: "聊天正在汇入", caption: "把一句句对话，整理成完整脉络" },
  voice: { icon: AudioLines, title: "听见每一段语音", caption: "语音转成文字，保留对话里的细节" },
  images: { icon: ScanLine, title: "读取图片线索", caption: "让图片里的信息也进入这段关系" },
  moments: { icon: Images, title: "朋友圈正在汇入", caption: "连接生活片段，看见更完整的这个人" },
  upload: { icon: CloudUpload, title: "资料正在同步", caption: "已导入的内容，正在安全保存" },
  analysis: { icon: Sparkles, title: "线索正在形成答案", caption: "结合聊天与生活片段，整理关系判断" },
} as const;

const sources = [
  { key: "chat", icon: MessageCircle, label: "聊天" },
  { key: "voice", icon: AudioLines, label: "语音" },
  { key: "moments", icon: Images, label: "朋友圈" },
] as const;

/** A decorative live-stage visual. It never estimates progress or invents counts. */
export default function ImportFlowVisual({ phase, paused = false, counts }: ImportFlowVisualProps) {
  const stage = Object.prototype.hasOwnProperty.call(phases, phase) ? phase as ImportFlowPhase : "chat";
  const detail = phases[stage];
  const StageIcon = detail.icon;
  const knownCounts = sources.flatMap(({ key, label }) => {
    const value = counts?.[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? [{ key, label, value: Math.floor(value).toLocaleString("zh-CN") }]
      : [];
  });

  return (
    <section className={styles.visual} data-phase={stage} data-paused={paused || undefined} aria-label="资料导入状态">
      <div className={styles.eyebrow} aria-hidden="true">
        <span className={styles.liveDot} />
        <span>{stage === "analysis" ? "关系分析" : "资料汇聚"}</span>
        <span className={styles.stageMark}>{paused ? "等待中" : "进行中"}</span>
      </div>

      <div className={styles.scene} aria-hidden="true">
        <div className={styles.floor} />
        <svg className={styles.paths} viewBox="0 0 400 240" fill="none" preserveAspectRatio="none">
          <path d="M54 60 C143 60 140 120 278 120" />
          <path d="M54 120 H278" />
          <path d="M54 180 C143 180 140 120 278 120" />
        </svg>

        {sources.map(({ key, icon: Icon, label }, index) => (
          <div key={key} className={styles.source} data-source={key} data-active={key === stage || (key === "moments" && stage === "images") || undefined} style={{ "--track": index } as CSSProperties}>
            <div className={styles.sourceTile}><Icon size={20} strokeWidth={1.6} /></div>
            <span>{label}</span>
          </div>
        ))}

        {sources.map(({ key, icon: Icon }, index) => (
          <div key={key} className={styles.flight} data-track={index} style={{ "--delay": `${index * -1.15}s` } as CSSProperties}>
            <div className={styles.packet}><Icon size={15} strokeWidth={1.7} /></div>
          </div>
        ))}

        <div className={styles.vault}>
          <div className={styles.vaultBack} />
          <div className={styles.vaultFace}>
            <div className={styles.flutes} />
            <div className={styles.scan} />
            <div className={styles.core} key={stage}><StageIcon size={33} strokeWidth={1.5} /></div>
            <div className={styles.vaultBase}><Layers3 size={13} strokeWidth={1.5} /><span>你的资料</span></div>
          </div>
          <div className={styles.arrival}><Check size={13} strokeWidth={2} /></div>
        </div>
        <div className={styles.signal}><span /><span /><span /></div>
      </div>

      <div className={styles.copy} role="status" aria-live="polite" aria-atomic="true">
        <h3>{paused ? "等待新进度" : detail.title}</h3>
        <p>{paused ? "保留已导入的内容，收到进度后继续" : detail.caption}</p>
      </div>
      {knownCounts.length > 0 && <dl className={styles.counts} aria-label="当前已处理资料">
        {knownCounts.map(({ key, label, value }) => <div key={key}><dt>{label}</dt><dd>{value}<span> 条</span></dd></div>)}
      </dl>}
    </section>
  );
}
