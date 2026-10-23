"use client";
import { AudioLines, Fingerprint, MessageCircle, ScanLine, UserRound, Files, Heart, Image } from "lucide-react";
import "./page-illustration.css";
export type PageIllustrationVariant = "analysis" | "social" | "chat" | "voice" | "report" | "archive" | "self" | "account";
type Props = { variant: PageIllustrationVariant; className?: string; compact?: boolean };
export function PageIllustration({variant,className="",compact=false}:Props){
 const Icon = {analysis:ScanLine,social:Image,chat:MessageCircle,voice:AudioLines,report:Files,archive:Heart,self:UserRound,account:Fingerprint}[variant];
 return <div className={`cz-page-illustration playful-illustration ${compact?"is-compact":""} ${className}`} aria-hidden="true"><span className="playful-art-back"/><span className="playful-art-front"><Icon size={52} strokeWidth={1.6}/></span></div>;
}
