import type { Metadata } from "next";
import "./globals.css";
import "./login.css";
import "./positioning.css";
import "./wechat.css";
import "./knowledge.css";
import "./crush.css";
import "./quick.css";
import "./decision.css";
import "./miniapp.css";
import "./history.css";
import "./history-consistency.css";
import "./web.css";
import "./web-auxiliary.css";
import "./product-redesign.css";
import "./aurora-ui.css";
import "./interaction-motion.css";
import { AuxiliaryWebNav } from "@/components/AuxiliaryWebNav";
import {PwaRegistration} from "@/components/pwa-registration";

export const metadata: Metadata = {
  title: "成子关系决策智能体",
  description: "聊天截图、朋友圈与社交主页分析，人物档案、关系趋势和实时语音，手机与电脑均可使用。",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg?v=aurora-1",
    shortcut: "/favicon.svg?v=aurora-1",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased cz-product"><PwaRegistration/><AuxiliaryWebNav/>{children}</body>
    </html>
  );
}
