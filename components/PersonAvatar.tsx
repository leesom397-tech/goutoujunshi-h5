"use client";
import { useState, type ReactNode } from "react";
import { getDesktopHost } from "@/lib/desktop-host";
import { desktopAvatarSource } from "@/lib/contact-avatar";

/** Existing uploaded avatars stay local; expired remote avatars retain initials. */
export function PersonAvatar({ src = "", alt, className, fallback }: { src?: string; alt: string; className?: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState("");
  const source = desktopAvatarSource(src, !!getDesktopHost());
  return source && failed !== source ? <img className={className} src={source} alt={alt} referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(source)}/> : <>{fallback}</>;
}
