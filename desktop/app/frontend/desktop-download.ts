import metadata from "../package.json";

// An installed app never embeds its own future installer hash. Download
// manifests belong to the website; the native support route has local guidance.
export const desktopReleaseVersion=metadata.version;
export const desktopDownloads={
  windows:{available:false,label:"Windows",system:"Windows 10 / 11 · 64 位",limitations:""},
  mac:{available:false,label:"Mac",system:"Apple 芯片 · arm64",limitations:""},
};
export function verifiedDesktopDownload(_platform:string):{name?:string}|null{return null;}
