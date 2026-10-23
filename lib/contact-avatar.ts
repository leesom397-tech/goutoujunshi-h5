type AvatarContact = { avatarData?: string; avatarUrl?: string };

function wechatAvatarUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.href.length <= 2000 && url.protocol === "https:" && !url.username && !url.password && !url.port && /(^|\.)(qlogo|qpic)\.cn$/.test(url.hostname)) {
      url.hash = "";
      return url.href;
    }
  } catch {}
  return "";
}

/** Keep saved data/API/upload avatars intact; only WeChat CDN URLs need a proxy. */
export function desktopAvatarSource(value: string, desktop = false): string {
  const url = desktop ? wechatAvatarUrl(value) : "";
  return url ? `/_desktop/contact-avatar?url=${encodeURIComponent(url)}` : value;
}

/** Cached bytes come first. The installed app uses its bounded, image-only proxy. */
export function contactAvatarSources(row: AvatarContact, desktop = false): string[] {
  const sources: string[] = [];
  if (row.avatarData && row.avatarData.length < 100000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(row.avatarData)) sources.push(row.avatarData);
  const url = wechatAvatarUrl(row.avatarUrl || "");
  if (url) sources.push(desktopAvatarSource(url, desktop));
  return sources;
}
