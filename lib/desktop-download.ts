import manifest from "@/public/downloads/desktop-release.json";

export type DesktopDownload = {available:boolean;label:string;system:string;name?:string;url?:string;sha256?:string;bytes?:number;limitations?:string;version?:string};
export const desktopReleaseVersion=manifest.version;
export const desktopDownloads=manifest.files as Record<"windows"|"mac",DesktopDownload>;
export function verifiedDesktopDownload(platform:string):DesktopDownload|null {
  if(platform!=="windows"&&platform!=="mac")return null;
  if(manifest.schema!==1||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(desktopReleaseVersion))return null;
  const file=desktopDownloads[platform];
  const name=platform==='windows'?`Chengzi-Desktop-${desktopReleaseVersion}-win-x64-Setup.exe`:`Chengzi-Desktop-${desktopReleaseVersion}-mac-arm64.dmg`;
  if(!file||file.available!==true||file.name!==name||!Number.isSafeInteger(file.bytes)||Number(file.bytes)<1||Number(file.bytes)>2_147_483_647||!/^[a-f0-9]{64}$/.test(file.sha256||""))return null;
  const expected=`https://github.com/leesom397-tech/goutoujunshi-h5/releases/download/desktop-${desktopReleaseVersion}/${file.name}`;
  return file.url===expected?file:null;
}
