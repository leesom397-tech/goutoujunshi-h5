import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { readWebIdentity } from "@/lib/request-identity.mjs";

// The file name is retained for existing imports. Public deployments use the
// independent native accounts, with existing-account compatibility for migration.
export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const identity = await readWebIdentity(await headers(), env);
  return identity ? { userId: identity.ownerId, displayName: identity.displayName, email: "", fullName: null } : null;
}

export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;
  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  return `/login?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  return `/logout?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    return url.origin === "https://app.local" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
