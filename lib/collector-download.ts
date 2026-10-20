import release from "@/public/downloads/collector-release.json";

// Keep every download entry on the same release that prebuild verifies.
export const collectorVersion = release.version;
export const collectorInstallerHref = `/downloads/ChengziWeChatCollector-Setup-${collectorVersion}.exe`;
