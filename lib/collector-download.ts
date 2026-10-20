import release from "@/public/downloads/collector-release.json";
import manifest from "@/public/downloads/manifest.json";

// Keep every download entry on the same release that prebuild verifies.
export const collectorVersion = release.version;
export const collectorInstallerHref = `/downloads/ChengziWeChatCollector-Setup-${collectorVersion}.exe`;
export const collectorInstallerSha256 = release.files.find(file => file.name === `ChengziWeChatCollector-Setup-${collectorVersion}.exe`)?.sha256 || "";
export const collectorIsSigned = manifest.version === collectorVersion && manifest.signature?.status === "Valid";
