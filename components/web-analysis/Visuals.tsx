"use client";
import { HeartHandshake } from "lucide-react";
import { PageIllustration, type PageIllustrationVariant } from "@/components/PageIllustration";

export function AnalysisIllustration({ mode = "chat" }: { mode?: string }) {
  return <div className="wa-upload-art cz-upload-illustration" aria-hidden="true"><PageIllustration variant={mode === "chat" ? "analysis" : "social"}/></div>;
}
export function AssistantEmblem({ small = false }: { small?: boolean }) {
  return <span className={small ? "wa-assistant-emblem wa-assistant-emblem-small" : "wa-assistant-emblem"} aria-hidden="true"><span/><HeartHandshake size={small ? 18 : 35} strokeWidth={1.55}/></span>;
}
export function HeadingStamp({ variant = "analysis" }: { variant?: PageIllustrationVariant }) {
  return <div className={`wa-heading-stamp wa-heading-stamp-${variant} cz-page-stamp`} aria-hidden="true"><PageIllustration variant={variant}/></div>;
}
export function VoiceWave({ active }: { active: boolean }) {
  return <div className="wa-wave" data-active={active} aria-hidden="true">{Array.from({ length: 17 }, (_, index) => <span key={index} style={{ "--wave-height": `${12 + (8 - Math.abs(8 - index)) * 3}px`, "--wave-delay": `${index * -.11}s` } as React.CSSProperties}/>)}</div>;
}
