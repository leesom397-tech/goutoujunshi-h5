"use client";
import { AuthArtwork } from "@/components/AuthArtwork";
import { BrandMark } from "@/components/BrandMark";
import { PhoneRegisterForm } from "@/components/PhoneRegisterForm";

export default function RegisterPage() {
  return <main className="login-screen"><div className="login-showcase"><div className="showcase-intro"><span className="showcase-kicker">成子 · 关系决策智能体</span><h1>让每次分析，<br/>接上你们的故事。</h1><p>保存你确认的人物资料与关系变化。</p></div><AuthArtwork/></div><div className="login-panel"><a className="login-brand" href="/workspace"><span className="brand-mark"><BrandMark/></span><span>成子</span></a><PhoneRegisterForm/></div></main>;
}
