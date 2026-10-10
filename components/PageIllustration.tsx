"use client";

import { useId, type ReactNode } from "react";
import { AudioLines, Check, Compass, Fingerprint, Image, MessageCircle, ScanLine, ShieldCheck, UserRound } from "lucide-react";
import "./page-illustration.css";

export type PageIllustrationVariant = "analysis" | "social" | "chat" | "voice" | "report" | "archive" | "self" | "account";
type Props = { variant: PageIllustrationVariant; className?: string; compact?: boolean };

/** Decorative product metaphors only: these shapes never represent user data. */
export function PageIllustration({ variant, className = "", compact = false }: Props) {
  const id = "cz-art-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const glass = `url(#${id}-glass)`, paper = `url(#${id}-paper)`, shadow = `url(#${id}-shadow)`;
  const panel = (x: number, y: number, width: number, height: number, children: ReactNode, rotation = 0) => <g transform={`rotate(${rotation} ${x + width / 2} ${y + height / 2})`} className="cz-illustration-panel"><rect x={x} y={y} width={width} height={height} rx="14" fill={paper} stroke="var(--ci-edge)" filter={shadow}/><path d={`M${x + 15} ${y + 1}H${x + width - 15}`} stroke="#fff" strokeWidth="2" strokeLinecap="round"/>{children}</g>;
  const mark = (x: number, y: number, children: ReactNode) => <g className="cz-illustration-mark"><circle cx={x} cy={y} r="21" fill={glass} stroke="var(--ci-edge)" filter={shadow}/>{children}</g>;
  return <div className={`cz-page-illustration${compact ? " is-compact" : ""} ${className}`.trim()} data-illustration={variant} aria-hidden="true">
    <svg viewBox="0 0 280 200" fill="none" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-paper`} x1=".12" y1="0" x2=".83" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="#ffffff"/><stop offset=".58" stopColor="#f6fbfe" stopOpacity=".96"/><stop offset="1" stopColor="#dbedf7" stopOpacity=".88"/></linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="#ffffff" stopOpacity=".98"/><stop offset=".42" stopColor="#f4e7da" stopOpacity=".72"/><stop offset=".7" stopColor="#ffffff" stopOpacity=".94"/><stop offset="1" stopColor="#c9e4f0" stopOpacity=".8"/></linearGradient>
        <radialGradient id={`${id}-wash`}><stop stopColor="#add3e7" stopOpacity=".34"/><stop offset="1" stopColor="#f5f9fb" stopOpacity="0"/></radialGradient>
        <filter id={`${id}-shadow`} x="-50%" y="-40%" width="200%" height="200%"><feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#607d8c" floodOpacity=".12"/></filter>
      </defs>
      <ellipse cx="147" cy="151" rx="111" ry="36" fill={`url(#${id}-wash)`}/>
      <path className="cz-illustration-guide" d="M26 117C48 38 167 8 234 65S238 170 183 183" stroke="var(--ci-faint)" strokeDasharray="2 7" strokeLinecap="round"/>
      <circle cx="31" cy="112" r="3" fill="var(--ci-gold)"/>
      <circle cx="237" cy="70" r="2" fill="var(--ci-accent)" opacity=".45"/>

      {variant === "analysis" && <>
        {panel(50, 31, 94, 134, <><Image x="67" y="51" width="25" height="25" strokeWidth="1.3"/><path d="M66 97h46M66 108h36M66 135h27" className="cz-illustration-rule"/></>, -12)}
        {panel(113, 43, 98, 134, <><MessageCircle x="133" y="61" width="23" height="23" strokeWidth="1.35"/><rect x="129" y="94" width="64" height="21" rx="6" fill="var(--ci-soft)"/><path d="M140 105h39M130 131h47M130 143h30" className="cz-illustration-rule"/></>, 8)}
        <g className="cz-illustration-focus"><circle cx="192" cy="112" r="35" fill={glass} fillOpacity=".62" stroke="var(--ci-accent)" strokeWidth="2" filter={shadow}/><circle cx="192" cy="112" r="29" stroke="#fff" strokeWidth="2"/><path d="m216 138 20 22" stroke="var(--ci-accent)" strokeWidth="8" strokeLinecap="round"/><ScanLine x="176" y="96" width="32" height="32" strokeWidth="1.25"/></g>
      </>}

      {variant === "social" && <>
        {panel(47, 44, 131, 115, <><rect x="63" y="61" width="43" height="43" rx="8" fill="var(--ci-soft)"/><Image x="72" y="70" width="24" height="24" strokeWidth="1.3"/><rect x="116" y="61" width="43" height="43" rx="8" fill={glass} stroke="var(--ci-faint)"/><path d="m123 91 9-12 10 8 10-10M64 124h88M64 137h49" className="cz-illustration-rule"/></>, -8)}
        {panel(168, 82, 70, 87, <><circle cx="203" cy="108" r="15" fill="var(--ci-soft)"/><UserRound x="193" y="98" width="20" height="20" strokeWidth="1.2"/><path d="M183 139h39M189 150h28" className="cz-illustration-rule"/></>, 10)}
        {mark(204, 47, <ScanLine x="193" y="36" width="22" height="22" strokeWidth="1.3"/>)}
      </>}

      {variant === "chat" && <>
        <g transform="rotate(-8 111 83)" className="cz-illustration-panel"><path d="M51 39h121a15 15 0 0 1 15 15v49a15 15 0 0 1-15 15H89l-24 20v-20H51a15 15 0 0 1-15-15V54a15 15 0 0 1 15-15Z" fill={paper} stroke="var(--ci-edge)" filter={shadow}/><path d="M61 64h76M61 80h100M61 96h50" className="cz-illustration-rule"/></g>
        <g transform="rotate(7 185 137)" className="cz-illustration-panel"><path d="M128 101h105a14 14 0 0 1 14 14v43a14 14 0 0 1-14 14h-8v17l-24-17h-73a14 14 0 0 1-14-14v-43a14 14 0 0 1 14-14Z" fill={glass} stroke="var(--ci-edge)" filter={shadow}/><path d="M137 125h83M137 141h59" className="cz-illustration-rule"/></g>
        <path d="M70 158c5 15 17 20 32 18" stroke="var(--ci-gold)" strokeWidth="1.5" strokeLinecap="round"/>
        {mark(219, 50, <MessageCircle x="208" y="39" width="22" height="22" strokeWidth="1.3"/>)}
      </>}

      {variant === "voice" && <>
        <ellipse cx="135" cy="104" rx="88" ry="56" transform="rotate(-25 135 104)" stroke="var(--ci-edge)" strokeWidth="2"/>
        <ellipse cx="135" cy="104" rx="68" ry="80" transform="rotate(28 135 104)" stroke="var(--ci-gold)" strokeOpacity=".6"/>
        <circle cx="135" cy="104" r="56" fill={glass} stroke="var(--ci-edge)" filter={shadow}/>
        <circle cx="135" cy="104" r="48" stroke="#fff" strokeWidth="2"/>
        <AudioLines x="107" y="76" width="56" height="56" strokeWidth="1.2" className="cz-illustration-voice-symbol"/>
        <path d="M207 81c11 12 11 31 0 43M218 71c17 18 17 42 0 62" stroke="var(--ci-gold)" strokeWidth="1.8" strokeLinecap="round"/>
        <circle cx="81" cy="48" r="8" fill={paper} stroke="var(--ci-edge)"/>
        <path d="m108 174 16 3 20-2" stroke="var(--ci-gold)" strokeWidth="2" strokeLinecap="round"/>
      </>}

      {variant === "report" && <>
        {panel(63, 36, 112, 143, <><path d="M85 68h60M85 84h41M85 131h60M85 144h44" className="cz-illustration-rule"/></>, -9)}
        {panel(113, 25, 109, 142, <><path d="M132 53h54M132 66h32" className="cz-illustration-rule"/><rect x="130" y="84" width="74" height="25" rx="6" fill="var(--ci-soft)"/><Check x="138" y="89" width="15" height="15" strokeWidth="1.8"/><path d="M160 96h30M132 127h59M132 141h40" className="cz-illustration-rule"/><path d="M184 25v27l9-6 9 6V25" fill="var(--ci-soft)" stroke="var(--ci-edge)"/></>, 7)}
        {mark(63, 134, <Check x="52" y="123" width="22" height="22" strokeWidth="1.5"/>)}
      </>}

      {variant === "archive" && <>
        <path d="M43 65a13 13 0 0 1 13-13h51l15 17h103a13 13 0 0 1 13 13v77a13 13 0 0 1-13 13H56a13 13 0 0 1-13-13Z" fill={glass} stroke="var(--ci-edge)" filter={shadow}/>
        {panel(67, 30, 65, 111, <><circle cx="100" cy="57" r="15" fill="var(--ci-soft)"/><UserRound x="90" y="47" width="20" height="20" strokeWidth="1.2"/><path d="M81 85h36M81 99h25" className="cz-illustration-rule"/></>, -8)}
        {panel(137, 36, 67, 110, <><circle cx="170" cy="62" r="15" fill="var(--ci-soft)"/><UserRound x="160" y="52" width="20" height="20" strokeWidth="1.2"/><path d="M151 89h36M151 102h25" className="cz-illustration-rule"/></>, 8)}
        <path d="M40 111a12 12 0 0 1 12-10h178a12 12 0 0 1 12 14l-8 48a12 12 0 0 1-12 10H59a12 12 0 0 1-12-10Z" fill={paper} stroke="var(--ci-edge)" filter={shadow}/>
        <path d="M81 135h116" stroke="var(--ci-gold)" strokeWidth="1.5"/>
        {[91, 140, 188].map(x => <circle key={x} cx={x} cy="135" r="4" fill="#f6fbfe" stroke="var(--ci-accent)"/>)}
      </>}

      {variant === "self" && <>
        <circle cx="139" cy="105" r="75" stroke="var(--ci-edge)" strokeDasharray="3 7"/>
        <circle cx="139" cy="105" r="58" fill={glass} stroke="var(--ci-edge)" filter={shadow}/>
        <UserRound x="111" y="74" width="56" height="56" strokeWidth="1.2"/>
        <path d="m139 20 5 10h-10ZM224 105l-10 5V100ZM139 190l-5-10h10ZM54 105l10-5v10Z" fill="var(--ci-gold)"/>
        {mark(203, 48, <Compass x="191" y="36" width="24" height="24" strokeWidth="1.25"/>)}
        <path d="M102 145c22 7 51 7 74-1" stroke="#fff" strokeWidth="3" strokeLinecap="round"/>
      </>}

      {variant === "account" && <>
        {panel(65, 33, 131, 95, <><Fingerprint x="85" y="51" width="29" height="29" strokeWidth="1.15"/><path d="M85 99h70" className="cz-illustration-rule"/></>, -8)}
        <rect x="48" y="88" width="175" height="83" rx="17" fill={paper} stroke="var(--ci-edge)" filter={shadow}/>
        <path d="M65 104h127M66 151h39" className="cz-illustration-rule"/>
        <rect x="177" y="112" width="52" height="32" rx="10" fill={glass} stroke="var(--ci-edge)"/>
        <circle cx="191" cy="128" r="3" fill="var(--ci-accent)"/>
        {mark(217, 55, <ShieldCheck x="205" y="43" width="24" height="24" strokeWidth="1.3"/>)}
      </>}
      <path className="cz-illustration-glint" d="M47 45h8m-4-4v8M236 155h6m-3-3v6" stroke="var(--ci-gold)" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  </div>;
}
