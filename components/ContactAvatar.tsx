"use client";
import { useState } from "react";
import { UserRound } from "lucide-react";
import { contactAvatarSources } from "@/lib/contact-avatar";

export function ContactAvatar({ contact, desktop = false, size = 20 }: { contact: { avatarData?: string; avatarUrl?: string }; desktop?: boolean; size?: number }) {
  const [failed, setFailed] = useState<string[]>([]);
  const source = contactAvatarSources(contact, desktop).find(value => !failed.includes(value));
  return source ? <img src={source} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(previous => [...previous, source])}/> : <UserRound size={size}/>;
}
